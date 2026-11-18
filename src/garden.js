import * as THREE from 'three';
import { GARDEN_LAYOUT, GARDEN_CAMERAS, gardenPondPoint, getGardenBridgeHeight, getGardenHeight } from './garden-layout.js';

const rectangle = (x, z, width, depth) => ({ x0: x - width / 2, x1: x + width / 2, z0: z - depth / 2, z1: z + depth / 2 });

function subtractRect(rect, cut) {
  const x0 = Math.max(rect.x0, cut.x0), x1 = Math.min(rect.x1, cut.x1), z0 = Math.max(rect.z0, cut.z0), z1 = Math.min(rect.z1, cut.z1);
  if (x0 >= x1 || z0 >= z1) return [rect];
  const parts = [];
  if (rect.x0 < x0) parts.push({ ...rect, x1: x0 });
  if (x1 < rect.x1) parts.push({ ...rect, x0: x1 });
  if (rect.z0 < z0) parts.push({ x0, x1, z0: rect.z0, z1: z0 });
  if (z1 < rect.z1) parts.push({ x0, x1, z0: z1, z1: rect.z1 });
  return parts;
}

function surfaceRibbon(points, width, thickness = .3) {
  const positions = [], uvs = [], indices = [];
  for (let i = 0; i < points.length; i++) {
    const [x, y, z] = points[i];
    for (const [dx, dy] of [[-width / 2, 0], [width / 2, 0], [-width / 2, -thickness], [width / 2, -thickness]]) {
      positions.push(x + dx, y + dy, z); uvs.push((x + dx) / 3, z / 3);
    }
  }
  for (let i = 0; i < points.length - 1; i++) {
    const a = i * 4, b = a + 4;
    indices.push(a, a + 1, b, a + 1, b + 1, b, a + 2, b + 2, a + 3, a + 3, b + 2, b + 3,
      a, b, a + 2, a + 2, b, b + 2, a + 1, a + 3, b + 1, a + 3, b + 3, b + 1);
  }
  const first = 0, last = (points.length - 1) * 4;
  indices.push(first, first + 2, first + 1, first + 1, first + 2, first + 3,
    last, last + 1, last + 2, last + 1, last + 3, last + 2);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function planShape(points) {
  const shape = new THREE.Shape();
  points.forEach(([x, z], index) => index ? shape.lineTo(x, -z) : shape.moveTo(x, -z));
  shape.closePath(); return shape;
}

/** The complete garden reuses the city material and spatial batching pools. */
export function createGarden({ m, geo, rand, instance, box, cylinder, beam, roof, inFrame, obstacle, lantern, tree, calligraphySign, groundRects }) {
  const { center, pond, bridge, gallery, pavilions } = GARDEN_LAYOUT;
  const [gx, gz] = center;
  const stats = { bridgeLength: bridge.southZ - bridge.northZ, bridgeWidth: bridge.width,
    galleryLength: gallery.segments.reduce((sum, [x0, z0, x1, z1]) => sum + Math.hypot(x1 - x0, z1 - z0), 0),
    pavilions: pavilions.length, blossomTrees: 12, lilyPads: 40, bridgePosts: 0, galleryBays: 0, waterObstacles: 0 };

  groundRects.push({ rect: { x0: 102.5, x1: 151.4, z0: -165, z1: -84 }, material: m.grass });
  const shoreline = Array.from({ length: pond.segments }, (_, i) => gardenPondPoint(i / pond.segments));
  const waterShape = planShape(shoreline);
  instance(new THREE.ShapeGeometry(waterShape), m.water, 0, GARDEN_LAYOUT.waterHeight, 0, 1, 1, 1, -Math.PI / 2, 0, 0, false, false);

  // One existing water draw, with a tiny shader-normal ripple: no reflection
  // camera, render target, separate wave mesh or per-frame vertex uploads.
  const waterTime = { value: 0 };
  m.water.onBeforeCompile = shader => {
    shader.uniforms.gardenTime = waterTime;
    shader.vertexShader = 'varying vec3 gardenPosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ngardenPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = 'uniform float gardenTime; varying vec3 gardenPosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec2 wave = vec2(sin(gardenPosition.x * 1.7 + gardenPosition.z * .47 + gardenTime * .68), cos(gardenPosition.z * 1.4 - gardenPosition.x * .38 - gardenTime * .53));
      normal = normalize(normal + mat3(viewMatrix) * vec3(wave.x * .046, 0., wave.y * .046));`);
  };
  m.water.customProgramCacheKey = () => 'garden-water-ripple-v1';
  m.water.roughness = .29; m.water.opacity = .91;

  // A paved ring makes the edge legible and gives visitors a full shore walk.
  const promenade = planShape(Array.from({ length: pond.segments }, (_, i) => gardenPondPoint(i / pond.segments, 1.19)));
  const inner = planShape(Array.from({ length: pond.segments }, (_, i) => gardenPondPoint(i / pond.segments, 1.07)));
  promenade.holes.push(new THREE.Path(inner.getPoints()));
  instance(new THREE.ShapeGeometry(promenade), m.pavingLight, 0, .085, 0, 1, 1, 1, -Math.PI / 2);
  for (let i = 0; i < shoreline.length; i++) {
    const [x0, z0] = shoreline[i], [x1, z1] = shoreline[(i + 1) % shoreline.length];
    const x = (x0 + x1) / 2, z = (z0 + z1) / 2, length = Math.hypot(x1 - x0, z1 - z0);
    // Bridge abutments interrupt the curb rather than cutting through it.
    if (Math.abs(x - bridge.x) < bridge.width / 2 + .7) continue;
    box(m.stone, x, .2, z, .48, .38, length + .08, Math.atan2(x1 - x0, z1 - z0));
  }
  for (let i = 0; i < 30; i++) {
    const [x, z] = gardenPondPoint(i / 30, 1.025);
    if (Math.abs(x - bridge.x) < 4) continue;
    instance(geo.leaf, i % 3 ? m.stone : m.wall, x, .26 + rand() * .12, z,
      1 + rand() * .7, .4 + rand() * .45, .85 + rand() * .65, .1, i * 1.4, .1);
  }

  // Continuous stone arch deck, spanning both banks and the northern pavilion.
  const count = 62;
  const bridgePoints = Array.from({ length: count + 1 }, (_, i) => {
    const z = bridge.southZ + (bridge.northZ - bridge.southZ) * i / count;
    return [bridge.x, getGardenBridgeHeight(z), z];
  });
  instance(surfaceRibbon(bridgePoints, bridge.width, .32), m.pavingLight, 0, 0, 0);
  for (const [z0, z1] of [[bridge.southZ + bridge.approach, bridge.southZ], [bridge.northZ, -153]]) {
    const points = [[bridge.x, getGardenBridgeHeight(z0), z0], [bridge.x, getGardenBridgeHeight(z1), z1]];
    instance(surfaceRibbon(points, bridge.width, .28), m.stone, 0, 0, 0);
  }
  // Side arch ribs read from the water, without filling the opening below.
  for (const side of [-1, 1]) {
    const x = bridge.x + side * (bridge.width / 2 - .18);
    for (let i = 0; i < count; i += 2) {
      const p0 = bridgePoints[i], p1 = bridgePoints[Math.min(i + 2, count)];
      beam(new THREE.Vector3(x, p0[1] - .4, p0[2]), new THREE.Vector3(x, p1[1] - .4, p1[2]), .2, m.stone);
    }
    for (let i = 0; i <= 24; i++) {
      const z = bridge.southZ + (bridge.northZ - bridge.southZ) * i / 24, y = getGardenBridgeHeight(z);
      cylinder(m.stone, x, y + .63, z, .14, 1.26);
      box(m.pavingLight, x, y + 1.28, z, .42, .16, .42);
      instance(geo.sphere, m.stone, x, y + 1.44, z, .2, .19, .2);
      box(m.stone, x, y + .08, z, .42, .16, .46);
      stats.bridgePosts++;
      if (i < 24) {
        const nextZ = bridge.southZ + (bridge.northZ - bridge.southZ) * (i + 1) / 24, nextY = getGardenBridgeHeight(nextZ);
        for (const h of [.55, 1.09]) beam(new THREE.Vector3(x, y + h, z), new THREE.Vector3(x, nextY + h, nextZ), .075, m.stone);
        box(m.red, x, y + .78, z + (nextZ - z) / 2, .09, .33, .28);
      }
    }
    obstacle(x, (bridge.southZ + bridge.northZ) / 2, .28, bridge.southZ - bridge.northZ + .1, 8);
  }
  for (let i = 1; i < count; i += 2) {
    const z = bridge.southZ + (bridge.northZ - bridge.southZ) * i / count, y = getGardenBridgeHeight(z);
    box(m.stone, bridge.x, y + .008, z, bridge.width - .56, .012, .035);
  }
  for (const z of [bridge.southZ - 2, bridge.northZ + 2]) {
    for (const side of [-1, 1]) lantern(bridge.x + side * 2.84, getGardenBridgeHeight(z) + 1.05, z, .67, true);
  }

  const raisedFloorRects = [];
  const addFloor = (rect, height = gallery.floorHeight) => {
    let parts = [rect];
    for (const cut of raisedFloorRects) parts = parts.flatMap(part => subtractRect(part, cut));
    for (const p of parts) box(m.pavingLight, (p.x0 + p.x1) / 2, height / 2, (p.z0 + p.z1) / 2, p.x1 - p.x0, height, p.z1 - p.z0);
    raisedFloorRects.push(rect);
  };
  for (const p of pavilions) addFloor(rectangle(p.x, p.z, p.width, p.depth), p.floorHeight);
  const galleryRects = gallery.segments.map(([x0, z0, x1, z1]) => ({
    x0: Math.min(x0, x1) - (x0 === x1 ? gallery.width / 2 : 0), x1: Math.max(x0, x1) + (x0 === x1 ? gallery.width / 2 : 0),
    z0: Math.min(z0, z1) - (z0 === z1 ? gallery.width / 2 : 0), z1: Math.max(z0, z1) + (z0 === z1 ? gallery.width / 2 : 0),
  }));
  galleryRects.forEach(rect => addFloor(rect));
  for (const x of [105.5, 147]) addFloor(rectangle(x, -158, gallery.width, gallery.width));
  // A shallow stone ramp connects the long gallery to the public footpath.
  inFrame(105.5, 0, 0, 0, () => {
    instance(surfaceRibbon([[0, .4, -91], [0, .08, -87]], gallery.width, .22), m.stone, 0, 0, 0);
  });
  const entry = GARDEN_LAYOUT.entryPath;
  box(m.pavingLight, (entry.minX + entry.maxX) / 2, .045, (entry.minZ + entry.maxZ) / 2, entry.maxX - entry.minX, .09, entry.maxZ - entry.minZ);

  function gallerySection(x0, z0, x1, z1, openStart = false, openEnd = false) {
    const length = Math.hypot(x1 - x0, z1 - z0), bays = Math.max(1, Math.ceil(length / gallery.bayLength));
    const angle = -Math.atan2(z1 - z0, x1 - x0), y = gallery.floorHeight, half = gallery.width / 2;
    inFrame((x0 + x1) / 2, 0, (z0 + z1) / 2, angle, () => {
      roof(0, gallery.eaveHeight, 0, length + .8, gallery.width + 1.5, 1.25, m.roof, false, false);
      for (const side of [-1, 1]) {
        box(m.red, 0, gallery.eaveHeight - .2, side * (half - .12), length, .32, .26);
        box(m.gold, 0, gallery.eaveHeight - .38, side * (half - .12), length, .055, .28);
        for (let i = 0; i <= bays; i++) {
          const x = -length / 2 + i * length / bays;
          // Remove only the junction's inner column line: both routes stay
          // continuous under the elbow or pavilion's own structural frame.
          const junction = (openStart && x < -length / 2 + 3) || (openEnd && x > length / 2 - 3);
          if (!junction) {
            cylinder(m.stone, x, y + .1, side * (half - .15), .27, .2);
            cylinder(m.redLight, x, (y + gallery.eaveHeight) / 2, side * (half - .15), .125, gallery.eaveHeight - y);
            box(m.red, x, gallery.eaveHeight - .22, side * (half - .15), .85, .2, .55);
            box(m.gold, x, gallery.eaveHeight - .36, side * (half - .15), .56, .08, .68);
            obstacle(x, side * (half - .15), .36, .36, gallery.eaveHeight);
          }
          if (i < bays && i % 3 === 1 && side > 0) lantern(x + length / bays / 2, gallery.eaveHeight - .74, 0, .76, true);
          if (i < bays && i % 3 !== 0) {
            const mid = x + length / bays / 2;
            box(m.timber, mid, y + .53, side * (half - .2), length / bays - .35, .13, .53);
            box(m.red, mid, y + .96, side * (half - .08), length / bays - .25, .09, .10);
            for (let k = 1; k < 4; k++) box(m.red, x + k * length / bays / 4, y + .73, side * (half - .08), .07, .4, .07);
          }
        }
      }
      for (let i = 0; i < bays; i++) box(m.timber, -length / 2 + (i + .5) * length / bays, gallery.eaveHeight - .27, 0, .14, .18, gallery.width - .14);
    });
    stats.galleryBays += bays;
  }
  gallerySection(105.5, -91, 105.5, -158, false, true);
  gallerySection(105.5, -158, 122, -158, true, false);
  gallerySection(134, -158, 147, -158, false, true);
  gallerySection(147, -158, 147, -147.5, true, false);
  // Raised hip roofs settle the two turns; eaves are at a different height
  // from the adjoining galleries, avoiding coplanar roof intersections.
  for (const x of [105.5, 147]) roof(x, gallery.eaveHeight + .22, -158, 7, 7, 1.65, m.roof, true, false);

  for (const p of pavilions) {
    const hx = p.width / 2 - .65, hz = p.depth / 2 - .65, fy = p.floorHeight;
    inFrame(p.x, 0, p.z, 0, () => {
      roof(0, p.eaveHeight, 0, p.width + 2, p.depth + 2, 2.15, m.roof, true, false);
      for (const x of [-hx, hx]) for (const z of [-hz, hz]) {
        cylinder(m.stone, x, fy + .1, z, .32, .2);
        cylinder(m.redLight, x, (fy + p.eaveHeight) / 2, z, .17, p.eaveHeight - fy);
        box(m.red, x, p.eaveHeight - .2, z, 1.1, .24, .55);
        box(m.gold, x, p.eaveHeight - .39, z, .75, .10, .65);
        obstacle(x, z, .4, .4, p.eaveHeight);
      }
      for (const z of [-hz, hz]) {
        box(m.red, 0, p.eaveHeight - .22, z, p.width - 1, .3, .25);
        box(m.gold, 0, p.eaveHeight - .42, z, p.width - 1.15, .06, .27);
        // Side benches leave both the north/south axis and gallery crossing open.
        for (const side of [-1, 1]) {
          box(m.timber, side * (hx - .95), fy + .5, z, 1.8, .16, .58);
          box(m.red, side * (hx - .95), fy + .22, z, 1.5, .4, .16);
        }
      }
      for (const side of [-1, 1]) {
        box(m.red, side * hx, p.eaveHeight - .22, 0, .25, .3, p.depth - 1);
        lantern(side * (hx - .45), p.eaveHeight - .8, hz - .35, .95, true);
      }
      calligraphySign(0, p.eaveHeight - .7, hz + .1, p.name);
    });
  }

  // Preserve all twelve existing garden trees while keeping their trunks and
  // crowns off the bridge and the covered walk; add willow-like bank accents.
  const treeSites = [[110, -98], [143, -88.5], [114, -89], [149, -96], [150, -113], [150, -132],
    [118, -146], [139, -148], [110, -147], [113, -153], [119, -162.5], [139, -163]];
  treeSites.forEach(([x, z], i) => tree(x, z, i % 3 === 0 ? 'green' : 'pink', .85 + rand() * .3));
  for (const [x, z] of [[110, -123], [143, -105]]) {
    cylinder(m.bark, x, 2, z, .16, 4);
    for (let i = 0; i < 7; i++) {
      const a = i * Math.PI * 2 / 7, dx = Math.cos(a), dz = Math.sin(a);
      beam(new THREE.Vector3(x, 2.7, z), new THREE.Vector3(x + dx * 1.6, 4.4, z + dz * 1.6), .07, m.bark);
      instance(geo.leaf, i % 2 ? m.leaf : m.leafAlt, x + dx * 2, 3.2, z + dz * 2, .72, 2.0, .68, .1, a, -.15);
    }
  }
  // More varied lotus leaves and flowers keep open water under the bridge.
  const pads = [];
  for (let attempts = 0; pads.length < stats.lilyPads && attempts < 800; attempts++) {
    const x = gx - 13 + rand() * 26, z = gz - 18 + rand() * 36;
    if (Math.abs(x - bridge.x) < 4.2 || ((x - gx) / 14) ** 2 + ((z - gz) / 20) ** 2 > .92) continue;
    pads.push([x, z]);
  }
  for (const [i, [x, z]] of pads.entries()) {
    cylinder(i % 3 ? m.leafAlt : m.leaf, x, .15 + i % 2 * .008, z, .32 + rand() * .23, .026);
    if (i % 4 === 0) {
      cylinder(m.leaf, x, .31, z, .025, .33);
      for (let j = 0; j < 5; j++) {
        const a = j / 5 * Math.PI * 2;
        instance(geo.sphere, j % 2 ? m.blossom : m.blossomLight, x + Math.cos(a) * .13, .49, z + Math.sin(a) * .13, .16, .08, .12, 0, a);
      }
      instance(geo.sphere, m.gold, x, .51, z, .075, .045, .075);
    }
  }
  for (const t of [.08, .17, .34, .43, .64, .77, .9]) {
    const [x, z] = gardenPondPoint(t, .96);
    if (Math.abs(x - bridge.x) < 4) continue;
    for (let i = 0; i < 6; i++) {
      const xx = x + (rand() - .5) * 1.3, zz = z + (rand() - .5) * 1.3, h = .6 + rand() * .7;
      cylinder(m.leaf, xx, .12 + h / 2, zz, .025, h);
      instance(geo.leaf, m.leafAlt, xx + .1, h * .65, zz, .1, .4, .07, 0, i, -.25);
    }
  }

  // Water is an actual obstacle. Scanline strips follow its outline, with a
  // full-width clearance for the bridge so visitors never walk on the water.
  const minZ = Math.min(...shoreline.map(p => p[1])), maxZ = Math.max(...shoreline.map(p => p[1])), rows = Math.ceil(maxZ - minZ);
  for (let row = 0; row < rows; row++) {
    const z0 = minZ + row * (maxZ - minZ) / rows, z1 = minZ + (row + 1) * (maxZ - minZ) / rows;
    const z = (z0 + z1) / 2, xs = [];
    for (let i = 0; i < shoreline.length; i++) {
      const a = shoreline[i], b = shoreline[(i + 1) % shoreline.length];
      if ((a[1] <= z && b[1] > z) || (b[1] <= z && a[1] > z)) xs.push(a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]));
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i += 2) {
      let parts = [{ x0: xs[i] + .1, x1: xs[i + 1] - .1, z0, z1 }];
      parts = parts.flatMap(part => subtractRect(part, { x0: bridge.x - bridge.width / 2, x1: bridge.x + bridge.width / 2, z0: -170, z1: -80 }));
      for (const cut of raisedFloorRects) parts = parts.flatMap(part => subtractRect(part, cut));
      for (const p of parts) if (p.x1 - p.x0 > .1) {
        obstacle((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, p.x1 - p.x0, p.z1 - p.z0, 9); stats.waterObstacles++;
      }
    }
  }
  // The bridge and gallery retain a shared specification for tests and the UI.
  return { stats, getHeight: getGardenHeight, location: { label: '曲池亭廊', ...GARDEN_CAMERAS.entry },
    update(elapsed) { waterTime.value = elapsed; } };
}
