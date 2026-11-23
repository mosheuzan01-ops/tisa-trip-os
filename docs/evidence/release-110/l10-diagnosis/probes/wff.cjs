// Does page.waitForFunction wait for the value an async predicate resolves to, or for the Promise itself?
const { chromium } = require(require.resolve('playwright', { paths: ['/home/user/tisa-trip-os'] }));
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const out = {};
  let t = Date.now();
  try { await p.waitForFunction(async () => false, null, { timeout: 2000 }); out.asyncFalse = `resolved after ${Date.now() - t}ms`; } catch (e) { out.asyncFalse = `timed out after ${Date.now() - t}ms`; }
  t = Date.now();
  try { await p.waitForFunction(() => false, null, { timeout: 2000 }); out.syncFalse = `resolved after ${Date.now() - t}ms`; } catch (e) { out.syncFalse = `timed out after ${Date.now() - t}ms`; }
  t = Date.now();
  const h = await p.waitForFunction(async () => undefined, null, { timeout: 2000 }).catch((e) => null);
  out.asyncUndefinedReturns = h ? String(await h.jsonValue().catch(() => '(not serialisable)')) : 'timeout';
  console.log(JSON.stringify({ playwright: require(require.resolve('playwright/package.json', { paths: ['/home/user/tisa-trip-os'] })).version, chromium: b.version(), ...out }, null, 1));
  await b.close();
})();
