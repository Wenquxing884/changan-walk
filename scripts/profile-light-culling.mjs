import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { ShaderChunk } from 'three';

// Temporary, page-local A/B/A experiment. This never writes product shaders.
// Usage: node scripts/profile-light-culling.mjs [report.json] [palace,tea,garden]
// Optional views: overview, market, palace, interior, tea, garden, garden-bridge.
export function buildPointLightCullingChunk(source = ShaderChunk.lights_fragment_begin) {
  const start = source.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
  const end = source.indexOf('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )', start);
  assert.ok(start >= 0 && end > start, 'Three.js must expose a bounded point-light section.');
  const original = source.slice(start, end);
  const directCall = /(^[\t ]*)RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);/gm;
  assert.equal([...original.matchAll(directCall)].length, 1, 'Patch exactly one point-light RE_Direct call.');
  const patched = original.replace(directCall, '$1if ( directLight.visible ) {\n$1\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n$1}');
  return source.slice(0, start) + patched + source.slice(end);
}

async function comparePNGs(page, first, second) {
  return page.evaluate(async ([first, second]) => {
    const decode = async base64 => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, data: context.getImageData(0, 0, canvas.width, canvas.height).data };
    };
    const [a, b] = await Promise.all([decode(first), decode(second)]);
    if (a.width !== b.width || a.height !== b.height) throw new Error('Compared screenshots have different dimensions.');
    const count = a.width * a.height;
    let changed = 0, overTwo = 0, maximum = 0, absolute = 0, squared = 0;
    for (let pixel = 0; pixel < count; pixel++) {
      let peak = 0;
      for (let channel = 0; channel < 3; channel++) {
        const difference = Math.abs(a.data[pixel * 4 + channel] - b.data[pixel * 4 + channel]);
        absolute += difference; squared += difference * difference; peak = Math.max(peak, difference);
      }
      if (peak > 0) changed++;
      if (peak > 2) overTwo++;
      maximum = Math.max(maximum, peak);
    }
    // Equal-weight 8x8 luma windows (not a Gaussian-window library SSIM).
    const c1 = (.01 * 255) ** 2, c2 = (.03 * 255) ** 2;
    const luma = (data, offset) => data[offset] * .2126 + data[offset + 1] * .7152 + data[offset + 2] * .0722;
    let ssimSum = 0, ssimWeight = 0;
    for (let top = 0; top < a.height; top += 8) for (let left = 0; left < a.width; left += 8) {
      let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let y = top; y < Math.min(top + 8, a.height); y++) for (let x = left; x < Math.min(left + 8, a.width); x++) {
        const offset = (y * a.width + x) * 4, ax = luma(a.data, offset), by = luma(b.data, offset);
        n++; sx += ax; sy += by; sxx += ax * ax; syy += by * by; sxy += ax * by;
      }
      const mx = sx / n, my = sy / n, denominator = Math.max(1, n - 1);
      const vx = Math.max(0, (sxx - sx * sx / n) / denominator);
      const vy = Math.max(0, (syy - sy * sy / n) / denominator);
      const covariance = (sxy - sx * sy / n) / denominator;
      const local = ((2 * mx * my + c1) * (2 * covariance + c2)) / ((mx * mx + my * my + c1) * (vx + vy + c2));
      ssimSum += local * n; ssimWeight += n;
    }
    const mae = absolute / (count * 3), mse = squared / (count * 3), ssim = ssimSum / ssimWeight;
    return { width: a.width, height: a.height, pixels: count, changedPixels: changed, changedPixelsOverTwo: overTwo,
      changedPercentOverTwo: overTwo / count * 100, maximumChannelDifference: maximum, meanAbsoluteChannelDifference: mae,
      rootMeanSquareChannelDifference: Math.sqrt(mse), psnrDb: mse ? 10 * Math.log10(255 ** 2 / mse) : null,
      exactPixels: changed === 0, ssim, ssimMethod: '8x8-window BT.709 luma, sample variance, pixel-weighted mean',
      equivalentWithinTolerance: ssim >= .9995 && mae <= .1 };
  }, [first.toString('base64'), second.toString('base64')]);
}

