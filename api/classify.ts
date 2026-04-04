import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kvGet, kvSet } from './_kv';
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

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

  const results: any[] = [];

  for (const sag of sager) {
    // Tjek KV cache
    const cached = await kvGet<any>(`sag:${sag.id}`);
    if (cached?.relevans_score) {
      results.push({ id: sag.id, ...cached });
      continue;
    }

    // Klassificér med Claude
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `Du er analytiker for VisitMiddelfart (turismeorganisation i Middelfart Kommune).
Klassificér dette dagsordenspunkt fra ${sag.udvalg}.

Titel: ${sag.titel}
Indhold: ${(sag.indhold || '').substring(0, 3000)}

Svar KUN med valid JSON:
{
  "kategori": "turisme|erhverv|kultur|klima|infrastruktur|bosætning|events|budget|partnerskaber|andet",
  "relevans_score": <1-5 hvor 5=direkte relevant for turisme/erhverv>,
  "resumé": "<2-3 sætningers resumé>",
  "relevans_begrundelse": "<kort begrundelse for relevans for VisitMiddelfart>",
  "foreslaaet_handling": "ingen handling|overvåg|afklar|reager|foreslå møde|lever input"
}`,
          },
        ],
      });

      const text = message.content[0].type === 'text' ? message.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const classification = JSON.parse(jsonMatch[0]);
        const sagData = {
          ...classification,
          status: classification.foreslaaet_handling || 'overvåg',
          klassificeret: new Date().toISOString(),
        };

        // Gem i KV
        await kvSet(`sag:${sag.id}`, sagData, 90 * 24 * 60 * 60);

        results.push({ id: sag.id, ...sagData });
      }
    } catch (e: any) {
      results.push({
        id: sag.id,
        kategori: 'andet',
        relevans_score: 1,
        resumé: 'Kunne ikke klassificeres',
        relevans_begrundelse: e.message,
        foreslaaet_handling: 'overvåg',
        status: 'overvåg',
      });
    }
  }

  res.status(200).json({ results });
}
