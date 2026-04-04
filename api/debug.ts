import type { VercelRequest, VercelResponse } from '@vercel/node';
import dns from 'dns';
import https from 'https';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results: any = {};

  // 1. DNS lookup
  try {
    const addresses = await new Promise<string[]>((resolve, reject) => {
      dns.resolve4('dagsordener.middelfart.dk', (err, addrs) => {
        if (err) reject(err); else resolve(addrs);
      });
    });
    results.dns = addresses;
  } catch (e: any) {
    results.dns_error = e.message;
  }

  // 2. Try HTTPS connection
  try {
    const data = await new Promise<string>((resolve, reject) => {
      const req = https.get('https://dagsordener.middelfart.dk/api/agenda/udvalgsliste', {
        rejectUnauthorized: false,
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      }, (res) => {
        let body = '';
        res.on('data', (c) => body += c);
        res.on('end', () => resolve(`status=${res.statusCode} location=${res.headers.location || 'none'} len=${body.length} first100=${body.substring(0, 100)}`));
      });
      req.on('error', (e) => reject(e));
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    results.https = data;
  } catch (e: any) {
    results.https_error = e.message;
  }

  // 3. Try with http module (port 80)
  try {
    const http = require('http');
    const data = await new Promise<string>((resolve, reject) => {
      const req = http.get('http://dagsordener.middelfart.dk/api/agenda/udvalgsliste', {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      }, (res: any) => {
        let body = '';
        res.on('data', (c: any) => body += c);
        res.on('end', () => resolve(`status=${res.statusCode} headers=${JSON.stringify(res.headers).substring(0, 200)}`));
      });
      req.on('error', (e: any) => reject(e));
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    });
    results.http = data;
  } catch (e: any) {
    results.http_error = e.message;
  }

  res.status(200).json(results);
}
