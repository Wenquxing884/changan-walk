import { test, expect } from '@playwright/test';

async function openPalace(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?test=1');
  await page.waitForFunction(() => window.__CHANGAN__?.snapshot().ready && window.__CHANGAN__.snapshot().asset?.palaceLoaded, null, { timeout: 90_000 });
  const manifest = await page.evaluate(async () => (await fetch('/assets/palace-layout.json')).json());
  return { errors, manifest };
}

test('the narrower ceremonial ramp keeps continuous center travel and stepped side heights', async ({ page }) => {
  const { manifest } = await openPalace(page);
  expect(manifest.ceremonialRampWidth).toBe(4);
  const heights = await page.evaluate(async manifest => {
    const { getPalaceHeight } = await import('/src/palace-layout.js');
    return manifest.stairFlights.map(flight => {
      const run = flight.startZ - flight.endZ;
      const stepRun = run / flight.steps;
      const stepRise = (flight.endHeight - flight.startHeight) / flight.steps;
      const side = Array.from({ length: flight.steps }, (_, index) => {
        const z = flight.startZ - (index + .5) * stepRun;
        return getPalaceHeight(3, z);
      });
      const ramp = Array.from({ length: 5 }, (_, index) => {
        const z = flight.startZ - index * run / 4;
        return getPalaceHeight(0, z);
      });
      return { flight, side, ramp, stepRise };
    });
  }, manifest);

  for (const { flight, side, ramp, stepRise } of heights) {
    expect(side).toHaveLength(flight.steps);
    side.forEach((height, index) => expect(height).toBeCloseTo(flight.startHeight + (index + 1) * stepRise, 4));
    ramp.forEach((height, index) => expect(height).toBeCloseTo(flight.startHeight + index * (flight.endHeight - flight.startHeight) / 4, 4));
  }
});

async function beginSampling(page) {
  await page.evaluate(() => {
    window.__PALACE_WALK_SAMPLES__ = [];
    window.__PALACE_WALK_ACTIVE__ = true;
    const frame = () => {
      const state = window.__CHANGAN__.snapshot();
      window.__PALACE_WALK_SAMPLES__.push({ position: state.position, frame: state.renderer.frame, inside: state.insideBuilding?.id ?? null });
      if (window.__PALACE_WALK_ACTIVE__) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

async function endSampling(page) {
  return page.evaluate(() => { window.__PALACE_WALK_ACTIVE__ = false; return window.__PALACE_WALK_SAMPLES__; });
}

test('the ceremonial stair flights can be walked all the way up and back down', async ({ page }, testInfo) => {
  const { errors, manifest } = await openPalace(page);
  expect(manifest.floorHeight).toBeGreaterThanOrEqual(8.5);
  await page.evaluate(() => {
    const app = window.__CHANGAN__; app.setPlayerPosition(0, -80); app.facePlayer(0, -180);
  });
  await beginSampling(page);
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(() => window.__CHANGAN__.snapshot().position[2] < -145.5, null, { timeout: 25_000 });
  } finally { await page.keyboard.up('w'); }
  await page.waitForTimeout(250);
  const ascent = await endSampling(page);
  expect((await page.evaluate(() => window.__CHANGAN__.snapshot())).insideBuilding?.id).toBe('palace-hall');
  expect(ascent.at(-1).position[1]).toBeGreaterThan(10.2);
  expect(Math.max(...ascent.map(sample => Math.abs(sample.position[0])))).toBeLessThan(.05);
  expect(Math.min(...ascent.slice(1).map((sample, index) => sample.position[1] - ascent[index].position[1]))).toBeGreaterThan(-.06);
  expect(Math.max(...ascent.slice(1).map((sample, index) => sample.position[1] - ascent[index].position[1]))).toBeLessThan(.65);
  for (const tier of manifest.landings) {
    const low = tier.endZ + 1.2, high = tier.startZ - 1.2, expectedHeight = tier.height + 1.68;
    const landing = ascent.filter(sample => sample.position[2] > low && sample.position[2] < high).map(sample => sample.position[1]);
    expect(landing.length, 'Each landing must be encountered during continuous walking.').toBeGreaterThan(3);
    expect(Math.max(...landing) - Math.min(...landing), 'A stair landing must remain level.').toBeLessThan(.3);
    expect(Math.max(...landing)).toBeCloseTo(expectedHeight, 0);
  }

  await beginSampling(page);
  await page.keyboard.down('s');
  try {
    await page.waitForFunction(() => window.__CHANGAN__.snapshot().position[2] > -80.5, null, { timeout: 25_000 });
  } finally { await page.keyboard.up('s'); }
  await page.waitForTimeout(300);
  const descent = await endSampling(page);
  expect(descent.at(-1).position[1]).toBeLessThan(2.1);
  expect(Math.max(...descent.slice(1).map((sample, index) => sample.position[1] - descent[index].position[1]))).toBeLessThan(.06);
  await testInfo.attach('palace-stair-walk.json', { body: JSON.stringify({ manifest, ascent, descent }, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});

test('a palace interior destination exits through the front doorway before ascending', async ({ page }, testInfo) => {
  const { errors, manifest } = await openPalace(page);
  await page.evaluate(() => window.__CHANGAN__.goTo('interior'));
  await page.waitForFunction(() => { const state = window.__CHANGAN__.snapshot(); return state.location === 'interior' && !state.transitioning; });
  const result = await page.evaluate(async manifest => {
    const app = window.__CHANGAN__;
    const samples = [app.snapshot().position];
    app.goTo('overview');
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const frame = () => {
        const state = app.snapshot(); samples.push(state.position);
        if (!state.transitioning && state.location === 'overview') return resolve();
        if (performance.now() - started > 20_000) return reject(new Error('Palace exit timed out.'));
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const centerZ = manifest.worldPosition?.[2] ?? -154;
    const entranceZ = centerZ + (manifest.entrance?.localZ ?? 15.5);
    return { samples, entranceZ, final: app.snapshot() };
  }, manifest);
  const crossingIndex = result.samples.findIndex((position, index) => index > 0 && position[2] >= result.entranceZ && result.samples[index - 1][2] < result.entranceZ);
  expect(crossingIndex, 'The camera must cross the south doorway before flying toward overview.').toBeGreaterThan(0);
  const crossing = result.samples[crossingIndex];
  expect(Math.abs(crossing[0])).toBeLessThan((manifest.entrance?.width ?? 12) / 2 - .3);
  expect(crossing[1], 'The camera must remain below the upper doorway until outside.').toBeLessThan(manifest.floorHeight + manifest.entrance.height - .3);
  expect(result.final.mode).toBe('overview');
  await testInfo.attach('palace-exit-path.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(errors).toEqual([]);
});
