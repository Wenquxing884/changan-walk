import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('screenshots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11'] });
const results = { capturedAt: new Date().toISOString(), viewport: { width: 1440, height: 1000 }, errors: [], views: {} };
try {
  const page = await browser.newPage({ viewport: results.viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => results.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') results.errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5175/?test=1');
  await page.waitForFunction(() => window.__CHANGAN__?.snapshot().ready && window.__CHANGAN__.snapshot().asset?.palaceLoaded && window.__CHANGAN__.snapshot().asset?.palaceLowLoaded);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__CHANGAN__.setAnimationEnabled(false));

  const capture = async (name, destination, setup) => {
    if (setup) await page.evaluate(setup);
    else {
      await page.evaluate(id => window.__CHANGAN__.goTo(id), destination);
      await page.waitForFunction(id => { const state = window.__CHANGAN__.snapshot(); return state.location === id && !state.transitioning; }, destination);
      await page.waitForTimeout(350);
    }
    await page.waitForTimeout(250);
    const state = await page.evaluate(() => window.__CHANGAN__.snapshot());
    await page.screenshot({ path: `screenshots/v3-${name}.png` });
    results.views[name] = { mode: state.mode, location: state.location, position: state.position, target: state.target,
      lod: state.asset.palaceLOD, palaceSource: state.asset.palaceSource, palaceHighTriangles: state.asset.palaceHighTriangles,
      palaceLowTriangles: state.asset.palaceLowTriangles, palaceShadowTriangles: state.asset.palaceShadowTriangles,
      renderer: state.renderer };
  };

  await capture('overview', 'overview');
  await capture('market', 'market');
  await capture('palace-frontal', 'palace');
  await capture('palace-stairs', null, () => {
    const app = window.__CHANGAN__;
    app.setPlayerPosition(6.2, -90, 0);
    app.facePlayer(6.2, -160);
  });
  await capture('palace-interior', 'interior');
  await writeFile('screenshots/v3-review.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
