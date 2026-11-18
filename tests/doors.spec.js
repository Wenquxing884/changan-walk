import { test, expect } from '@playwright/test';

async function openCity(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?test=1');
  await page.waitForFunction(() => {
    const state = window.__CHANGAN__?.snapshot();
    return state?.ready && state.asset?.palaceLoaded && state.renderer.frame > 2;
  }, null, { timeout: 60_000 });
  await page.waitForTimeout(1100);
  return errors;
}

async function prepareDoor(page, kind) {
  return page.evaluate((wanted) => {
    const app = window.__CHANGAN__;
    const door = app.doors.find(item => item.kind === wanted || item.type === wanted);
    if (!door) throw new Error(`No ${wanted} door is available.`);
    const p = door.position;
    const n = door.normal;
    const length = Math.hypot(n.x, n.z);
    const normal = [n.x / length, n.z / length];
    const outside = [p.x + normal[0] * 2.2, p.z + normal[1] * 2.2];
    app.setPlayerPosition(...outside);
    app.facePlayer(p.x - normal[0] * 4, p.z - normal[1] * 4);
    return { id: door.id, buildingId: door.buildingId, position: [p.x, p.z], normal, outside, initiallyOpen: Boolean(door.open) };
  }, kind);
}

async function ensureDoorState(page, id, wantedOpen, interaction = 'keyboard') {
  await page.waitForFunction((expected) => window.__CHANGAN__.snapshot().nearbyDoor?.id === expected, id);
  const state = await page.evaluate(() => window.__CHANGAN__.snapshot());
  if (state.nearbyDoor.open !== wantedOpen) {
    if (interaction === 'button') await page.getByTestId('interact-door').click();
    else await page.keyboard.press('e');
  }
  await page.waitForFunction(({ id, open }) => {
    const door = window.__CHANGAN__.doors.find(item => item.id === id);
    return door && Boolean(door.open) === open;
  }, { id, open: wantedOpen });
  // Give the visible door leaves time to swing clear before walking through.
  await page.waitForTimeout(800);
}

async function signedDoorDistance(page, setup) {
  return page.evaluate(({ position, normal }) => {
    const p = window.__CHANGAN__.snapshot().position;
    return (p[0] - position[0]) * normal[0] + (p[2] - position[1]) * normal[1];
  }, setup);
}

