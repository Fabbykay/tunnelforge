const b64d = s => { s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''); while (s.length % 4) s += '='; return Buffer.from(s, 'base64').toString('utf8'); };
const splitHP = hp => { const i = hp.lastIndexOf(':'); return [hp.slice(0, i).replace(/^\[|\]$/g, ''), parseInt(hp.slice(i + 1), 10)]; };
function flagToCC(str) {
  const m = (str || '').match(/[\u{1F1E6}-\u{1F1FF}]{2}/u);
  if (!m) return '';
  return [...m[0]].map(c => String.fromCharCode(c.codePointAt(0) - 0x1F1E6 + 65)).join('');
}
function finish(o) {
  if (!o.host || !Number.isInteger(o.port) || o.port < 1 || o.port > 65535) return null;
  o.country = o.country || flagToCC(o.name) || '';
  o.expiry = o.expiry || 'unknown';
  o.id = [o.protocol, o.host, o.port, o.uuid || o.user || o.password || ''].join('|');
  return o;
}
function parseUri(line) {
  line = (line || '').trim();
  if (!line) return null;
  try {
    if (line.startsWith('vmess://')) {
      const j = JSON.parse(b64d(line.slice(8)));
      return finish({ protocol: 'vmess', host: j.add, port: +j.port, uuid: j.id, name: j.ps || '', net: j.net || 'tcp',
        tls: j.tls === 'tls', sni: j.sni || j.host || '', hostHeader: j.host || '', path: j.path || '/', raw: line });
    }
    if (/^(vless|trojan):\/\//.test(line)) {
      const u = new URL(line), p = u.searchParams, protocol = u.protocol.slice(0, -1);
      const sec = p.get('security');
      return finish({ protocol, host: u.hostname.replace(/^\[|\]$/g, ''), port: +u.port || 443,
        uuid: protocol === 'vless' ? decodeURIComponent(u.username) : undefined,
        password: protocol === 'trojan' ? decodeURIComponent(u.username) : undefined,
        name: decodeURIComponent(u.hash.slice(1)), net: p.get('type') || 'tcp',
        tls: protocol === 'trojan' ? sec !== 'none' : (sec === 'tls' || sec === 'reality'),
        sni: p.get('sni') || p.get('host') || '', hostHeader: p.get('host') || '', path: p.get('path') || '/', raw: line });
    }
    if (line.startsWith('ss://')) {
      let rest = line.slice(5), name = '';
      const h = rest.indexOf('#'); if (h >= 0) { name = decodeURIComponent(rest.slice(h + 1)); rest = rest.slice(0, h); }
      rest = rest.split('?')[0].replace(/\/$/, '');
      let cred, hp;
      if (rest.includes('@')) { const i = rest.lastIndexOf('@'); cred = rest.slice(0, i); hp = rest.slice(i + 1); if (!cred.includes(':')) cred = b64d(cred); }
      else { const d = b64d(rest), i = d.lastIndexOf('@'); cred = d.slice(0, i); hp = d.slice(i + 1); }
      const ci = cred.indexOf(':'); const [host, port] = splitHP(hp);
      return finish({ protocol: 'ss', host, port, method: cred.slice(0, ci), password: cred.slice(ci + 1), name, net: 'tcp', tls: false, raw: line });
    }
    if (line.startsWith('ssh://')) {
      const u = new URL(line);
      return finish({ protocol: 'ssh', host: u.hostname, port: +u.port || 22, user: decodeURIComponent(u.username), password: decodeURIComponent(u.password),
        name: decodeURIComponent(u.hash.slice(1)), net: 'tcp', tls: false, raw: line });
    }
    const m = line.match(/^([\w.-]+):(\d{1,5})@([^:\s]+):(\S+)$/);
    if (m) return finish({ protocol: 'ssh', host: m[1], port: +m[2], user: m[3], password: m[4], name: '', net: 'tcp', tls: false });
  } catch (e) { }
  return null;
}
function textToServers(text) {
  let t = (text || '').trim();
  const first = t.split(/\r?\n/)[0] || '';
  if (!/:\/\//.test(first) && !/@/.test(first)) { try { const d = b64d(t); if (d.includes('://')) t = d; } catch (e) {} }
  const seen = new Set(), out = [];
  for (const l of t.split(/\r?\n/)) { const s = parseUri(l); if (s && !seen.has(s.id)) { seen.add(s.id); out.push(s); } }
  return out;
}
module.exports = { parseUri, textToServers, b64d };
