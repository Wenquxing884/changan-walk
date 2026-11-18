import { test, expect } from '@playwright/test';

async function openGarden(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?test=1');
  await page.waitForFunction(() => window.__CHANGAN__?.snapshot().ready, null, { timeout: 90_000 });
  await page.locator('.destination-nav [data-destination="garden"]').click();
  await page.waitForFunction(() => {
    const state = window.__CHANGAN__.snapshot();
    return state.location === 'garden' && !state.transitioning;
  });
  return errors;
}

async function walkTo(page, x, z, timeout = 20_000) {
  await page.evaluate(([x, z]) => window.__CHANGAN__.facePlayer(x, z), [x, z]);
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(([x, z]) => {
      const p = window.__CHANGAN__.snapshot().position;
      return Math.hypot(p[0] - x, p[2] - z) < .45;
    }, [x, z], { timeout });
  } finally { await page.keyboard.up('w'); }
}

test('the garden bridge crosses both banks and visitors cannot walk through the water', async ({ page }, testInfo) => {
  const errors = await openGarden(page);
  const inventory = await page.evaluate(() => window.__CHANGAN__.snapshot().asset.garden);
  expect(inventory.bridgeLength).toBeGreaterThanOrEqual(60);
  expect(inventory.pavilions).toBe(2);
  expect(inventory.lilyPads).toBeGreaterThanOrEqual(40);
  await page.evaluate(() => window.__CHANGAN__.setPlayerPosition(128, -85.2));
  await walkTo(page, 128, -116);
  const onBridge = await page.evaluate(() => window.__CHANGAN__.snapshot());
  expect(onBridge.position[1]).toBeGreaterThan(4.4);
  expect(onBridge.location).toBe('garden');
  await page.screenshot({ path: testInfo.outputPath('garden-bridge.png') });
  await walkTo(page, 128, -158);
  expect((await page.evaluate(() => window.__CHANGAN__.snapshot())).position[1]).toBeCloseTo(2.08, 1);
  await walkTo(page, 128, -85.2);

  // Walk directly toward the pool from its open southern bank. The pool's
  // collision follows the shoreline, leaving only the real bridge traversable.
  await page.evaluate(() => {
    const app = window.__CHANGAN__;
    app.setPlayerPosition(137, -86);
    app.facePlayer(137, -123);
  });
  await page.keyboard.down('w');
  try { await page.waitForTimeout(3800); } finally { await page.keyboard.up('w'); }
  const stopped = await page.evaluate(() => window.__CHANGAN__.snapshot());
  expect(stopped.position[2], 'The visitor must stop on the bank rather than crossing open water.').toBeGreaterThan(-101);
  expect(errors).toEqual([]);
});

test('the long covered gallery connects its turns and both open pavilions', async ({ page }, testInfo) => {
  const errors = await openGarden(page);
  await page.evaluate(() => window.__CHANGAN__.setPlayerPosition(105.5, -87));
  for (const [x, z] of [[105.5, -154], [105.5, -158], [128, -158], [147, -158], [147, -143]]) {
    await walkTo(page, x, z);
    expect((await page.evaluate(() => window.__CHANGAN__.snapshot())).position[1]).toBeCloseTo(2.08, 1);
  }
  await page.screenshot({ path: testInfo.outputPath('garden-pavilion.png') });
  const inventory = await page.evaluate(() => window.__CHANGAN__.snapshot().asset.garden);
  expect(inventory.galleryLength).toBeGreaterThan(110);
  expect(inventory.galleryBays).toBeGreaterThanOrEqual(24);
  await page.locator('.destination-nav [data-destination="overview"]').click();
  await page.waitForFunction(() => window.__CHANGAN__.snapshot().mode === 'overview' && !window.__CHANGAN__.snapshot().transitioning);
  expect(errors).toEqual([]);
});
