import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.argv[2] || 'reports/performance-current.json';
const baseURL = process.env.CHANGAN_BASE_URL || 'http://127.0.0.1:5175/';
const sampleDuration = Math.max(3000, Number(process.env.CHANGAN_PROFILE_MS) || 3300);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11'] });
const report = { capturedAt: new Date().toISOString(), url: baseURL, viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1,
  sampleDurationMs: sampleDuration, browser: await browser.version(), note: 'One headless Chrome, GPU ANGLE D3D11. Local measurements are not cross-device guarantees.', scenarios: [], errors: [] };
try {
  const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: 1 });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.addInitScript(() => {
    const longTasks = [];
    try { new PerformanceObserver(list => { for (const entry of list.getEntries()) longTasks.push({ startTime: entry.startTime, duration: entry.duration }); }).observe({ type: 'longtask', buffered: true }); } catch {}
    const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : null;
    window.__PERF_PROBE__ = {
      longTasks,
      begin(name, duration) {
        const started = performance.now(), frames = [], renders = [];
        this.result = null; this.running = true;
        let previous = started;
        const frame = now => {
          frames.push(now - previous); previous = now;
          const state = window.__CHANGAN__.snapshot();
          renders.push({ calls: state.renderer.calls, triangles: state.renderer.triangles });
          if (now - started < duration) { requestAnimationFrame(frame); return; }
          const tasks = longTasks.filter(task => task.startTime >= started && task.startTime <= now);
          this.result = {
            name, durationMs: now - started, frames: frames.length, averageFPS: frames.length * 1000 / (now - started),
            frameTimeMs: { p50: percentile(frames, .5), p95: percentile(frames, .95), maximum: Math.max(...frames), over33: frames.filter(v => v > 33).length, over50: frames.filter(v => v > 50).length },
            renderer: { callsP50: percentile(renders.map(v => v.calls), .5), callsMax: Math.max(...renders.map(v => v.calls)), trianglesP50: percentile(renders.map(v => v.triangles), .5), trianglesMax: Math.max(...renders.map(v => v.triangles)) },
            cpuLongTasks: { count: tasks.length, totalMs: tasks.reduce((sum, task) => sum + task.duration, 0), maximumMs: tasks.length ? Math.max(...tasks.map(task => task.duration)) : 0, entries: tasks },
            snapshot: state,
          };
          this.running = false;
        };
        requestAnimationFrame(frame);
      },
    };
  });
  const started = Date.now();
  // ?test only shortens destination travel and holds adaptive resolution fixed;
  // actors, lighting, geometry, postprocessing and shaders run normally.
  const url = new URL(baseURL); url.searchParams.set('test', '1');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__CHANGAN__?.snapshot().ready && window.__CHANGAN__.snapshot().asset?.palaceLoaded, null, { timeout: 90_000 });
  report.startup = { readyMs: Date.now() - started, longTasks: await page.evaluate(() => window.__PERF_PROBE__.longTasks) };
  const sample = async (name, action) => {
    await page.evaluate(({ name, duration }) => window.__PERF_PROBE__.begin(name, duration), { name, duration: sampleDuration });
    if (action) await action();
    await page.waitForFunction(() => !window.__PERF_PROBE__.running, null, { timeout: 60_000 });
    const result = await page.evaluate(() => window.__PERF_PROBE__.result);
    report.scenarios.push(result);
    console.log(JSON.stringify({ name, ...result.frameTimeMs, fps: result.averageFPS, calls: result.renderer.callsP50, triangles: result.renderer.trianglesP50, longTasks: result.cpuLongTasks.count }));
  };
  const visit = async destination => {
    await page.evaluate(id => window.__CHANGAN__.goTo(id), destination);
    await page.waitForFunction(id => { const s = window.__CHANGAN__.snapshot(); return s.location === id && !s.transitioning; }, destination);
    await page.waitForTimeout(500);
  };
  await page.waitForTimeout(1000);
  await sample('overview');
  await visit('market');
  await sample('market');

  const approachTea = async () => {
    await page.evaluate(() => {
      const app = window.__CHANGAN__, door = app.doors.find(d => d.kind === 'shop' && d.label.includes('茶')) || app.doors.find(d => d.kind === 'shop');
      window.__PROFILE_TEA_DOOR__ = door.id;
      app.setPlayerPosition(door.position.x + door.normal.x * 2.2, door.position.z + door.normal.z * 2.2);
      app.facePlayer(door.position.x - door.normal.x * 4, door.position.z - door.normal.z * 4);
    });
    await page.waitForFunction(() => window.__CHANGAN__.snapshot().nearbyDoor?.id === window.__PROFILE_TEA_DOOR__);
    if (!(await page.evaluate(() => window.__CHANGAN__.doors.find(d => d.id === window.__PROFILE_TEA_DOOR__).open))) await page.keyboard.press('e');
    await page.waitForTimeout(450);
    await page.keyboard.down('w');
    try { await page.waitForFunction(() => Boolean(window.__CHANGAN__.snapshot().insideBuilding)); }
    finally { await page.keyboard.up('w'); }
  };
  await sample('tea-first-open-and-enter', approachTea);
  await page.evaluate(() => {
    const app = window.__CHANGAN__, door = app.doors.find(d => d.id === window.__PROFILE_TEA_DOOR__);
    app.setPlayerPosition(door.position.x + door.normal.x * 3, door.position.z + door.normal.z * 3);
    if (door.open) app.interactDoor(door.id);
  });
  await page.waitForTimeout(650);
  await sample('tea-repeat-open-and-enter', approachTea);

  await visit('palace');
  await sample('palace');
  await visit('interior');
  await sample('interior');
  await visit('garden');
  await sample('garden-entry');
  await page.evaluate(() => {
    const app = window.__CHANGAN__;
    app.setPlayerPosition(128, -116); app.facePlayer(128, -158);
  });
  await page.waitForTimeout(500);
  await sample('garden-bridge');
  report.gpu = await page.evaluate(() => {
    const gl = window.__CHANGAN__.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), pixelRatio: window.__CHANGAN__.renderer.getPixelRatio() };
  });
} finally {
  await browser.close();
  await mkdir(new URL('../reports/', import.meta.url), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(`Saved ${output}`);
}
