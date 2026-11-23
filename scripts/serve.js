// Zero-dependency static server for local development only.
// Default: binds to 127.0.0.1 (this computer only).
// `npm run phone` (or `node scripts/serve.js --lan`) also listens on the home network,
// so a phone on the same Wi-Fi can open the printed address. Stop with Ctrl+C.
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const LAN = process.argv.includes('--lan');
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  // A malformed address (e.g. "/%E0%A4%A") is refused; it used to throw here and stop the whole server.
  let urlPath;
  try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const filePath = normalize(join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  // Block path traversal and hidden files such as .env or .git. The check is by path, not by text: "/..%2Fname-x"
  // decodes to a sibling folder whose name merely starts with this one's (e.g. tisa-trip-os-old), which startsWith let through.
  const rel = relative(ROOT, filePath);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || /(^|[\\/])\./.test(rel)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

function lanAddresses() {
  return Object.values(networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => n.address);
}

server.listen(PORT, HOST, () => {
  console.log(`TISA running at http://localhost:${PORT}  (Ctrl+C to stop)`);
  if (!LAN) return;
  const ips = lanAddresses();
  if (!ips.length) console.log('No home-network address found. Is this computer on Wi-Fi?');
  for (const ip of ips) console.log(`On your phone (same Wi-Fi): http://${ip}:${PORT}`);
  console.log('Only devices on your own network can reach it. Stop the server when you are done.');
});
