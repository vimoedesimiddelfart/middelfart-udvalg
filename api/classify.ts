import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvGet, kvSet } from '../lib/kv';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const BATCH_SIZE = 10;

async function classifyBatch(batch: any[]): Promise<any[]> {
  const sagerText = batch
    .map(
      (sag, i) =>
        `[${i}] Udvalg: ${sag.udvalg}\nTitel: ${sag.titel}\nIndhold: ${(sag.indhold || '').substring(0, 2000)}`
    )
    .join('\n---\n');

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `Du er analytiker for VisitMiddelfart (turismeorganisation i Middelfart Kommune).
Klassificér disse ${batch.length} dagsordenspunkter.

${sagerText}

Svar KUN med et JSON-array med ${batch.length} objekter i samme rækkefølge:
[{
  "kategori": "turisme|erhverv|kultur|klima|infrastruktur|bosætning|events|budget|partnerskaber|andet",
  "relevans_score": <1-5 hvor 5=direkte relevant for turisme/erhverv>,
  "resumé": "<2-3 sætningers resumé>",
  "relevans_begrundelse": "<kort begrundelse for relevans for VisitMiddelfart>",
  "foreslaaet_handling": "ingen handling|overvåg|afklar|reager|foreslå møde|lever input"
}]`,
      },
      {
        role: 'assistant',
        content: '[',
      },
    ],
  });

  const text = '[' + (message.content[0].type === 'text' ? message.content[0].text : '');
  const cleaned = text.endsWith('```') ? text.slice(0, text.lastIndexOf(']') + 1) : text;

  try {
    return JSON.parse(cleaned);
  } catch {
    // Fallback: returner tomme resultater så vi ikke mister data
    return batch.map(() => ({
      kategori: 'andet',
      relevans_score: 1,
      resumé: 'Kunne ikke klassificeres (batch parse fejl)',
      relevans_begrundelse: '',
      foreslaaet_handling: 'overvåg',
    }));
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { sager } = req.body;
  if (!sager || !Array.isArray(sager)) {
    return res.status(400).json({ error: 'sager array required' });
  }

  // Opdel i cached og uncached
  const results: any[] = new Array(sager.length);
  const uncached: { index: number; sag: any }[] = [];

  for (let i = 0; i < sager.length; i++) {
    const sag = sager[i];
    const cached = await kvGet<any>(`sag:${sag.id}`);
    if (cached?.relevans_score) {
      results[i] = { id: sag.id, ...cached };
    } else {
      uncached.push({ index: i, sag });
    }
  }

  // Batch-klassificér uncached sager
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const classifications = await classifyBatch(batch.map((b) => b.sag));

    for (let j = 0; j < batch.length; j++) {
      const { index, sag } = batch[j];
      const classification = classifications[j] || {
        kategori: 'andet',
        relevans_score: 1,
        resumé: 'Kunne ikke klassificeres',
        relevans_begrundelse: '',
        foreslaaet_handling: 'overvåg',
      };

      const sagData = {
        ...classification,
        status: 'ubehandlet',
        klassificeret: new Date().toISOString(),
      };

      await kvSet(`sag:${sag.id}`, sagData, 90 * 24 * 60 * 60);
      results[index] = { id: sag.id, ...sagData };
    }
  }

  res.status(200).json({ results });
}
