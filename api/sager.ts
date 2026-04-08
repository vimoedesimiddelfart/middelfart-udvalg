import type { VercelRequest, VercelResponse } from '@vercel/node';
import https from 'https';
import { kvGet, kvSet } from '../lib/kv';

const FA_BASE = 'https://dagsordener.middelfart.dk';

// Relevant committees for VisitMiddelfart
const RELEVANTE_UDVALG = [
  'Økonomiudvalget',
  'Teknisk Udvalg',
  'Børn- Kultur og Fritidsudvalget',
  'Klima- Natur og Genbrugsudvalget',
  'Beskæftigelses- og Arbejdsmarkedsudvalget',
  'Social- og Sundhedsudvalget',
  'Skoleudvalget',
  'Byrådet',
];

// Cookie jar - reset per invocation
let sessionCookies: string[] = [];

function httpsRequest(url: string, cookies: string[] = []): Promise<{ statusCode: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/html, */*',
        ...(cookies.length > 0 ? { 'Cookie': cookies.join('; ') } : {}),
      },
    };
    const req = https.get(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf-8'),
        });
      });
    });
    req.on('error', (e) => reject(e));
    req.setTimeout(25000, () => { req.destroy(); reject(new Error(`Timeout: ${url}`)); });
  });
}

function extractCookies(headers: any): string[] {
  const setCookie = headers['set-cookie'];
  if (!setCookie) return [];
  return (Array.isArray(setCookie) ? setCookie : [setCookie]).map(
    (c: string) => c.split(';')[0]
  );
}

async function fetchFA(path: string): Promise<any> {
  const url = `${FA_BASE}${path}`;

  // First attempt with existing cookies
  let resp = await httpsRequest(url, sessionCookies);

  // Handle authentication redirect chain
  let maxRedirects = 5;
  while (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location && maxRedirects-- > 0) {
    // Collect cookies from each redirect
    const newCookies = extractCookies(resp.headers);
    sessionCookies.push(...newCookies);

    let redirectUrl = resp.headers.location;
    if (redirectUrl.startsWith('/')) {
      redirectUrl = `${FA_BASE}${redirectUrl}`;
    }
    resp = await httpsRequest(redirectUrl, sessionCookies);
  }

  // Collect final cookies
  const finalCookies = extractCookies(resp.headers);
  sessionCookies.push(...finalCookies);

  if (!resp.body) {
    throw new Error(`Empty response for ${path} (status: ${resp.statusCode})`);
  }

  try {
    return JSON.parse(resp.body);
  } catch {
    throw new Error(`JSON parse error for ${path} (status: ${resp.statusCode}): ${resp.body.substring(0, 200)}`);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  try {
    const forceRefresh = req.query.refresh === '1';

    // Tjek cache først (sager-listen caches i 1 time)
    if (!forceRefresh) {
      const cached = await kvGet<any>('sager:liste');
      if (cached) {
        // Merge med individuelle sag-data (klassificering, check-in)
        const sagerMedData = await Promise.all(
          cached.map(async (sag: any) => {
            const sagData = await kvGet<any>(`sag:${sag.id}`);
            if (sagData) return { ...sag, ...sagData };
            return sag;
          })
        );
        return res.status(200).json({ sager: sagerMedData, antal_møder: cached.length, fra_cache: true });
      }
    }

    // Reset cookies for this invocation
    sessionCookies = [];

    // 1. Hent udvalgsliste
    const data = await fetchFA('/api/agenda/udvalgsliste');
    const udvalg = data.Udvalg || {};

    // 2. Saml møder fra de seneste 90 dage
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const meetings: any[] = [];

    for (const [gruppe, committees] of Object.entries(udvalg)) {
      for (const committee of committees as any[]) {
        const navn = committee.Navn || '';
        for (const meeting of committee.Moeder || []) {
          const dato = new Date(meeting.Dato || meeting.MeetingBeginUtc);
          if (dato >= cutoff) {
            meetings.push({
              udvalg: navn,
              møde_id: meeting.Id,
              møde_dato: dato.toISOString().split('T')[0],
              navn: meeting.Navn,
              afsluttet: meeting.Afsluttet,
            });
          }
        }
      }
    }

    // 3. Hent dagsordenspunkter for hvert møde (parallelt, max 3 ad gangen for stabilitet)
    const alleSager: any[] = [];
    let failCount = 0;

    for (let i = 0; i < meetings.length; i += 3) {
      const chunk = meetings.slice(i, i + 3);
      const results = await Promise.all(
        chunk.map(async (m) => {
          try {
            const dagData = await fetchFA(`/api/agenda/dagsorden/${m.møde_id}`);
            const punkter = dagData.Dagsordenpunkter || [];
            return punkter.map((p: any) => {
              const htmlContent = p.Felter?.[0]?.Html || '';
              const indhold = stripHtml(htmlContent);
              return {
                id: `${m.møde_id}-${p.Punktnummer || p.Number}`,
                møde_id: m.møde_id,
                udvalg: m.udvalg,
                møde_dato: m.møde_dato,
                punkt_nr: parseInt(p.Punktnummer || p.Number || '0'),
                titel: p.Navn || p.Caption || '',
                indhold: indhold.substring(0, 4000),
                kilde_url: `https://dagsordener.middelfart.dk/vis?id=${m.møde_id}`,
                bilag: (p.Bilag || []).map((b: any) => b.Navn).join(', '),
                is_open: p.IsOpen !== false,
                afsluttet: m.afsluttet === true,
              };
            });
          } catch (e: any) {
            failCount++;
            console.error(`Failed to fetch meeting ${m.møde_id}:`, e.message);
            return [];
          }
        })
      );
      for (const items of results) {
        alleSager.push(...items);
      }
    }

    console.log(`Fetched ${alleSager.length} agenda items from ${meetings.length} meetings (${failCount} failed)`);

    // 4. Merge med KV-data (klassificering + check-in)
    const sagerMedData = await Promise.all(
      alleSager.map(async (sag) => {
        const cached = await kvGet<any>(`sag:${sag.id}`);
        if (cached) return { ...sag, ...cached };
        return sag;
      })
    );

    // Filtrer lukkede punkter og sorter
    const openSager = sagerMedData
      .filter((s) => s.is_open && s.titel && !s.titel.match(/^(Underskriftsside|Gensidig orientering)$/i))
      .sort((a, b) => {
        const scoreA = a.relevans_score || 0;
        const scoreB = b.relevans_score || 0;
        if (scoreB !== scoreA) return scoreB - scoreA;
        return (b.møde_dato || '').localeCompare(a.møde_dato || '');
      });

    // Cache sagslisten i 24 timer
    await kvSet('sager:liste', openSager, 86400);

    res.status(200).json({ sager: openSager, antal_møder: meetings.length });
  } catch (e: any) {
    console.error('sager error:', e);
    res.status(500).json({ error: e.message });
  }
}