async function main() {
  const output = path.resolve(process.argv[2] || 'reports/light-culling-aba.json');
  const views = (process.argv[3] || process.env.CHANGAN_LIGHT_CULL_VIEWS || 'palace,tea,garden').split(',').map(value => value.trim()).filter(Boolean);
  const validViews = new Set(['overview', 'market', 'palace', 'interior', 'tea', 'garden', 'garden-bridge']);
  assert.ok(views.length && views.every(view => validViews.has(view)), 'Choose supported fixed views.');
  const patchedChunk = buildPointLightCullingChunk();
  const durationMs = 8000, viewport = { width: 1280, height: 900 };
  const url = new URL(process.env.CHANGAN_BASE_URL || 'http://127.0.0.1:5175/'); url.searchParams.set('test', '1');
  const screenshotDirectory = path.resolve('screenshots/light-culling');
  const runName = path.basename(output, path.extname(output)).replace(/[^a-zA-Z0-9_-]/g, '-');
  await mkdir(path.dirname(output), { recursive: true }); await mkdir(screenshotDirectory, { recursive: true });
  const report = { capturedAt: new Date().toISOString(), url: url.href, viewport, deviceScaleFactor: 1, sampleDurationMs: durationMs,
    variant: 'Only point-light RE_Direct is skipped when directLight.visible is false; Standard/Physical materials and existing hooks are retained.',
    order: ['original-a', 'zero-light-branch', 'original-a-repeat'], views: [], errors: [], consoleErrors: [], failedRequests: [] };
  let browser, page;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11'] });
    report.browser = await browser.version();
    page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.consoleErrors.push(message.text()); });
    page.on('requestfailed', request => report.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    await page.goto(url.href);
    await page.waitForFunction(() => {
      const state = window.__CHANGAN__?.snapshot();
      return state?.ready && state.asset?.palaceLoaded && state.asset?.palaceLowLoaded;
    }, null, { timeout: 90_000 });
    // HUD text, CSS transitions and the FPS counter cannot affect image diffs.
    await page.addStyleTag({ content: '#app > :not(#world) { visibility: hidden !important; }' });
    await page.evaluate(() => window.__CHANGAN__.requestViewportResize(1));
    await page.waitForFunction(() => {
      const app = window.__CHANGAN__;
      return app.renderer.getPixelRatio() === 1 && app.renderer.domElement.width === 1280 && app.renderer.domElement.height === 900;
    });

    report.materials = await page.evaluate(chunk => {
      const app = window.__CHANGAN__, unique = new Set();
      app.scene.traverse(object => {
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (material?.isMeshStandardMaterial || material?.isMeshPhysicalMaterial) unique.add(material);
        }
      });
      const records = [...unique].map(material => ({ material, originalCompile: material.onBeforeCompile,
        ownCompile: Object.hasOwn(material, 'onBeforeCompile'), originalKey: material.customProgramCacheKey,
        ownKey: Object.hasOwn(material, 'customProgramCacheKey'), cacheKey: material.customProgramCacheKey.call(material) }));
      const totals = {}, previouslyCustomized = [];
      for (const { material, ownCompile } of records) {
        totals[material.type] = (totals[material.type] || 0) + 1;
        if (ownCompile) previouslyCustomized.push({ name: material.name, type: material.type });
      }
      const experiment = {
        active: false, patches: 0,
        apply() {
          if (this.active) return;
          for (const record of records) {
            record.material.onBeforeCompile = function (shader, renderer) {
              record.originalCompile.call(this, shader, renderer);
              const include = '#include <lights_fragment_begin>';
              if (!shader.fragmentShader.includes(include)) throw new Error(`No light chunk in ${this.name || this.type}.`);
              shader.fragmentShader = shader.fragmentShader.replace(include, chunk);
              experiment.patches++;
            };
            record.material.customProgramCacheKey = () => `${record.cacheKey}|temporary-zero-point-light-branch-v1`;
            record.material.needsUpdate = true;
          }
          this.active = true;
        },
        restore() {
          if (!this.active) return;
          for (const record of records) {
            if (record.ownCompile) record.material.onBeforeCompile = record.originalCompile;
            else delete record.material.onBeforeCompile;
            if (record.ownKey) record.material.customProgramCacheKey = record.originalKey;
            else delete record.material.customProgramCacheKey;
            record.material.needsUpdate = true;
          }
          this.active = false;
        },
        status() {
          return { active: this.active, patches: this.patches, exactlyRestored: !this.active && records.every(record =>
            record.material.onBeforeCompile === record.originalCompile && record.material.customProgramCacheKey === record.originalKey &&
            Object.hasOwn(record.material, 'onBeforeCompile') === record.ownCompile && Object.hasOwn(record.material, 'customProgramCacheKey') === record.ownKey) };
        },
      };
      window.__LIGHT_CULLING_ABA__ = experiment;
      return { unique: records.length, types: totals, previouslyCustomized };
    }, patchedChunk);

    const settle = async () => {
      await page.evaluate(async () => {
        const app = window.__CHANGAN__;
        await app.renderer.compileAsync(app.scene, app.camera);
      });
      // Actual composer rendering also creates the offscreen colour-space
      // program variant; exclude those frames from the measurement window.
      await page.waitForTimeout(1500);
    };
    const prepareView = async view => {
      await page.evaluate(() => { const app = window.__CHANGAN__; app.setAnimationEnabled(true); app.setTime(.42); });
      if (view === 'tea') {
        const id = await page.evaluate(() => {
          const app = window.__CHANGAN__, door = app.doors.find(item => item.kind === 'shop' && item.label.includes('茶'));
          if (!door) throw new Error('A tea shop is required for this fixed view.');
          app.setPlayerPosition(door.position.x + door.normal.x * 2.2, door.position.z + door.normal.z * 2.2);
          app.facePlayer(door.position.x - door.normal.x * 6, door.position.z - door.normal.z * 6);
          if (!door.open) app.interactDoor(door.id);
          return door.id;
        });
        await page.waitForFunction(id => {
          const door = window.__CHANGAN__.doors.find(item => item.id === id);
          return door.open && Math.abs(door.angle - door.targetAngle) < .00001;
        }, id);
        await page.evaluate(id => {
          const app = window.__CHANGAN__, door = app.doors.find(item => item.id === id);
          app.setPlayerPosition(door.position.x - door.normal.x * 3, door.position.z - door.normal.z * 3);
          app.facePlayer(door.position.x - door.normal.x * 8, door.position.z - door.normal.z * 8);
        }, id);
        await page.waitForFunction(() => Boolean(window.__CHANGAN__.snapshot().insideBuilding));
      } else {
        const destination = view === 'garden-bridge' ? 'garden' : view;
        await page.evaluate(id => window.__CHANGAN__.goTo(id), destination);
        await page.waitForFunction(id => { const state = window.__CHANGAN__.snapshot(); return state.location === id && !state.transitioning; }, destination);
        if (view === 'garden-bridge') await page.evaluate(() => {
          const app = window.__CHANGAN__; app.setPlayerPosition(128, -116); app.facePlayer(128, -158);
        });
      }
      await page.waitForTimeout(1700);
      await page.evaluate(() => {
        const app = window.__CHANGAN__;
        app.setAnimationEnabled(false);
        // Remove residual orbit damping; the frozen view uses this matrix in
        // all three phases, rather than resetting the scene or moving lights.
        app.controls.enableDamping = false; app.controls.autoRotate = false;
        app.controls.update();
      });
      await page.waitForTimeout(350);
    };
    const captureState = () => page.evaluate(() => {
      const app = window.__CHANGAN__, state = app.snapshot();
      const fixed = values => values.map(value => Math.round(value * 1e8) / 1e8);
      return { position: fixed(state.position), target: fixed(state.target), location: state.location, mode: state.mode, lod: state.asset.palaceLOD,
        time: state.time, pixelRatio: state.pixelRatio, fov: app.camera.fov, near: app.camera.near, far: app.camera.far,
        drawingBuffer: { width: app.renderer.domElement.width, height: app.renderer.domElement.height } };
    });
    const sample = async name => {
      const result = await page.evaluate(duration => new Promise(resolve => {
        const frames = [], calls = [], triangles = [], app = window.__CHANGAN__;
        let started, previous;
        const programsBefore = app.renderer.info.programs?.length ?? 0;
        const step = now => {
          if (started === undefined) { started = previous = now; requestAnimationFrame(step); return; }
          frames.push(now - previous); previous = now;
          const state = app.snapshot(); calls.push(state.renderer.calls); triangles.push(state.renderer.triangles);
          if (now - started < duration) return requestAnimationFrame(step);
          const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
          resolve({ durationMs: now - started, frames: frames.length, averageFPS: frames.length * 1000 / (now - started),
            frameTimeMs: { p50: percentile(frames, .5), p95: percentile(frames, .95), maximum: Math.max(...frames), over33: frames.filter(value => value > 33).length, over50: frames.filter(value => value > 50).length },
            renderer: { callsP50: percentile(calls, .5), callsMinimum: Math.min(...calls), callsMaximum: Math.max(...calls), trianglesP50: percentile(triangles, .5), trianglesMinimum: Math.min(...triangles), trianglesMaximum: Math.max(...triangles), programsBefore, programsAfter: app.renderer.info.programs?.length ?? 0 },
            shader: window.__LIGHT_CULLING_ABA__.status(), snapshot: state });
        };
        requestAnimationFrame(step);
      }), durationMs);
      console.log(JSON.stringify({ name, fps: result.averageFPS, ...result.frameTimeMs, calls: result.renderer.callsP50, triangles: result.renderer.trianglesP50 }));
      return { name, ...result };
    };

    for (const view of views) {
      await page.evaluate(() => window.__LIGHT_CULLING_ABA__.restore());
      await prepareView(view);
      const result = { view, fixedView: await captureState(), samples: [], screenshots: {}, comparisons: {} };
      report.views.push(result);
      const images = new Map();
      for (const [index, name] of report.order.entries()) {
        await page.evaluate(variant => { const experiment = window.__LIGHT_CULLING_ABA__; if (variant) experiment.apply(); else experiment.restore(); }, index === 1);
        await settle();
        assert.deepEqual(await captureState(), result.fixedView, `${view}: camera, time, LOD and drawing-buffer state must remain fixed.`);
        const measured = await sample(name); result.samples.push(measured);
        const screenshot = path.join(screenshotDirectory, `${runName}-${view}-${name}.png`);
        images.set(name, await page.locator('#world').screenshot({ path: screenshot }));
        result.screenshots[name] = path.relative(process.cwd(), screenshot).replaceAll('\\', '/');
      }
      result.comparisons.variantVsOriginal = await comparePNGs(page, images.get(report.order[0]), images.get(report.order[1]));
      result.comparisons.originalRepeatVsOriginal = await comparePNGs(page, images.get(report.order[0]), images.get(report.order[2]));
      const [a, b, repeated] = result.samples;
      result.fixedRenderLoad = result.samples.every(item => item.renderer.callsP50 === a.renderer.callsP50 && item.renderer.trianglesP50 === a.renderer.trianglesP50 &&
        item.renderer.callsMinimum === item.renderer.callsMaximum && item.renderer.trianglesMinimum === item.renderer.trianglesMaximum);
      result.performance = { baselineMeanFPS: (a.averageFPS + repeated.averageFPS) / 2, variantFPS: b.averageFPS,
        variantFPSChangePercent: (b.averageFPS / ((a.averageFPS + repeated.averageFPS) / 2) - 1) * 100,
        baselineDriftPercent: (repeated.averageFPS / a.averageFPS - 1) * 100 };
    }
    report.gpu = await page.evaluate(() => {
      const app = window.__CHANGAN__, gl = app.renderer.getContext(), extension = gl.getExtension('WEBGL_debug_renderer_info');
      return { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), pixelRatio: app.renderer.getPixelRatio() };
    });
  } catch (error) {
    report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  } finally {
    if (page && !page.isClosed()) {
      try {
        report.restored = await page.evaluate(() => {
          const experiment = window.__LIGHT_CULLING_ABA__;
          experiment?.restore();
          return experiment?.status() ?? null;
        });
      } catch (error) { report.restoreError = error.message; process.exitCode = 1; }
    }
    await browser?.close();
    report.result = report.failure || report.errors.length || report.consoleErrors.length || report.restoreError || report.restored?.exactlyRestored === false ? 'failed' : 'completed';
    if (report.result === 'failed') process.exitCode = 1;
    await writeFile(output, JSON.stringify(report, null, 2));
    console.log(`Saved ${path.relative(process.cwd(), output)}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
