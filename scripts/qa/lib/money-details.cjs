// 1.0.1: the categories, the template ("load a profile") and the amounts dialog live under "details" on the money
// screen, folded by default (owner, 2026-11-22). Older browser scripts open it the way a user does, by tapping its
// summary, before they touch anything inside. No-op when it is already open or not on screen.
async function openMoneyDetails(page) {
  const sel = '#panel-money [data-slot="money-details"]';
  await page.waitForFunction(() => !document.querySelector('#panel-money').hidden);
  const open = await page.locator(sel).evaluate((d) => d.open).catch(() => null);
  if (open === false) {
    await page.click(`${sel} > summary`);
    await page.waitForFunction((s) => document.querySelector(s).open, sel);
  }
}

module.exports = { openMoneyDetails };
