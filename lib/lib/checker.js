const net = require('net'), tls = require('tls');
const { pool } = require('./util');

function tcpCheck(host, port, timeout = 4000) {
  return new Promise(res => {
    const t0 = Date.now(), s = net.connect({ host, port }); let done = false;
    const fin = (ok, err) => { if (done) return; done = true; s.destroy(); res({ ok, ms: Date.now() - t0, err }); };
    s.setTimeout(timeout, () => fin(false, 'timeout'));
    s.once('connect', () => fin(true));
    s.once('error', e => fin(false, e.code || e.message));
  });
}
function tlsCheck(host, port, sni, timeout = 5000) {
  return new Promise(res => {
    const t0 = Date.now(); let done = false;
    const s = tls.connect({ host, port, servername: sni || host, rejectUnauthorized: false });
    const fin = (ok, err) => { if (done) return; done = true; s.destroy(); res({ ok, ms: Date.now() - t0, err }); };
    s.setTimeout(timeout, () => fin(false, 'timeout'));
    s.once('secureConnect', () => fin(true));
    s.once('error', e => fin(false, e.code || e.message));
  });
}
function probe({ host, port, tls: useTls, sni, payload, timeout = 5000 }) {
  return new Promise(res => {
    const t0 = Date.now(); let done = false, buf = '';
    const fin = (code, err) => { if (done) return; done = true; try { s.destroy(); } catch (e) {} res({ code, err, ms: Date.now() - t0 }); };
    const s = useTls ? tls.connect({ host, port, servername: sni || host, rejectUnauthorized: false }) : net.connect({ host, port });
    s.setTimeout(timeout, () => fin(null, 'timeout'));
    s.once('error', e => fin(null, e.code || e.message));
    s.on('data', d => { buf += d.toString('latin1'); const m = buf.match(/HTTP\/\d(?:\.\d)?\s+(\d{3})/); if (m) fin(+m[1]); else if (buf.length > 4096) fin(null, 'no-http'); });
    s.once('close', () => fin(null, 'closed'));
    s.once(useTls ? 'secureConnect' : 'connect', () => s.write(payload));
  });
}
async function checkServer(s) {
  const needTls = s.tls || s.protocol === 'trojan' || s.port === 443;
  const t = await tcpCheck(s.host, s.port);
  if (!t.ok) return { ...s, online: false, latency: null, reason: t.err };
  let latency = t.ms, tlsOk = null;
  if (needTls) { const h = await tlsCheck(s.host, s.port, s.sni || s.host); tlsOk = h.ok; if (h.ok) latency = Math.max(latency, h.ms); else if (s.tls || s.protocol === 'trojan') return { ...s, online: false, latency: null, reason: 'tls:' + h.err }; }
  let httpCode = null;
  if (s.protocol !== 'ssh' && s.protocol !== 'ss') {
    const host = s.hostHeader || s.sni || s.host;
    const p = await probe({ host: s.host, port: s.port, tls: !!needTls && tlsOk, sni: s.sni || s.host,
      payload: `GET ${s.path || '/'} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`, timeout: 4000 });
    httpCode = p.code;
  }
  return { ...s, online: true, latency, tlsOk, httpCode };
}
async function checkMany(servers, concurrency = 40) {
  const r = await pool(servers, concurrency, checkServer);
  return r.filter(x => x && x.online).sort((a, b) => a.latency - b.latency);
}
module.exports = { tcpCheck, tlsCheck, probe, checkServer, checkMany };
