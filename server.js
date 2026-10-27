const http = require('http'), fs = require('fs'), path = require('path');
const { fetchAll } = require('./lib/sources');
const { checkMany } = require('./lib/checker');
const { generate, APPS, MODES } = require('./lib/generate');
const { TEMPLATES, autoFix } = require('./lib/payload');

const PORT = process.env.PORT || 3000;
const TTL = (+process.env.CACHE_MINUTES || 12) * 60 * 1000;
const MAX_CHECK = +process.env.MAX_CHECK || 150;
const RATE = +process.env.RATE_LIMIT_PER_MIN || 60;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

let cache = { ts: 0, servers: [], errors: [] }, inflight = null;

async function getServers(force) {
  if (!force && cache.servers.length && Date.now() - cache.ts < TTL) return { ...cache, cached: true };
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const { servers, errors } = await fetchAll();
      if (!servers.length) {
        return { ...cache, errors, cached: true, stale: true };
      }
      const pick = servers.sort(() => Math.random() - 0.5).slice(0, MAX_CHECK);
      const online = await checkMany(pick);
      cache = { ts: Date.now(), servers: online, errors, total: servers.length };
      return { ...cache, cached: false };
    } finally { inflight = null; }
  })();
  return inflight;
}

const hits = new Map();
function limited(ip) {
  const now = Date.now(), h = hits.get(ip);
  if (!h || now > h.reset) { hits.set(ip, { n: 1, reset: now + 60000 }); return false; }
  return ++h.n > RATE;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (n > v.reset) hits.delete(k); }, 60000).unref();

const send = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, no) => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e5) { req.destroy(); no(new Error('too large')); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(new Error('bad json')); } }); });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x'), ip = req.socket.remoteAddress;
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST' }); return res.end(); }
    if (url.pathname === '/health') return send(res, 200, { status: 'ok', cachedServers: cache.servers.length, cacheAgeSec: cache.ts ? Math.round((Date.now() - cache.ts) / 1000) : null });
    if (url.pathname.startsWith('/api/')) {
      if (limited(ip)) return send(res, 429, { error: 'Too many requests, slow down.' });
      if (url.pathname === '/api/servers' && req.method === 'GET') {
        const r = await getServers(url.searchParams.get('refresh') === '1');
        const proto = url.searchParams.get('protocol');
        const list = proto ? r.servers.filter(s => s.protocol === proto) : r.servers;
        return send(res, 200, { servers: list.map(({ raw, ...s }) => ({ ...s, raw })), errors: r.errors, cached: !!r.cached, stale: !!r.stale, updated: r.ts });
      }
      if (url.pathname === '/api/meta') return send(res, 200, { apps: APPS, modes: MODES, templates: TEMPLATES });
      if (url.pathname === '/api/generate' && req.method === 'POST') return send(res, 200, generate(await body(req)));
      if (url.pathname === '/api/fix' && req.method === 'POST') {
        const b = await body(req);
        if (!b.host || !b.port) return send(res, 400, { error: 'host and port required' });
        return send(res, 200, await autoFix(b));
      }
      return send(res, 404, { error: 'not found' });
    }
    let f = path.normalize(path.join(PUB, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!f.startsWith(PUB)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
  } catch (e) { send(res, 500, { error: e.message }); }
});
process.on('unhandledRejection', e => console.error('unhandled:', e));
process.on('uncaughtException', e => console.error('uncaught:', e));
if (require.main === module) server.listen(PORT, () => console.log('TunnelForge on :' + PORT));
module.exports = { server, getServers };
