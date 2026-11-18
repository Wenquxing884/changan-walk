import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dist = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (filename !== dist && !filename.startsWith(`${dist}${path.sep}`)) {
      response.writeHead(403).end();
      return;
    }
    const contents = await readFile(filename);
    response.writeHead(200, { 'content-type': mimeTypes[path.extname(filename)] || 'application/octet-stream' });
    response.end(contents);
  } catch {
    response.writeHead(404).end('Not found');
  }
});

let browser;
try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [`--use-angle=${process.env.CHANGAN_ANGLE || (process.platform === 'win32' ? 'd3d11' : 'swiftshader')}`],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];
  const consoleErrors = [];
  const failedResponses = [];
  const failedRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('response', response => {
    if (response.status() >= 400) failedResponses.push({ url: response.url(), status: response.status() });
  });
  page.on('requestfailed', request => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const state = window.__CHANGAN__?.snapshot();
    return state?.ready && state.asset?.palaceLoaded && state.renderer.frame > 2 && state.renderer.triangles > 100;
  }, null, { timeout: 60_000 });
  const views = [];
  for (const destination of ['garden', 'market', 'palace', 'interior']) {
    await page.evaluate(id => window.__CHANGAN__.goTo(id), destination);
    await page.waitForFunction(id => {
      const state = window.__CHANGAN__.snapshot();
      return state.location === id && !state.transitioning;
    }, destination);
    await page.waitForTimeout(150);
    views.push(await page.evaluate(() => {
      const state = window.__CHANGAN__.snapshot();
      return { location: state.location, calls: state.renderer.calls, triangles: state.renderer.triangles };
    }));
  }
  const snapshot = await page.evaluate(() => window.__CHANGAN__.snapshot());
  assert.deepEqual(pageErrors, [], 'The production bundle must have no runtime errors.');
  assert.deepEqual(consoleErrors, [], 'The production shaders must compile without errors.');
  assert.deepEqual(failedResponses, [], 'All production resources must be served successfully.');
  assert.deepEqual(failedRequests, [], 'All production requests must complete successfully.');
  console.log(JSON.stringify({
    result: 'passed',
    source: 'dist',
    ready: snapshot.ready,
    palaceLoaded: snapshot.asset.palaceLoaded,
    palaceSource: snapshot.asset.palaceSource,
    frames: snapshot.renderer.frame,
    views,
    pageErrors,
    consoleErrors,
    failedResponses,
    failedRequests,
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
