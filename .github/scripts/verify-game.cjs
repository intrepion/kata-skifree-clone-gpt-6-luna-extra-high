const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const port = process.env.ARCADE_CI_PORT || '4173';
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('requestfailed', request => { if (request.resourceType() === 'script') failures.push('Script failed to load: ' + request.url()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' && url.port === port ? route.continue() : route.abort();
  });
  try {
    const response = await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
    assert.ok(response && response.ok(), 'Game page did not load');
    await page.waitForTimeout(1000);
    const view = await page.evaluate(() => ({ text: document.body.innerText.trim().length, canvas: [...document.querySelectorAll('canvas')].some(c => c.width > 0 && c.height > 0), buttons: document.querySelectorAll('button').length }));
    assert.ok(view.text > 0 || view.canvas || view.buttons, 'Game rendered no content');
    const start = page.getByRole('button', { name: /^(start|play|begin|new game|start game|play game)$/i }).first();
    if (await start.isVisible().catch(() => false) && await start.isEnabled()) { await start.click(); await page.waitForTimeout(500); }
    assert.deepEqual(failures, [], 'Game raised an uncaught browser error');
    console.log('Game served, rendered, and initialized without uncaught errors', view);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
