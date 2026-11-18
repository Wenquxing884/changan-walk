import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('screenshots', { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(process.env.CHANGAN_BASE_URL || 'http://127.0.0.1:5175/?test=1');
  await page.waitForFunction(() => window.__CHANGAN__?.snapshot().ready && window.__CHANGAN__.snapshot().asset?.palaceLoaded);
  await page.waitForTimeout(1300);
  const canvas = page.locator('#world');
  await page.evaluate(() => window.__CHANGAN__.setAnimationEnabled(false));
  await page.screenshot({ path: 'screenshots/v2-overview.png' });
  await page.evaluate(() => window.__CHANGAN__.goTo('market'));
  await page.waitForFunction(() => window.__CHANGAN__.snapshot().location === 'market' && !window.__CHANGAN__.snapshot().transitioning);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/v2-market.png' });

  // Sample the same scene twice after freezing actors and camera. This checks
  // fixed-view temporal instability, not aliasing during arbitrary movement.
  await page.evaluate(() => {
    window.__CHANGAN__.setPlayerPosition(0, 60);
    window.__CHANGAN__.facePlayer(0, -45);
  });
  await page.waitForTimeout(250);
  // A locator screenshot can include overlapping DOM. Hide the changing FPS
  // label for this diagnostic rather than counting its digits as scene flicker.
  await page.locator('#performance').evaluate(element => { element.style.visibility = 'hidden'; });
  const first = await canvas.screenshot();
  await writeFile('screenshots/v2-freeze-a.png', first);
  await page.waitForTimeout(600);
  const second = await canvas.screenshot();
  await writeFile('screenshots/v2-freeze-b.png', second);
  await page.locator('#performance').evaluate(element => { element.style.visibility = ''; });
  const difference = await page.evaluate(async ([a, b]) => {
    const read = async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const [left, right] = await Promise.all([read(a), read(b)]);
    let changedPixels = 0, maximumDifference = 0, absoluteError = 0;
    for (let i = 0; i < left.length; i += 4) {
      let difference = 0;
      for (let j = 0; j < 3; j++) { const d = Math.abs(left[i + j] - right[i + j]); difference = Math.max(difference, d); absoluteError += d; }
      maximumDifference = Math.max(maximumDifference, difference);
      if (difference > 2) changedPixels++;
    }
    return { pixels: left.length / 4, changedPixels, maximumDifference, meanAbsoluteError: absoluteError / (left.length / 4 * 3) };
  }, [first.toString('base64'), second.toString('base64')]);

  // Nearby residents remain at their ordinary scale; this pose does not enlarge
  // their models or replace the app's rendering path for the screenshot.
  await page.evaluate(() => {
    const app = window.__CHANGAN__;
    const group = app.scene.getObjectByName('唐风居民 · articulated instance cast');
    let residents = group?.userData.residents;
    if (!residents) app.scene.traverse(object => { if (object.userData.residents) residents = object.userData.residents; });
    const person = residents.find(item => Math.abs(item.pos.x) > 4 && item.pos.z > 65 && item.pos.z < 112) || residents[0];
    app.setPlayerPosition(person.pos.x + 2.2, person.pos.z + 3);
    app.facePlayer(person.pos.x, person.pos.z);
    app.camera.rotation.x = -0.12;
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'screenshots/v2-residents.png' });

  const doorId = await page.evaluate(() => {
    const app = window.__CHANGAN__, door = app.doors.find(item => item.kind === 'shop');
    app.setPlayerPosition(door.position.x + door.normal.x * 2.2, door.position.z + door.normal.z * 2.2);
    app.facePlayer(door.position.x - door.normal.x * 4, door.position.z - door.normal.z * 4);
    return door.id;
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'screenshots/v2-shop-closed.png' });
  await page.keyboard.press('e');
  await page.waitForFunction(id => { const door = window.__CHANGAN__.doors.find(item => item.id === id); return door.angle > .3 && door.angle < 1.45; }, doorId);
  await page.screenshot({ path: 'screenshots/v2-shop-door-swing.png' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'screenshots/v2-shop-open.png' });
  await page.keyboard.down('w');
  try { await page.waitForFunction(() => Boolean(window.__CHANGAN__.snapshot().insideBuilding)); }
  finally { await page.keyboard.up('w'); }
  await page.waitForTimeout(450);
  await page.screenshot({ path: 'screenshots/v2-shop-interior.png' });

  await page.evaluate(() => {
    const app = window.__CHANGAN__, door = app.doors.find(item => item.kind === 'courtyardGate');
    app.setPlayerPosition(door.position.x + door.normal.x * 3, door.position.z + door.normal.z * 3);
    app.facePlayer(door.position.x - door.normal.x * 5, door.position.z - door.normal.z * 5);
    if (!door.open) app.interactDoor(door.id);
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'screenshots/v2-courtyard-gate.png' });
  await page.keyboard.down('w');
  await page.waitForTimeout(900);
  await page.keyboard.up('w');
  await page.screenshot({ path: 'screenshots/v2-courtyard-inside.png' });

  for (let i = 0; i < 5; i++) {
    await page.evaluate(z => {
      const app = window.__CHANGAN__; app.setPlayerPosition(0, z); app.facePlayer(0, z - 20); app.camera.rotation.x = -.18;
    }, 18 - i * .6);
    await page.waitForTimeout(90);
    await canvas.screenshot({ path: `screenshots/v2-crossing-${i}.png` });
  }
  const result = { frozenFixedView: difference, pageErrors, snapshot: await page.evaluate(() => window.__CHANGAN__.snapshot()) };
  await writeFile('screenshots/v2-review.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
