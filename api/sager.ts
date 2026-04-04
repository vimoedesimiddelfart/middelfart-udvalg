import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvGet } from '../lib/kv';

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

async function fetchFA(path: string) {
  const res = await fetch(`${FA_BASE}${path}`, {
    headers: { 'User-Agent': 'VisitMiddelfart-Udvalgsmonitor/1.0' },
  });
  if (!res.ok) throw new Error(`FirstAgenda ${path}: ${res.status}`);
  return res.json();
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

    // 3. Hent dagsordenspunkter for hvert møde (parallelt, max 5 ad gangen)
    const alleSager: any[] = [];

    const chunks = [];
    for (let i = 0; i < meetings.length; i += 5) {
      chunks.push(meetings.slice(i, i + 5));
    }

    for (const chunk of chunks) {
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
              };
            });
          } catch {
            return [];
          }
        })
      );
      for (const items of results) {
        alleSager.push(...items);
      }
    }

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

    res.status(200).json({ sager: openSager, antal_møder: meetings.length });
  } catch (e: any) {
    console.error('sager error:', e);
    res.status(500).json({ error: e.message });
  }
}
