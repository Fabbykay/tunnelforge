const sleep = ms => new Promise(r => setTimeout(r, ms));
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = null; } } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
module.exports = { sleep, pool };
