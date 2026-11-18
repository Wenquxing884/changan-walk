import fs from 'node:fs/promises';
import path from 'node:path';
import * as THREE from 'three';
import { createCity } from '../src/city.js';
import { auditBuildingReachability } from '../src/building-reachability.js';

// Scene generation paints its own procedural textures. A no-op canvas suffices
// for this geometry-only audit; no browser, GPU or downloaded asset is needed.
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
  fillRect() {}, strokeRect() {}, fillText() {}, createLinearGradient() { return { addColorStop() {} }; },
}) }) };
const city = await createCity(new THREE.Scene());
const report = auditBuildingReachability(city.colliders, city.doors, city.buildings);
const result = { checkedAt: new Date().toISOString(), stats: city.stats, ...report };
const out = path.resolve('test-results/building-reachability.json');
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(out, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ reachable: report.reachable, total: report.total, radius: report.radius, resolution: report.resolution, unreachable: report.unreachable, report: out }, null, 2));
if (report.reachable !== report.total) process.exitCode = 1;
