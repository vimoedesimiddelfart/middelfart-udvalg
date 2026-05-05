import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvGet, kvSet } from '../lib/kv';
import { checkAuth } from '../lib/auth';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Access-Token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!checkAuth(req, res)) return;

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { sag_id, titel, udvalg, resumé, vores_input } = req.body;
  if (!sag_id || !vores_input) {
    return res.status(400).json({ error: 'sag_id og vores_input required' });
  }

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Du er kommunikationsrådgiver for VisitMiddelfart (turismeorganisation).

Skriv en kort briefing om denne sag fra ${udvalg || 'et udvalg'} i Middelfart Kommune.

Sag: ${titel}
AI-resumé: ${resumé || 'Intet resumé'}
Vores data/input: ${vores_input}

Skriv briefingen med disse tre afsnit:
**Hvad er sagen?** (2-3 sætninger)
**Hvad betyder det for os?** (baseret på vores input/data)
**Hvilket input kan vi give?** (3 konkrete forslag til handling)

Hold det kort og handlingsorienteret. Skriv på dansk.`,
        },
      ],
    });

    const vinkel =
      message.content[0].type === 'text' ? message.content[0].text : '';

    // Gem i KV
    const existing = (await kvGet<any>(`sag:${sag_id}`)) || {};
    await kvSet(`sag:${sag_id}`, { ...existing, vores_vinkel: vinkel }, 90 * 24 * 60 * 60);

    res.status(200).json({ vores_vinkel: vinkel });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
