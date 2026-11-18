import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('screenshots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11'] });
const report = { capturedAt: new Date().toISOString(), viewport: { width: 1440, height: 1000 }, errors: [], views: {} };
try {
  const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5175/?test=1');
  await page.waitForFunction(() => window.__CHANGAN__?.snapshot().ready, null, { timeout: 90_000 });
  await page.evaluate(() => window.__CHANGAN__.setAnimationEnabled(false));
  const visit = async id => {
    await page.evaluate(id => window.__CHANGAN__.goTo(id), id);
    await page.waitForFunction(id => {
      const state = window.__CHANGAN__.snapshot();
      return state.location === id && !state.transitioning;
    }, id);
    await page.waitForTimeout(600);
  };
  const capture = async name => {
    await page.waitForTimeout(350);
    await page.screenshot({ path: `screenshots/v4-${name}.png` });
    report.views[name] = await page.evaluate(() => window.__CHANGAN__.snapshot());
  };
  await capture('overview');
  await visit('garden');
  await capture('garden-entry');
  await page.evaluate(() => { const app = window.__CHANGAN__; app.setPlayerPosition(128, -111); app.facePlayer(128, -158); });
  await capture('garden-bridge');
  await page.evaluate(() => { const app = window.__CHANGAN__; app.setPlayerPosition(105.5, -111); app.facePlayer(105.5, -158); });
  await capture('garden-gallery');
  await page.evaluate(() => { const app = window.__CHANGAN__; app.setPlayerPosition(128, -154.5); app.facePlayer(128, -116); });
  await capture('garden-pavilion');
  await visit('overview');
  await page.evaluate(() => {
    const app = window.__CHANGAN__;
    app.camera.position.set(185, 77, -57);
    app.controls.target.set(127, 0, -124);
    app.controls.update();
  });
  await capture('garden-aerial');
  await visit('market');
  await capture('market');
  const doorId = await page.evaluate(() => {
    const app = window.__CHANGAN__, door = app.doors.find(d => d.kind === 'shop');
    app.setPlayerPosition(door.position.x + door.normal.x * 2.2, door.position.z + door.normal.z * 2.2);
    app.facePlayer(door.position.x - door.normal.x * 3, door.position.z - door.normal.z * 3);
    return door.id;
  });
  await page.waitForTimeout(700);
  await capture('door-closed');
  await page.evaluate(id => window.__CHANGAN__.interactDoor(id), doorId);
  await page.waitForTimeout(1300);
  await capture('door-open');
  await visit('palace');
  await capture('palace');
  assert.deepEqual(report.errors, [], 'No GPU shader, console or page errors should occur while touring the expanded city.');
} finally {
  await browser.close();
  await writeFile('screenshots/v4-review.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ views: Object.keys(report.views), errors: report.errors, output: 'screenshots/v4-review.json' }, null, 2));
