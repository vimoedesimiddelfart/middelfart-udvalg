import type { VercelRequest, VercelResponse } from '@vercel/node';
import { kv } from '@vercel/kv';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { sag_id, vores_input, tjekket_ind_af, status } = req.body;
  if (!sag_id) return res.status(400).json({ error: 'sag_id required' });

  try {
    const existing = (await kv.get<any>(`sag:${sag_id}`)) || {};
    const updated = {
      ...existing,
      vores_input: vores_input || existing.vores_input || '',
      tjekket_ind_af: tjekket_ind_af || existing.tjekket_ind_af || '',
      tjekket_ind_dato: new Date().toISOString(),
      status: status || existing.status || 'afklar',
    };

    await kv.set(`sag:${sag_id}`, updated, { ex: 90 * 24 * 60 * 60 });
    res.status(200).json({ ok: true, data: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
}
