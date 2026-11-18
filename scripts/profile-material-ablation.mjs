import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const durationMs = 8000;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11'] });
const report = { capturedAt: new Date().toISOString(), url: 'http://127.0.0.1:5175/?test=1', viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, sampleDurationMs: durationMs, samples: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(report.url);
  await page.waitForFunction(() => window.__CHANGAN__?.snapshot().ready && window.__CHANGAN__.snapshot().asset?.palaceLoaded && window.__CHANGAN__.snapshot().asset?.palaceLowLoaded);
  await page.evaluate(() => window.__CHANGAN__.goTo('palace'));
  await page.waitForFunction(() => { const state = window.__CHANGAN__.snapshot(); return state.location === 'palace' && !state.transitioning; });
  await page.evaluate(() => { const app = window.__CHANGAN__; app.setAnimationEnabled(false); app.setTime(.42); });
  await page.waitForTimeout(1300);

  const inventory = await page.evaluate(() => {
    const app = window.__CHANGAN__, totals = {};
    app.scene.traverse(object => {
      if (!object.isMesh) return;
      for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
        const type = material?.type ?? 'none'; totals[type] = (totals[type] ?? 0) + 1;
      }
    });
    return { position: app.snapshot().position, target: app.snapshot().target, lod: app.snapshot().asset.palaceLOD,
      highTriangles: app.snapshot().asset.palaceHighTriangles, lowTriangles: app.snapshot().asset.palaceLowTriangles, materialTypes: totals };
  });
  report.camera = inventory;

  await page.evaluate(async () => {
    const app = window.__CHANGAN__;
    const THREE = await import('/node_modules/.vite/deps/three.js?v=95c3bf16');
    const bindings = [];
    app.scene.traverse(object => { if (object.isMesh && object.material) bindings.push({ object, source: object.material }); });
    const copyValue = value => value?.clone ? value.clone() : value;
    const lambertFrom = source => new THREE.MeshLambertMaterial({
      name: `${source.name || source.type} · temporary Lambert A/B`, color: copyValue(source.color), emissive: copyValue(source.emissive),
      emissiveMap: source.emissiveMap, map: source.map, alphaMap: source.alphaMap, aoMap: source.aoMap, lightMap: source.lightMap,
      emissiveIntensity: source.emissiveIntensity, opacity: source.opacity, transparent: source.transparent, alphaTest: source.alphaTest,
      side: source.side, vertexColors: source.vertexColors, flatShading: source.flatShading, wireframe: source.wireframe, fog: source.fog,
      depthWrite: source.depthWrite, depthTest: source.depthTest, polygonOffset: source.polygonOffset,
      polygonOffsetFactor: source.polygonOffsetFactor, polygonOffsetUnits: source.polygonOffsetUnits,
      toneMapped: source.toneMapped, blending: source.blending, premultipliedAlpha: source.premultipliedAlpha,
    });
    const convertedMaterials = [];
    window.__MATERIAL_ABLATION__ = {
      bindings,
      apply() {
        this.restore();
        for (const { object, source } of bindings) {
          if (Array.isArray(source)) {
            const converted = source.map(material => material?.isMeshStandardMaterial ? lambertFrom(material) : material);
            if (converted.some((material, index) => material !== source[index])) { object.material = converted; convertedMaterials.push(...converted.filter((material, index) => material !== source[index])); }
          } else if (source.isMeshStandardMaterial) {
            const converted = lambertFrom(source); object.material = converted; convertedMaterials.push(converted);
          }
        }
      },
      restore() {
        for (const { object, source } of bindings) object.material = source;
        convertedMaterials.splice(0).forEach(material => material.dispose());
      },
    };
    window.__MATERIAL_ABLATION__.apply();
    await app.renderer.compileAsync(app.scene, app.camera);
  });
  await page.waitForTimeout(500);

  const sample = async name => {
    const result = await page.evaluate(duration => new Promise(resolve => {
      const frames = [], calls = [], triangles = [], started = performance.now();
      let previous = started;
      const step = now => {
        frames.push(now - previous); previous = now;
        const state = window.__CHANGAN__.snapshot(); calls.push(state.renderer.calls); triangles.push(state.renderer.triangles);
        if (now - started < duration) return requestAnimationFrame(step);
        const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
        resolve({ durationMs: now - started, frameCount: frames.length, averageFPS: frames.length * 1000 / (now - started),
          frameTimeMs: { p50: percentile(frames, .5), p95: percentile(frames, .95), maximum: Math.max(...frames), over33: frames.filter(v => v > 33).length, over50: frames.filter(v => v > 50).length },
          renderer: { callsP50: percentile(calls, .5), trianglesP50: percentile(triangles, .5) }, snapshot: state });
      };
      requestAnimationFrame(step);
    }), durationMs);
    report.samples.push({ name, ...result });
    console.log(JSON.stringify({ name, fps: result.averageFPS, ...result.frameTimeMs, ...result.renderer }));
  };

  await sample('mesh-lambert-a');
  await page.evaluate(() => window.__MATERIAL_ABLATION__.restore());
  await page.evaluate(() => window.__CHANGAN__.renderer.compileAsync(window.__CHANGAN__.scene, window.__CHANGAN__.camera));
  await page.waitForTimeout(500);
  await sample('mesh-standard-baseline');
  await page.evaluate(() => window.__MATERIAL_ABLATION__.apply());
  await page.evaluate(() => window.__CHANGAN__.renderer.compileAsync(window.__CHANGAN__.scene, window.__CHANGAN__.camera));
  await page.waitForTimeout(500);
  await sample('mesh-lambert-b');
  await page.evaluate(() => window.__MATERIAL_ABLATION__.restore());
} finally {
  await browser.close();
  await mkdir('reports', { recursive: true });
  await writeFile('reports/material-ablation-aba.json', JSON.stringify(report, null, 2));
  console.log('Saved reports/material-ablation-aba.json');
}
