import { test, expect } from '@playwright/test';

test('resolution changes redraw the canvas before presenting and keep postprocessing aligned', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Exercise the normal runtime. ?test disables adaptive resolution.
  await page.goto('/');
  await page.waitForFunction(() => window.__CHANGAN__?.snapshot().ready, null, { timeout: 90_000 });
  await page.evaluate(() => {
    const app = window.__CHANGAN__;
    app.setAnimationEnabled(false);
    const renderer = app.renderer;
    const probe = window.__RESIZE_PROBE__ = { changes: [], presents: [], lastPresented: -1 };
    for (const name of ['setSize', 'setPixelRatio', 'setDrawingBufferSize']) {
      const original = renderer[name];
      renderer[name] = function (...args) {
        const frame = app.snapshot().renderer.frame;
        probe.changes.push({ name, frame, afterPresent: frame === probe.lastPresented, args });
        return original.apply(this, args);
      };
    }
    const render = renderer.render;
    renderer.render = function (...args) {
      const result = render.apply(this, args);
      if (this.getRenderTarget() === null) {
        const gl = this.getContext();
        const pixel = new Uint8Array(4);
        let brightness = 0;
        for (const [x, y] of [[.2, .35], [.5, .5], [.8, .65]]) {
          gl.readPixels(Math.floor(gl.drawingBufferWidth * x), Math.floor(gl.drawingBufferHeight * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          brightness += pixel[0] + pixel[1] + pixel[2];
        }
        probe.lastPresented = app.snapshot().renderer.frame;
        probe.presents.push({ frame: probe.lastPresented, brightness, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight });
      }
      return result;
    };
  });

  for (const ratio of [.88, .96, .86, 1]) {
    const start = await page.evaluate(value => {
      const app = window.__CHANGAN__;
      app.requestViewportResize(value);
      return app.snapshot().renderer.frame;
    }, ratio);
    await page.waitForFunction(({ start, ratio }) => {
      const state = window.__CHANGAN__.snapshot();
      return state.renderer.frame > start + 3 && Math.abs(state.pixelRatio - ratio) < .001;
    }, { start, ratio });
  }

  await page.setViewportSize({ width: 1180, height: 840 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#world');
    const app = window.__CHANGAN__;
    return canvas.width === Math.floor(innerWidth * app.renderer.getPixelRatio()) && canvas.clientWidth === innerWidth;
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#world');
    return canvas.clientWidth === innerWidth && canvas.width === Math.floor(innerWidth * window.__CHANGAN__.renderer.getPixelRatio());
  });
  const report = await page.evaluate(() => {
    const app = window.__CHANGAN__;
    return { ...window.__RESIZE_PROBE__, ratio: app.renderer.getPixelRatio(), cssWidth: innerWidth, cssHeight: innerHeight };
  });
  expect(report.changes.length, 'The regression must actually reallocate the drawing buffer.').toBeGreaterThanOrEqual(6);
  expect(report.changes.filter(change => change.afterPresent), 'No drawing-buffer resize may clear a frame after it has been painted.').toEqual([]);
  expect(report.changes.every(change => change.name === 'setDrawingBufferSize'), 'Each change must use one atomic drawing-buffer allocation.').toBe(true);
  expect(report.presents.length).toBeGreaterThan(8);
  expect(report.presents.every(frame => frame.brightness > 20), 'Every presented frame must contain rendered scenery.').toBe(true);
  expect(errors).toEqual([]);
  await testInfo.attach('resolution-presentation.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
});
