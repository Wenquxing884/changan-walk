import { test, expect } from '@playwright/test';

const appState = (page) => page.evaluate(() => window.__CHANGAN__.snapshot());

async function openCity(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?test=1');
  await page.waitForFunction(() => {
    const state = window.__CHANGAN__?.snapshot();
    return state?.ready && state.renderer?.frame >= 2 && !state.transitioning;
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1100);
  return errors;
}

async function visit(page, destination) {
  await page.locator(`.destination-nav [data-destination="${destination}"]`).click();
  await page.waitForFunction((expected) => {
    const state = window.__CHANGAN__.snapshot();
    return state.ready && state.location === expected && !state.transitioning;
  }, destination);
  await page.waitForTimeout(1000);
}

async function ensureWalking(page) {
  const state = await appState(page);
  if (state.mode !== 'walk') {
    await page.getByTestId('walk-toggle').click();
    await page.waitForFunction(() => window.__CHANGAN__.snapshot().mode === 'walk');
  }
}

async function canvasColourStats(page) {
  const canvas = page.locator('canvas').first();
  const png = await canvas.screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const sample = document.createElement('canvas');
    sample.width = 120;
    sample.height = 80;
    const context = sample.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, sample.width, sample.height);
    const data = context.getImageData(0, 0, sample.width, sample.height).data;
    const colours = new Set();
    let minimum = 255;
    let maximum = 0;
    for (let i = 0; i < data.length; i += 4) {
      colours.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
      const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
      minimum = Math.min(minimum, luma);
      maximum = Math.max(maximum, luma);
    }
    return { colours: colours.size, range: maximum - minimum };
  }, png.toString('base64'));
}

