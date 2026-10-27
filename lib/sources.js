const { textToServers } = require('./parse');
const { sleep } = require('./util');
const UAS = [
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Chrome/118.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/119.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 Version/16.6 Mobile Safari/604.1',
  'v2rayNG/1.8.5'
];
const ua = () => UAS[Math.floor(Math.random() * UAS.length)];

async function fetchText(url, { retries = 3, timeout = 10000 } = {}) {
  let err;
  for (let i = 0; i <= retries; i++) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), timeout);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': ua() }, signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { clearTimeout(t); err = e; if (i < retries) await sleep(400 * 2 ** i); }
  }
  throw err;
}

const DEFAULTS = [
  'https://raw.githubusercontent.com/barry-far/V2ray-Configs/main/All_Configs_Sub.txt',
  'https://raw.githubusercontent.com/Pawdroid/Free-servers/main/sub',
  'https://raw.githubusercontent.com/ermaozi/get_subscribe/main/subscribe/v2ray.txt'
];
const urls = () => (process.env.SOURCES ? process.env.SOURCES.split(',').map(s => s.trim()).filter(Boolean) : DEFAULTS);
const makeSource = url => ({ name: url, async fetch() { return textToServers(await fetchText(url)); } });

async function fetchAll() {
  const sources = urls().map(makeSource);
  const res = await Promise.allSettled(sources.map(s => s.fetch()));
  const seen = new Set(), servers = [], errors = [];
  res.forEach((r, i) => {
    if (r.status === 'fulfilled') r.value.forEach(s => { if (!seen.has(s.id)) { seen.add(s.id); servers.push(s); } });
    else errors.push({ source: sources[i].name, error: String(r.reason && r.reason.message || r.reason) });
  });
  return { servers, errors };
}
module.exports = { fetchAll, fetchText };
