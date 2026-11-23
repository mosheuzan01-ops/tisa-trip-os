// Diagnostic proxy: listens on PORT (the QA script's own port, so the script's own server cannot bind and the script talks
// to this proxy), forwards to scripts/serve.js on UP, and delays only the Supabase vendor bundle (fetched only by the SW
// precache, never by the page at boot) by DELAY ms. It simulates a slow SW install. App and test code untouched.
const http = require('node:http'); const { spawn } = require('node:child_process');
const PORT = Number(process.env.PORT), UP = PORT + 1000, DELAY = Number(process.env.DELAY ?? 1500);
const up = spawn(process.execPath, ['/home/user/tisa-trip-os/scripts/serve.js'], { cwd: '/home/user/tisa-trip-os', env: { ...process.env, PORT: String(UP) }, stdio: 'ignore' });
let delayed = 0;
http.createServer((req, res) => {
  const go = () => { const u = http.request({ host: '127.0.0.1', port: UP, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }); u.on('error', () => res.destroy()); req.pipe(u); };
  if (process.env.MUT === 'nofetch' && req.url.split('?')[0] === '/sw.js') {
    // Mutant: the served sw.js has no fetch handler (a worker that installs and activates but never answers offline).
    const src = require('node:fs').readFileSync('/home/user/tisa-trip-os/sw.js', 'utf8').replace("self.addEventListener('fetch'", "self.addEventListener('fetch-disabled'");
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(src); return;
  }
  if (req.url.includes('/vendor/supabase/')) { delayed++; setTimeout(go, DELAY); } else go();
}).listen(PORT, '127.0.0.1', () => console.log(`slow proxy on ${PORT} -> ${UP}, delay ${DELAY}ms on /vendor/supabase/`));
process.on('SIGTERM', () => { console.log(`delayed requests: ${delayed}`); up.kill(); process.exit(0); });
