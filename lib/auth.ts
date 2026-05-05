import type { VercelRequest, VercelResponse } from '@vercel/node';

export function checkAuth(req: VercelRequest, res: VercelResponse): boolean {
  const token = req.headers['x-access-token'] as string;
  const expected = process.env.APP_ACCESS_TOKEN;
  if (!expected) {
    console.error('APP_ACCESS_TOKEN is not configured — denying request');
    res.status(500).json({ error: 'Server misconfigured: auth token not set' });
    return false;
  }
  if (token === expected) return true;
  res.status(401).json({ error: 'Adgangskode påkrævet' });
  return false;
}