test('renders a real 3D city and supports the overview → street → palace → interior journey', async ({ page }, testInfo) => {
  const errors = await openCity(page);
  const initial = await appState(page);
  expect(initial.location).toBe('overview');
  expect(initial.renderer.triangles).toBeGreaterThan(100);
  expect(initial.renderer.calls).toBeGreaterThan(0);
  const pixels = await canvasColourStats(page);
  expect(pixels.colours, 'The WebGL scene must contain geometry and lighting, not a blank canvas.').toBeGreaterThan(12);
  expect(pixels.range).toBeGreaterThan(30);
  await page.screenshot({ path: testInfo.outputPath('01-overview.png') });

  const labelsBeforeRotate = await page.evaluate(() => [...document.querySelectorAll('.landmark')].map((element) => getComputedStyle(element).transform));
  await page.mouse.move(920, 470);
  await page.mouse.down();
  await page.mouse.move(1060, 490, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction((before) => {
    const position = window.__CHANGAN__.snapshot().position;
    return Math.hypot(...position.map((value, index) => value - before[index])) > 1;
  }, initial.position);
  const labelsAfterRotate = await page.evaluate(() => [...document.querySelectorAll('.landmark')].map((element) => getComputedStyle(element).transform));
  expect(labelsAfterRotate, '地标文字应随总览镜头旋转同步更新位置。').not.toEqual(labelsBeforeRotate);
  const distanceBeforeZoom = await page.evaluate(() => {
    const app = window.__CHANGAN__;
    return app.camera.position.distanceTo(app.controls.target);
  });
  await page.mouse.wheel(0, -360);
  await page.waitForFunction((distance) => {
    const app = window.__CHANGAN__;
    return app.camera.position.distanceTo(app.controls.target) < distance - 2;
  }, distanceBeforeZoom);
  const skyAlignment = await page.evaluate(() => {
    const app = window.__CHANGAN__;
    return app.camera.position.distanceTo(app.sky.position);
  });
  expect(skyAlignment, '天空球应跟随相机，避免最大缩放时被远裁剪面切开。').toBeLessThan(0.001);

  await visit(page, 'market');
  const market = await appState(page);
  expect(Math.hypot(market.position[0] - initial.position[0], market.position[2] - initial.position[2])).toBeGreaterThan(15);
  await page.screenshot({ path: testInfo.outputPath('02-market.png') });

  await ensureWalking(page);
  const beforeWalk = (await appState(page)).position;
  await page.keyboard.down('w');
  try {
    await page.waitForFunction((before) => {
      const position = window.__CHANGAN__.snapshot().position;
      return Math.hypot(position[0] - before[0], position[2] - before[2]) > 1;
    }, beforeWalk);
  } finally {
    await page.keyboard.up('w');
  }

  await visit(page, 'palace');
  const courtyard = await appState(page);
  expect(courtyard.position[2]).toBeLessThan(market.position[2] - 20);
  await visit(page, 'interior');
  const interior = await appState(page);
  expect(interior.renderer.triangles).toBeGreaterThan(100);
  expect(interior.position[2]).toBeLessThan(courtyard.position[2]);
  await page.screenshot({ path: testInfo.outputPath('03-interior.png') });

  await visit(page, 'overview');
  const returned = await appState(page);
  expect(returned.mode).not.toBe('walk');
  expect(returned.position[1]).toBeGreaterThan(30);
  expect(errors).toEqual([]);
});

test('walking into a building stops at its collision boundary', async ({ page }) => {
  await openCity(page);
  await visit(page, 'market');
  await ensureWalking(page);

  const setup = await page.evaluate(() => {
    const app = window.__CHANGAN__;
    const direction = app.camera.getWorldDirection(app.camera.position.clone());
    const horizontalLength = Math.hypot(direction.x, direction.z);
    if (horizontalLength < 0.05) throw new Error('Walking camera does not have a horizontal forward direction.');
    const dx = direction.x / horizontalLength;
    const dz = direction.z / horizontalLength;
    const boxes = app.colliders.map((box) => box.min ? {
      minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z,
    } : box);
    const candidates = boxes.filter((box) =>
      [box.minX, box.maxX, box.minZ, box.maxZ].every(Number.isFinite)
      && box.maxX - box.minX > 2 && box.maxZ - box.minZ > 2
      && box.minZ > 0 && box.maxZ < 130,
    ).sort((a, b) => Math.abs((a.minX + a.maxX) / 2) - Math.abs((b.minX + b.maxX) / 2));
    for (const box of candidates) {
      const cx = (box.minX + box.maxX) / 2;
      const cz = (box.minZ + box.maxZ) / 2;
      const extentX = (box.maxX - box.minX) / 2;
      const extentZ = (box.maxZ - box.minZ) / 2;
      const distance = Math.min(Math.abs(dx) < 0.001 ? Infinity : extentX / Math.abs(dx), Math.abs(dz) < 0.001 ? Infinity : extentZ / Math.abs(dz)) + 1.2;
      const x = cx - dx * distance;
      const z = cz - dz * distance;
      const blocked = boxes.some((other) => x > other.minX - 0.5 && x < other.maxX + 0.5 && z > other.minZ - 0.5 && z < other.maxZ + 0.5);
      if (blocked) continue;
      app.setPlayerPosition(x, z);
      return { box, start: [x, z], direction: [dx, dz] };
    }
    throw new Error('No isolated street-side building collision box was available for the walking test.');
  });

  await page.keyboard.down('w');
  try {
    await page.waitForTimeout(1800);
  } finally {
    await page.keyboard.up('w');
  }
  const result = await appState(page);
  const [x, , z] = result.position;
  const { box } = setup;
  expect(x > box.minX + 0.05 && x < box.maxX - 0.05 && z > box.minZ + 0.05 && z < box.maxZ - 0.05,
    'Forward movement must not put the visitor inside the building footprint.').toBe(false);
  expect(Math.hypot(x - setup.start[0], z - setup.start[1]), 'Movement must advance toward the wall before stopping.').toBeGreaterThan(0.1);
});

test('the perspective sequence releases its camera and returns to a usable view', async ({ page }) => {
  const errors = await openCity(page);
  await visit(page, 'palace');
  const before = await appState(page);
  const initialFov = await page.evaluate(() => window.__CHANGAN__.camera.fov);
  await page.locator('#illusion-btn').click();
  await page.waitForFunction(() => window.__CHANGAN__.snapshot().transitioning);
  await page.waitForFunction((fov) => window.__CHANGAN__.snapshot().transitioning && Math.abs(window.__CHANGAN__.camera.fov - fov) > 2, initialFov);
  await page.waitForFunction(() => !window.__CHANGAN__.snapshot().transitioning, null, { timeout: 25_000 });
  const after = await appState(page);
  expect(after.position.every(Number.isFinite)).toBe(true);
  expect(after.location).toBe(before.location);
  expect(Math.hypot(...after.position.map((value, index) => value - before.position[index]))).toBeLessThan(2);
  await visit(page, 'market');
  expect((await appState(page)).location).toBe('market');
  expect(errors).toEqual([]);
});

test.describe('mobile controls', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('navigation and lighting controls fit a touch viewport', async ({ page }, testInfo) => {
    const errors = await openCity(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    for (const destination of ['overview', 'market', 'palace', 'interior', 'garden']) {
      const button = page.locator(`.destination-nav [data-destination="${destination}"]`);
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(391);
    }

    const slider = page.getByTestId('time-slider');
    await expect(slider).toBeVisible();
    const day = await slider.getAttribute('min');
    const night = await slider.getAttribute('max');
    await slider.press('Home');
    expect(await slider.inputValue()).toBe(day ?? '0');
    await page.waitForTimeout(400);
    const daylight = await page.locator('canvas').first().screenshot();
    await slider.press('End');
    await page.waitForTimeout(400);
    expect(await slider.inputValue()).toBe(night ?? '1');
    const nightlight = await page.locator('canvas').first().screenshot();
    expect(daylight.equals(nightlight), 'The lighting control must update the rendered scene.').toBe(false);

    await visit(page, 'market');
    await page.screenshot({ path: testInfo.outputPath('04-mobile-market.png') });
    await visit(page, 'overview');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    expect(errors).toEqual([]);
  });
});