test('a closed shop blocks walking, opens with E, and can be entered and exited on foot', async ({ page }, testInfo) => {
  const errors = await openCity(page);
  const setup = await prepareDoor(page, 'shop');
  await ensureDoorState(page, setup.id, false);
  await page.keyboard.down('w');
  try { await page.waitForTimeout(850); } finally { await page.keyboard.up('w'); }
  expect(await signedDoorDistance(page, setup), 'The closed door must keep the visitor outside.').toBeGreaterThan(0.1);
  expect((await page.evaluate(() => window.__CHANGAN__.snapshot())).insideBuilding).toBeNull();

  await page.evaluate(({ outside, position, normal }) => {
    window.__CHANGAN__.setPlayerPosition(...outside);
    window.__CHANGAN__.facePlayer(position[0] - normal[0] * 4, position[1] - normal[1] * 4);
  }, setup);
  await ensureDoorState(page, setup.id, true);
  await page.keyboard.down('w');
  try {
    await page.waitForFunction((buildingId) => window.__CHANGAN__.snapshot().insideBuilding?.id === buildingId, setup.buildingId);
  } finally { await page.keyboard.up('w'); }
  expect(await signedDoorDistance(page, setup)).toBeLessThan(0);
  await page.screenshot({ path: testInfo.outputPath('shop-interior.png') });

  await page.keyboard.down('s');
  try {
    await page.waitForFunction(({ position, normal }) => {
      const state = window.__CHANGAN__.snapshot();
      return state.insideBuilding === null
        && (state.position[0] - position[0]) * normal[0] + (state.position[2] - position[1]) * normal[1] > 1.5;
    }, setup);
  } finally { await page.keyboard.up('s'); }
  expect(await signedDoorDistance(page, setup)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('a courtyard gate opens from its street approach and permits a round trip through the wall', async ({ page }) => {
  const errors = await openCity(page);
  const setup = await prepareDoor(page, 'courtyardGate');
  await ensureDoorState(page, setup.id, true, 'button');
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(({ position, normal }) => {
      const p = window.__CHANGAN__.snapshot().position;
      return (p[0] - position[0]) * normal[0] + (p[2] - position[1]) * normal[1] < -2;
    }, setup);
  } finally { await page.keyboard.up('w'); }
  await page.keyboard.down('s');
  try {
    await page.waitForFunction(({ position, normal }) => {
      const p = window.__CHANGAN__.snapshot().position;
      return (p[0] - position[0]) * normal[0] + (p[2] - position[1]) * normal[1] > 1.8;
    }, setup);
  } finally { await page.keyboard.up('s'); }
  expect(errors).toEqual([]);
});

test('open door leaves and braces stay clear of the wall instead of rotating through its jamb', async ({ page }) => {
  await openCity(page);
  const setup = await prepareDoor(page, 'shop');
  await ensureDoorState(page, setup.id, true);
  await page.waitForFunction(id => {
    const door = window.__CHANGAN__.doors.find(item => item.id === id);
    return Math.abs(door.angle - door.targetAngle) < .00001;
  }, setup.id);
  const geometry = await page.evaluate(id => {
    const app = window.__CHANGAN__, door = app.doors.find(item => item.id === id);
    const inverse = door.transform.clone().invert(), matrix = door.transform.clone();
    const bounds = [];
    for (const [name, perDoor] of [['双扇木门 · hinged leaves', 2], ['门扉横枨', 6]]) {
      const mesh = app.scene.getObjectByName(name);
      mesh.geometry.computeBoundingBox();
      for (let index = 0; index < perDoor; index++) {
        mesh.getMatrixAt(door.index * perDoor + index, matrix);
        matrix.premultiply(inverse);
        const box = mesh.geometry.boundingBox.clone().applyMatrix4(matrix);
        bounds.push({ name, minX: box.min.x, maxX: box.max.x });
      }
    }
    return { angle: door.angle, halfWidth: door.width / 2, bounds };
  }, setup.id);
  expect(geometry.angle).toBeGreaterThan(Math.PI / 3);
  expect(geometry.angle).toBeLessThan(Math.PI / 2);
  for (const bound of geometry.bounds) {
    expect(bound.minX).toBeGreaterThan(-geometry.halfWidth + .005);
    expect(bound.maxX).toBeLessThan(geometry.halfWidth - .005);
  }
});

test('interior lamps fade between rooms without colour jumps and an open doorway stays visually stable', async ({ page }, testInfo) => {
  const errors = await openCity(page);
  const setup = await prepareDoor(page, 'shop');
  const phases = await page.evaluate(async id => {
    const app = window.__CHANGAN__;
    const door = app.doors.find(item => item.id === id);
    const lamps = [1, 2].map(index => app.scene.getObjectByName(`Shared interior lantern ${index}`));
    if (lamps.some(lamp => !lamp?.isPointLight)) throw new Error('The two real shared interior lights must be present.');
    app.setAnimationEnabled(false);
    const take = () => ({ frame: app.snapshot().renderer.frame, lamps: lamps.map(lamp => ({
      intensity: lamp.intensity, visible: lamp.visible, position: lamp.position.toArray(),
    })) });
    const sample = duration => new Promise(resolve => {
      const samples = [take()], started = performance.now();
      const frame = now => {
        samples.push(take());
        if (now - started >= duration) resolve(samples);
        else requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    if (door.open && !app.interactDoor(door.id).ok) throw new Error('Could not close the initial doorway.');
    const closed = await sample(300);
    if (!app.interactDoor(door.id).ok) throw new Error('Could not open the initial doorway.');
    const opening = await sample(1100);
    // A nearby, separate room exercises relocation while the first room's
    // actual lights are still bright, rather than testing isolated fade-ins.
    const neighbour = app.doors.filter(item => item.kind === 'shop' && item.buildingId !== door.buildingId)
      .sort((a, b) => a.position.distanceToSquared(door.position) - b.position.distanceToSquared(door.position))[0];
    if (!neighbour) throw new Error('A neighbouring shop is required for the lighting transition.');
    window.__DOOR_LIGHT_TRANSITION_TEST__ = { neighbourId: neighbour.id, sample };
    return { closed, opening };
  }, setup.id);

  // Keep the ordinary renderer and postprocessing. Crop away changing DOM
  // controls while retaining the open leaves, jambs and illuminated room.
  await page.evaluate(({ position, normal }) => {
    const app = window.__CHANGAN__;
    app.setPlayerPosition(position[0] + normal[0] * 3.4, position[1] + normal[1] * 3.4);
    app.facePlayer(position[0] - normal[0] * 4, position[1] - normal[1] * 4);
  }, setup);
  await page.waitForTimeout(160);
  const { width, height } = page.viewportSize();
  const clip = { x: Math.round(width * .08), y: Math.round(height * .24), width: Math.round(width * .84), height: Math.round(height * .36) };
  const first = await page.screenshot({ clip });
  await page.waitForTimeout(220);
  const second = await page.screenshot({ clip });
  const pixelDifference = await page.evaluate(async ([a, b]) => {
    const read = async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const [left, right] = await Promise.all([read(a), read(b)]);
    let changed = 0, absoluteError = 0;
    for (let index = 0; index < left.length; index += 4) {
      let maximum = 0;
      for (let channel = 0; channel < 3; channel++) {
        const difference = Math.abs(left[index + channel] - right[index + channel]);
        maximum = Math.max(maximum, difference); absoluteError += difference;
      }
      if (maximum > 3) changed++;
    }
    return { changedFraction: changed / (left.length / 4), meanAbsoluteError: absoluteError / (left.length / 4 * 3) };
  }, [first.toString('base64'), second.toString('base64')]);
  const rest = await page.evaluate(async () => {
    const app = window.__CHANGAN__, { neighbourId, sample } = window.__DOOR_LIGHT_TRANSITION_TEST__;
    const door = app.doors.find(item => item.id === neighbourId);
    app.setPlayerPosition(door.position.x + door.normal.x * 2.2, door.position.z + door.normal.z * 2.2);
    if (!door.open && !app.interactDoor(door.id).ok) throw new Error('Could not open the neighbouring shop.');
    app.setPlayerPosition(door.position.x - door.normal.x * 2.2, door.position.z - door.normal.z * 2.2);
    const neighbouring = await sample(1100);
    app.setPlayerPosition(0, 150);
    const leaving = await sample(850);
    delete window.__DOOR_LIGHT_TRANSITION_TEST__;
    return { neighbouring, leaving };
  });
  Object.assign(phases, rest);
  await testInfo.attach('interior-light-transition.json', { body: JSON.stringify({ phases, pixelDifference }, null, 2), contentType: 'application/json' });

  expect(Math.max(...phases.closed.flatMap(sample => sample.lamps.map(lamp => lamp.intensity))), 'Approaching a closed door must keep interior lamps off.').toBeLessThan(.01);
  expect(phases.opening.at(-1).lamps[0].intensity, 'Opening a nearby room must gradually light its interior.').toBeGreaterThan(20);
  expect(phases.neighbouring.at(-1).lamps[0].intensity).toBeGreaterThan(20);
  expect(phases.leaving.at(-1).lamps[0].intensity, 'Leaving the rooms must fade the shared lights out.').toBeLessThan(.6);
  const samples = Object.values(phases).flat();
  for (const sample of samples) expect(sample.lamps.every(lamp => lamp.visible), 'Lights must stay registered while their intensity changes.').toBe(true);
  let relocations = 0;
  for (let index = 1; index < samples.length; index++) {
    for (let lamp = 0; lamp < 2; lamp++) {
      const before = samples[index - 1].lamps[lamp], after = samples[index].lamps[lamp];
      expect(Math.abs(after.intensity - before.intensity), 'A frame must not jump between darkness and full lamp intensity.').toBeLessThan(12);
      if (Math.hypot(...after.position.map((value, axis) => value - before.position[axis])) > .01) {
        relocations++;
        expect(before.intensity, 'A lamp must fade almost completely before changing rooms.').toBeLessThan(1.1);
        expect(after.intensity).toBeLessThan(.01);
      }
    }
  }
  expect(relocations, 'Both lamps must be relocated to the neighbouring room.').toBeGreaterThanOrEqual(4);
  expect(pixelDifference.changedFraction, 'A settled open doorway must not flash between rendered surfaces.').toBeLessThan(.002);
  expect(pixelDifference.meanAbsoluteError).toBeLessThan(.15);
  expect(errors).toEqual([]);
});

test('most ordinary buildings provide identifiable accessible interiors', async ({ page }) => {
  await openCity(page);
  const inventory = await page.evaluate(() => {
    const app = window.__CHANGAN__;
    const buildings = app.buildings;
    const doors = app.doors;
    const connected = buildings.filter(building => doors.some(door => door.buildingId === building.id));
    return { count: buildings.length, connected: connected.length, asset: app.snapshot().asset };
  });
  expect(inventory.count).toBeGreaterThan(20);
  expect(inventory.connected / inventory.count, 'The majority of registered buildings must have functional entrances.').toBeGreaterThan(0.6);
  expect(inventory.asset.enterableBuildings / inventory.asset.buildings,
    'The majority of all city buildings, including unregistered scenery, must be enterable.').toBeGreaterThan(0.6);
});

test('a doorway cannot close through the visitor and E works from inside the room', async ({ page }) => {
  const errors = await openCity(page);
  const setup = await prepareDoor(page, 'shop');
  await ensureDoorState(page, setup.id, true);
  await page.evaluate(({ position }) => window.__CHANGAN__.setPlayerPosition(position[0], position[1]), setup);
  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  expect(await page.evaluate(id => window.__CHANGAN__.doors.find(door => door.id === id).open, setup.id),
    'A visitor standing in the threshold must prevent unsafe closing.').toBe(true);

  await page.evaluate(({ position, normal }) => {
    window.__CHANGAN__.setPlayerPosition(position[0] - normal[0] * 2.2, position[1] - normal[1] * 2.2);
    window.__CHANGAN__.facePlayer(position[0], position[1]);
  }, setup);
  await page.waitForFunction(id => window.__CHANGAN__.snapshot().insideBuilding?.id === id, setup.buildingId);
  await ensureDoorState(page, setup.id, false);
  await ensureDoorState(page, setup.id, true);
  expect(errors).toEqual([]);
});

async function verifyClosedRoomExit(page, testInfo, reducedMotion = false) {
  if (reducedMotion) await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openCity(page);
  if (reducedMotion) {
    await page.goto('/');
    await page.waitForFunction(() => window.__CHANGAN__?.snapshot().ready && window.__CHANGAN__.snapshot().asset?.palaceLoaded);
  }
  const setup = await prepareDoor(page, 'shop');
  await ensureDoorState(page, setup.id, true);
  await page.keyboard.down('w');
  try {
    await page.waitForFunction(({ buildingId, position, normal }) => {
      const state = window.__CHANGAN__.snapshot();
      const distance = (state.position[0] - position[0]) * normal[0] + (state.position[2] - position[1]) * normal[1];
      return state.insideBuilding?.id === buildingId && distance < -2;
    }, setup);
  } finally { await page.keyboard.up('w'); }
  await ensureDoorState(page, setup.id, false);
  // A distant visitor must first approach the door before the application's
  // proximity-checked opening request can succeed.
  await page.evaluate(({ position, normal }) => {
    window.__CHANGAN__.setPlayerPosition(position[0] - normal[0] * 6, position[1] - normal[1] * 6);
    window.__CHANGAN__.facePlayer(position[0], position[1]);
  }, setup);
  await page.waitForFunction(id => window.__CHANGAN__.snapshot().insideBuilding?.id === id, setup.buildingId);

  const result = await page.evaluate(async ({ id, position, normal }) => {
    const app = window.__CHANGAN__;
    const door = app.doors.find(item => item.id === id);
    const samples = [];
    const take = () => {
      const state = app.snapshot();
      const local = app.camera.position.clone().applyMatrix4(door.transform.clone().invert());
      return { frame: state.renderer.frame, distance: (state.position[0] - position[0]) * normal[0] + (state.position[2] - position[1]) * normal[1],
        localX: local.x, height: state.position[1], angle: door.angle, transitioning: state.transitioning, location: state.location };
    };
    samples.push(take());
    if (!app.goTo('overview')) throw new Error('Overview transition was refused from inside the closed room.');
    await new Promise((resolve, reject) => {
      const started = performance.now();
      const frame = () => {
        samples.push(take());
        if (!app.snapshot().transitioning && app.snapshot().location === 'overview') return resolve();
        if (performance.now() - started > 20_000) return reject(new Error('The indoor exit transition did not complete.'));
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    return { samples, door: { base: door.base, height: door.height, width: door.width }, final: app.snapshot() };
  }, setup);
  await testInfo.attach('closed-room-exit-path.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  const crossingIndex = result.samples.findIndex((sample, index) => index > 0 && sample.distance >= 0 && result.samples[index - 1].distance < 0);
  expect(crossingIndex, 'The camera must leave through the actual doorway plane.').toBeGreaterThan(0);
  const before = result.samples[crossingIndex - 1];
  const after = result.samples[crossingIndex];
  expect(Math.min(before.angle, after.angle), 'The door must already be over 60 degrees open when the camera crosses it.').toBeGreaterThan(Math.PI / 3);
  expect(Math.max(before.height, after.height), 'The exit path must stay beneath the lintel until it passes outside.').toBeLessThan(result.door.base + result.door.height - 0.05);
  expect(Math.max(Math.abs(before.localX), Math.abs(after.localX))).toBeLessThan(result.door.width / 2 - 0.15);
  expect(result.final.mode).toBe('overview');
  expect(result.final.position[1]).toBeGreaterThan(30);
  expect(errors).toEqual([]);
}

test('returning to overview opens a closed shop door before passing under its lintel', async ({ page }, testInfo) => {
  await verifyClosedRoomExit(page, testInfo);
});

test('reduced-motion indoor exit still opens the door before crossing it', async ({ page }, testInfo) => {
  await verifyClosedRoomExit(page, testInfo, true);
});

test.describe('touch door interaction', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the visible touch prompt opens a shop entrance', async ({ page }, testInfo) => {
    const errors = await openCity(page);
    const setup = await prepareDoor(page, 'shop');
    await ensureDoorState(page, setup.id, false);
    const button = page.getByTestId('interact-door');
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);
    expect(box.y + box.height).toBeLessThan(844);
    await button.tap();
    await page.waitForFunction(id => window.__CHANGAN__.doors.find(door => door.id === id).open, setup.id);
    await page.waitForTimeout(800);
    await page.screenshot({ path: testInfo.outputPath('mobile-door-open.png') });
    expect(errors).toEqual([]);
  });
});
