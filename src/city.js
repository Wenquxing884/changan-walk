import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createResidents } from './residents.js';
import { createDoorSystem } from './doors.js';
import { createInteriorSystem, INTERIOR_TYPES } from './building-interiors.js';
import { auditBuildingReachability } from './building-reachability.js';
import { PALACE_LAYOUT, PALACE_WORLD, PALACE_FLOOR, PALACE_CAMERAS, getPalaceHeight, isPalaceInterior } from './palace-layout.js';
import { createGarden } from './garden.js';
import { GARDEN_LAYOUT } from './garden-layout.js';

// All architecture is built at metre scale. Roofs, building parts and street
// furniture share source geometry and are batched by material in spatial cells,
// so turning away from a district also turns off its draw calls.
const COLORS = {
  roof: 0x243a48, roofAlt: 0x344852, roofWarm: 0x625440,
  ridge: 0xa18855, red: 0x713023, redLight: 0x963e29,
  timber: 0x4a3026, plaster: 0xc5b18b, stone: 0x8c8978,
  paving: 0x77776d, darkStone: 0x4c5654, gold: 0xc4a15c,
};

function seeded(seed = 7417) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

function paintedTexture(size, paint, repeat = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  paint(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

function makeMaterials() {
  const rand = seeded(86);
  const stoneMap = paintedTexture(256, (ctx, n) => {
    ctx.fillStyle = '#c7c4b7'; ctx.fillRect(0, 0, n, n);
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 8; col++) {
        const x = col * 40 + (row % 2) * 20, y = row * 32;
        const tone = 170 + Math.floor(rand() * 30);
        ctx.fillStyle = `rgb(${tone},${tone + 1},${tone - 5})`;
        ctx.fillRect(x + 1, y + 1, 38, 30);
        ctx.strokeStyle = 'rgba(235,227,207,.18)'; ctx.strokeRect(x + 2, y + 2, 36, 28);
      }
    }
  });
  const pavingMap = paintedTexture(256, (ctx, n) => {
    ctx.fillStyle = '#b1b1a4'; ctx.fillRect(0, 0, n, n);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      const tone = 153 + Math.floor(rand() * 30);
      ctx.fillStyle = `rgb(${tone},${tone + 2},${tone - 3})`;
      ctx.fillRect(x * 64 + (y % 2) * 32 + 1, y * 32 + 1, 62, 30);
      if (y % 2 && x === 0) ctx.fillRect(-31, y * 32 + 1, 62, 30);
    }
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = rand() > .5 ? 'rgba(255,255,240,.03)' : 'rgba(30,35,34,.03)';
      ctx.fillRect(rand() * n, rand() * n, 1 + rand() * 3, 1);
    }
  });
  const tileMap = paintedTexture(128, (ctx, n) => {
    ctx.fillStyle = '#a0adb0'; ctx.fillRect(0, 0, n, n);
    for (let x = 0; x < 8; x++) {
      const grad = ctx.createLinearGradient(x * 16, 0, x * 16 + 16, 0);
      grad.addColorStop(0, '#5e707a'); grad.addColorStop(.35, '#b3bfc0'); grad.addColorStop(.8, '#8f9da0'); grad.addColorStop(1, '#576b77');
      ctx.fillStyle = grad; ctx.fillRect(x * 16, 0, 16, n);
      for (let y = 0; y < 8; y++) {
        ctx.fillStyle = 'rgba(21,37,44,.32)'; ctx.fillRect(x * 16, y * 16, 16, 1.5);
        ctx.fillStyle = 'rgba(227,223,196,.22)'; ctx.fillRect(x * 16, y * 16 + 2, 16, 1);
      }
    }
  });
  const standard = (name, color, opts = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness: .84, ...opts }); m.name = name; return m;
  };
  return {
    roof: standard('Blue grey ceramic tiles', COLORS.roof, { map: tileMap, metalness: .14, side: THREE.DoubleSide }),
    roofAlt: standard('Weathered blue grey tiles', COLORS.roofAlt, { map: tileMap, metalness: .10, side: THREE.DoubleSide }),
    roofWarm: standard('Palace bronze glazed tiles', COLORS.roofWarm, { map: tileMap, metalness: .24, side: THREE.DoubleSide }),
    ridge: standard('Glazed ridge and eaves', COLORS.ridge, { roughness: .48, metalness: .35 }),
    red: standard('Vermilion painted columns', COLORS.red),
    redLight: standard('Vermilion balcony beams', COLORS.redLight),
    timber: standard('Dark carved timber', COLORS.timber),
    plaster: standard('Warm lime plaster', COLORS.plaster),
    plasterAlt: standard('Ochre lime plaster', 0x9a8c71),
    stone: standard('Dressed stone', COLORS.stone, { map: stoneMap }),
    wall: standard('Old city masonry', 0x6d736d, { map: stoneMap }),
    paving: standard('Grey flagstone', COLORS.paving, { map: pavingMap }),
    pavingLight: standard('Palace flagstone', 0xa5a18b, { map: pavingMap }),
    road: standard('Worn stone avenue', 0x79796c, { map: pavingMap }),
    soil: standard('Garden soil', 0x475044),
    grass: standard('Green outer plain', 0x3a4e43),
    gold: standard('Bronze details', COLORS.gold, { roughness: .4, metalness: .55 }),
    black: standard('Dark iron', 0x242d2b, { metalness: .4 }),
    window: standard('Amber paper windows', 0xdba95f, { emissive: 0xffa63a, emissiveIntensity: .65, roughness: .95 }),
    windowDim: standard('Unlit paper windows', 0x806b47, { emissive: 0xd78335, emissiveIntensity: .12 }),
    lantern: standard('Silk lantern glowing red', 0xf07730, { emissive: 0xff8227, emissiveIntensity: 2.3, roughness: .7 }),
    lanternGold: standard('Silk lantern glowing gold', 0xffcc6f, { emissive: 0xffa73c, emissiveIntensity: 2.2, roughness: .7 }),
    leaf: standard('Dark green leaves', 0x395d48),
    leafAlt: standard('Olive leaves', 0x63714a),
    blossom: standard('Peach blossom', 0xcf8e9a),
    blossomLight: standard('Pale peach blossom', 0xe9b2b4),
    ginkgo: standard('Autumn ginkgo', 0xb9a052),
    bark: standard('Tree bark', 0x554538),
    awningRed: standard('Red market silk', 0x8c4436, { side: THREE.DoubleSide }),
    awningCream: standard('Cream market silk', 0xcbb585, { side: THREE.DoubleSide }),
    pottery: standard('Terracotta', 0x9e6146),
    jade: standard('Jade glazed pottery', 0x5b9180, { roughness: .32 }),
    fruit: standard('Persimmons', 0xc98a3f),
    water: new THREE.MeshPhysicalMaterial({ name: 'Garden water', color: 0x28535b, roughness: .26, metalness: .45, transparent: true, opacity: .88, clearcoat: .7 }),
  };
}

const roofCache = new Map();
function hipRoofGeometry(width, depth, rise, curl = .35) {
  const key = [width, depth, rise, curl].join(':');
  if (roofCache.has(key)) return roofCache.get(key);
  const positions = [], uvs = [], indices = [];
  const ridge = width * .29, nx = width > 20 ? 10 : 8, ny = 5;
  const corner = Math.min(width, depth) * .055;
  const heightAt = (u, v) => rise * Math.pow(1 - v, 1.65) + curl * v ** 7 + corner * Math.abs(u) ** 7 * v ** 5;
  const patch = (side) => {
    const start = positions.length / 3;
    for (let j = 0; j <= ny; j++) {
      const v = j / ny;
      for (let i = 0; i <= nx; i++) {
        const u = i / nx * 2 - 1;
        let x, z;
        if (side < 2) {
          x = u * (ridge + (width / 2 - ridge) * v); z = (side ? -1 : 1) * depth / 2 * v;
        } else {
          x = (side === 2 ? -1 : 1) * (ridge + (width / 2 - ridge) * v); z = u * depth / 2 * v;
        }
        positions.push(x, heightAt(u, v), z);
        uvs.push(i / nx * (side < 2 ? width : depth) * .45, v * depth * .3);
      }
    }
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const a = start + j * (nx + 1) + i, b = a + nx + 1;
      if (side === 0 || side === 2) indices.push(a, b, a + 1, a + 1, b, b + 1);
      else indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  };
  for (let k = 0; k < 4; k++) patch(k);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  roofCache.set(key, geometry); return geometry;
}

function curvedStrip(width, depth, rise, curl = .35) {
  const half = width / 2, ridge = width * .29, corner = Math.min(width, depth) * .055;
  const points = [];
  // Continuous upswept perimeter. Each vertex lies on the roof edge.
  for (let i = 0; i <= 24; i++) {
    const u = i / 24 * 2 - 1;
    points.push(new THREE.Vector3(u * half, curl + corner * Math.abs(u) ** 7, depth / 2));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 16, .075, 4, false);
}

class InstanceDistricts {
  constructor(root) { this.root = root; this.batches = new Map(); this.count = 0; }
  add(geometry, material, matrix, shadow = false, receive = true) {
    const e = matrix.elements;
    const cell = `${Math.floor((e[12] + 240) / 150)}:${Math.floor((e[14] + 260) / 150)}`;
    const key = `${cell}/${geometry.uuid}/${material.uuid}/${+shadow}/${+receive}`;
    let b = this.batches.get(key);
    if (!b) { b = { geometry, material, matrices: [], shadow, receive, cell }; this.batches.set(key, b); }
    b.matrices.push(matrix.clone()); this.count++;
  }
  finish() {
    const grouped = new Map();
    for (const b of this.batches.values()) {
      const key = `${b.cell}/${b.material.uuid}/${+b.shadow}/${+b.receive}`;
      let group = grouped.get(key);
      if (!group) { group = { ...b, geometries: [] }; grouped.set(key, group); }
      for (const matrix of b.matrices) {
        const transformed = b.geometry.index ? b.geometry.toNonIndexed() : b.geometry.clone();
        for (const attr of Object.keys(transformed.attributes)) if (!['position', 'normal', 'uv'].includes(attr)) transformed.deleteAttribute(attr);
      if (!transformed.attributes.uv) transformed.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(transformed.attributes.position.count * 2), 2));
        transformed.applyMatrix4(matrix); group.geometries.push(transformed);
      }
    }
    for (const b of grouped.values()) {
      const geometry = mergeGeometries(b.geometries, false);
      b.geometries.forEach(g => g.dispose());
      if (!geometry) continue;
      geometry.computeBoundingSphere(); geometry.computeBoundingBox();
      const mesh = new THREE.Mesh(geometry, b.material);
      mesh.castShadow = b.shadow; mesh.receiveShadow = b.receive;
      mesh.name = `${b.material.name} · district ${b.cell}`;
      this.root.add(mesh);
    }
    return grouped.size;
  }
}

/**
 * Build the complete first playable Chang'an district.
 * @returns Promise<{root, colliders:THREE.Box3[],getHeight,update,palaceReady,stats}>
 */
export async function createCity(scene, { onProgress } = {}) {
  const root = new THREE.Group(); root.name = 'Chang’an · city districts'; scene.add(root);
  const m = makeMaterials(), rand = seeded();
  const geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 8),
    taper: new THREE.CylinderGeometry(.8, 1, 1, 10),
    sphere: new THREE.SphereGeometry(1, 8, 6),
    leaf: new THREE.IcosahedronGeometry(1, 1),
    cone: new THREE.ConeGeometry(1, 1, 10),
    torus: new THREE.TorusGeometry(1, .07, 5, 24),
  };
  const districts = new InstanceDistricts(root);
  let active = districts, frame = new THREE.Matrix4();
  const colliders = [], lamps = [], animated = [];
  const doorSystem = createDoorSystem(root, colliders, m);
  const interiorSystem = createInteriorSystem(root, m, geo.box, geo.cyl);
  let animationEnabled = true;
  let courtyardCount = 0;
  const tmp = new THREE.Matrix4(), quat = new THREE.Quaternion(), v = new THREE.Vector3(), scale = new THREE.Vector3();
  const roofEdges = new Map();
  let buildingCount = 0;
  const progress = (label, value) => onProgress?.({ label, progress: value });
  function instance(g, mat, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, shadow = false, receive = true) {
    quat.setFromEuler(new THREE.Euler(rx, ry, rz));
    tmp.compose(v.set(x, y, z), quat, scale.set(sx, sy, sz));
    tmp.premultiply(frame); active.add(g, mat, tmp, shadow, receive);
  }
  const box = (mat, x, y, z, w, h, d, ry = 0, shadow = false) => instance(geo.box, mat, x, y, z, w, h, d, 0, ry, 0, shadow);
  const cylinder = (mat, x, y, z, radius, height, ry = 0, shadow = false) => instance(geo.cyl, mat, x, y, z, radius, height, radius, 0, ry, 0, shadow);
  function inFrame(x, y, z, ry, fn) {
    const prev = frame;
    frame = prev.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1)));
    fn(); frame = prev;
  }
  function obstacle(x, z, w, d, h = 8, y = 0) {
    const b = new THREE.Box3(new THREE.Vector3(x - w / 2, y, z - d / 2), new THREE.Vector3(x + w / 2, y + h, z + d / 2));
    b.applyMatrix4(frame); colliders.push(b);
  }
  function beam(a, b, radius, mat = m.timber, shadow = false) {
    const direction = new THREE.Vector3().subVectors(b, a), length = direction.length();
    const middle = new THREE.Vector3().addVectors(a, b).multiplyScalar(.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    const mx = new THREE.Matrix4().compose(middle, q, new THREE.Vector3(radius, length, radius)).premultiply(frame);
    active.add(geo.cyl, mat, mx, shadow, true);
  }
  function roof(x, y, z, width, depth, rise, mat = m.roof, ornate = false, shadow = false) {
    const curl = ornate ? .42 : .24;
    instance(hipRoofGeometry(width, depth, rise, curl), mat, x, y, z, 1, 1, 1, 0, 0, 0, shadow);
    box(m.timber, x, y + .02, z, width - .7, .18, depth - .7);
    const edgeKey = [width, depth, rise, curl].join('/');
    if (!roofEdges.has(edgeKey)) roofEdges.set(edgeKey, curvedStrip(width, depth, rise, curl));
    const rim = roofEdges.get(edgeKey);
    instance(rim, ornate ? m.ridge : m.roofAlt, x, y, z);
    instance(rim, ornate ? m.ridge : m.roofAlt, x, y, z, 1, 1, 1, 0, Math.PI);
    beam(new THREE.Vector3(x - width * .29, y + rise + .04, z), new THREE.Vector3(x + width * .29, y + rise + .04, z), ornate ? .16 : .12, ornate ? m.gold : m.roofAlt);
    if (ornate) {
      for (const sign of [-1, 1]) {
        const a = new THREE.Vector3(x + sign * width * .29, y + rise, z);
        const b = new THREE.Vector3(x + sign * width * .34, y + rise + .6, z);
        beam(a, b, .13, m.ridge);
        instance(geo.sphere, m.gold, b.x, b.y, b.z, .2, .3, .18);
      }
    }
  }
  function lattice(x, y, z, w, h, lit = true) {
    box(lit ? m.window : m.windowDim, x, y, z, w, h, .08);
    const n = Math.max(2, Math.round(w / .45));
    for (let i = 0; i <= n; i++) box(m.timber, x - w / 2 + i * w / n, y, z + .055, .045, h + .08, .065);
    for (let j = -1; j <= 1; j++) box(m.timber, x, y + j * h / 3, z + .065, w, .045, .07);
    box(m.red, x, y - h / 2 - .08, z, w + .18, .12, .16);
    box(m.red, x, y + h / 2 + .08, z, w + .18, .12, .16);
  }
  function lantern(x, y, z, size = 1, golden = false) {
    const radius = .30 * size, height = .69 * size;
    cylinder(m.black, x, y + .58 * size, z, .018, .40 * size);
    instance(geo.sphere, golden ? m.lanternGold : m.lantern, x, y, z, radius, height / 2, radius, 0, 0, 0, false, false);
    for (const d of [-1, 1]) cylinder(m.gold, x, y + d * height * .46, z, radius * .66, .07 * size);
    cylinder(m.red, x, y - height * .7, z, .025 * size, .24 * size);
    const p = new THREE.Vector3(x, y, z).applyMatrix4(frame); lamps.push(p);
  }
  function lanternPost(x, z, paired = false, small = false) {
    const h = small ? 3.25 : 5.6;
    cylinder(m.stone, x, .3, z, .33, .6);
    cylinder(m.timber, x, h / 2 + .3, z, .105, h);
    box(m.gold, x, h - .18, z, .28, .12, .28);
    box(m.timber, x, h - .42, z, paired ? 1.9 : 1.2, .12, .14);
    roof(x, h + .1, z, .75, .65, .24, m.roof, false);
    lantern(x + (paired ? -.7 : -.35), h - 1, z, small ? 1.05 : 1.45, true);
    if (paired) lantern(x + .7, h - 1, z, 1.45, false);
    obstacle(x, z, .4, .4, h);
  }
  function house(x, z, { w = 10, d = 8, h = 4.4, floors = 1, ry = 0, ornate = false, lit = true, collision = true, shadow = false, courtyard = false, label = null, type = null } = {}) {
    buildingCount++;
    const buildingId = `building-${String(buildingCount).padStart(3, '0')}`;
    const interiorType = INTERIOR_TYPES.find(t => t.type === type) ?? INTERIOR_TYPES[(buildingCount - 1) % INTERIOR_TYPES.length];
    const doorWidth = Math.min(3, w * .34), doorHeight = 2.8;
    inFrame(x, 0, z, ry, () => {
      const base = .38, total = h * floors;
      box(m.stone, 0, base / 2, 0, w + .5, base, d + .5);
      const wallMaterial = ornate ? m.plaster : m.plasterAlt, thickness = .28, frontZ = d / 2 - .6;
      // A room is made from four thin walls. Front wall has a real opening;
      // neither a solid building box nor a window plane covers the doorway.
      box(wallMaterial, 0, base + total / 2, -d / 2 + thickness / 2, w, total, thickness);
      for (const s of [-1, 1]) box(wallMaterial, s * (w / 2 - thickness / 2), base + total / 2, -.22, thickness, total, d - .45);
      if (!courtyard) {
        const wing = (w - doorWidth) / 2;
        for (const s of [-1, 1]) box(wallMaterial, s * (doorWidth / 2 + wing / 2), base + doorHeight / 2, frontZ, wing, doorHeight, thickness);
        box(wallMaterial, 0, base + doorHeight + (total - doorHeight) / 2, frontZ, w, Math.max(.1, total - doorHeight), thickness);
        box(m.timber, 0, base + doorHeight + .05, frontZ + .04, doorWidth + .22, .17, .38);
        // The timber reveal slightly covers the plaster edge. Equal X faces
        // fight for depth when an open door exposes the side of the jamb.
        for (const s of [-1, 1]) box(m.timber, s * (doorWidth / 2 + .065), base + doorHeight / 2, frontZ + .04, .15, doorHeight, .37);
      }
      box(m.timber, 0, base + .035, -.26, w - .4, .065, d - .45);
      // Raised threshold is approached by an actual shallow ramp, matched by
      // getHeight. The ramp meets the base rather than overlapping its face.
      const rampShape = new THREE.Shape();
      rampShape.moveTo(-doorWidth / 2 - .22, 0); rampShape.lineTo(doorWidth / 2 + .22, 0);
      rampShape.lineTo(doorWidth / 2 + .22, 1.6); rampShape.lineTo(-doorWidth / 2 - .22, 1.6); rampShape.closePath();
      const ramp = new THREE.ShapeGeometry(rampShape);
      const rp = ramp.attributes.position;
      for (let i = 0; i < rp.count; i++) { const zz = rp.getY(i); rp.setXYZ(i, rp.getX(i), base * (1 - zz / 1.6), zz); }
      ramp.computeVertexNormals(); instance(ramp, m.stone, 0, .003, d / 2 + .26);
      const bays = Math.max(3, Math.round(w / 2.6));
      for (let k = 0; k <= bays; k++) {
        const px = -w / 2 + k * w / bays;
        if (Math.abs(px) < doorWidth / 2 + .2) continue;
        cylinder(ornate ? m.redLight : m.red, px, base + total / 2, d / 2 - .6, ornate ? .15 : .115, total, 0, shadow);
        cylinder(m.stone, px, base + .12, d / 2 - .6, .22, .24);
        if (ornate) {
          box(m.gold, px, base + total - .3, d / 2 - .6, .55, .12, .7);
          box(m.red, px, base + total - .56, d / 2 - .6, .38, .13, .6);
        }
      }
      for (let floor = 0; floor < floors; floor++) {
        const fy = base + floor * h;
        box(m.red, 0, fy + h - .3, d / 2 - .55, w + .1, .24, .3);
        box(m.timber, 0, fy + h - .65, d / 2 - .5, w, .13, .18);
        for (let k = 0; k < bays; k++) {
          const px = -w / 2 + (k + .5) * w / bays;
          if (floor === 0 && Math.abs(px) < doorWidth / 2 + (w / bays - .48) / 2 + .15) continue;
          if (!courtyard) lattice(px, fy + h * .52, frontZ + .19, w / bays - .48, h * .49, lit && (k + floor) % 3 !== 0);
        }
        if (floor > 0) {
          box(m.timber, 0, fy, d / 2, w + .8, .16, 1.3);
          box(m.red, 0, fy + .85, d / 2 + .6, w + .8, .08, .09);
          for (let k = 0; k <= bays * 3; k++) box(m.red, -w / 2 + k * w / (bays * 3), fy + .46, d / 2 + .6, .065, .85, .065);
          // The intermediate canopy lies below the upper facade, so its slope
          // cannot intersect the window plane and create a flashing grid.
          roof(0, fy - .42, .2, w + 2, d + 1.8, .28, m.roofAlt, ornate, shadow);
          box(m.timber, 0, fy + .06, -.2, w - .4, .12, d - .5);
        }
      }
      roof(0, base + total, 0, w + 2.1, d + 2.2, Math.min(3.2, w * .25), ornate ? m.roofWarm : m.roof, ornate, shadow);
      for (const side of [-1, 1]) {
        box(m.red, side * (w / 2 - .15), base + total - .3, 0, .2, .24, d);
        if (lit && w > 8) lantern(side * (w / 2 - .8), base + h - 1.05, d / 2 + .4, ornate ? 1.1 : .8);
      }
      if (collision) {
        obstacle(-w / 2 + thickness / 2, -.2, thickness, d - .4, total, base);
        obstacle(w / 2 - thickness / 2, -.2, thickness, d - .4, total, base);
        obstacle(0, -d / 2 + thickness / 2, w, thickness, total, base);
        const wing = (w - doorWidth) / 2;
        if (!courtyard) for (const s of [-1, 1]) obstacle(s * (doorWidth / 2 + wing / 2), frontZ, wing, thickness, total, base);
        const doorTransform = frame.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, frontZ));
        const door = courtyard ? null : doorSystem.add({ id: `${buildingId}-door`, label: label ?? interiorType.label, buildingId, kind: label ? 'shop' : 'building', matrix: doorTransform, width: doorWidth, height: doorHeight, base });
        const pos = new THREE.Vector3(0, 0, 0).applyMatrix4(frame);
        interiorSystem.add({ id: buildingId, label: label ?? interiorType.label, type: interiorType.type, description: interiorType.description,
          doorId: door?.id ?? null, door, position: pos.toArray(), transform: frame.clone(), w, d, floorHeight: base + .07,
          radius: Math.hypot(w / 2, d / 2), entry: door?.position.clone() ?? null, normal: door?.normal.clone() ?? null });
        // Furniture collision is static even while its visual meshes are lazily
        // hidden; entering a room never changes the collision map beneath you.
        const sideX = Math.max(2, w / 2 - 1.25), back = -d / 2 + 1.1;
        obstacle(-sideX, back, Math.min(2.4, w * .26) + .15, .7, 2.3, base);
        if (interiorType.type === 'home') {
          obstacle(sideX - .2, back + .3, 2.1, 2.7, 1.1, base);
          obstacle(-sideX, 1, 1.65, .85, .7, base);
        } else {
          for (const s of [-1, 1]) obstacle(s * (sideX - .15), -.3, 1.65, 1.12, 1, base);
          if (interiorType.type !== 'tea') obstacle(sideX, back, 2.3, .7, 2.3, base);
        }
      }
    });
  }

  function tree(x, z, type = 'green', s = 1, collision = false) {
    inFrame(x, .05, z, rand() * Math.PI * 2, () => {
      cylinder(m.bark, 0, 1.8 * s, 0, .15 * s, 3.6 * s);
      const leaf = type === 'pink' ? m.blossom : type === 'gold' ? m.ginkgo : m.leaf;
      const leaf2 = type === 'pink' ? m.blossomLight : m.leafAlt;
      for (let i = 0; i < 5; i++) {
        const a = i * Math.PI * 2 / 5;
        const bx = Math.cos(a) * 1.45 * s, bz = Math.sin(a) * 1.45 * s;
        beam(new THREE.Vector3(0, 2 * s, 0), new THREE.Vector3(bx, 3.8 * s, bz), .08 * s, m.bark);
        instance(geo.leaf, i % 3 ? leaf : leaf2, bx, (4 + (i % 2) * .5) * s, bz, 1.7 * s, 1.05 * s, 1.65 * s, .1, i, 0, false);
      }
      instance(geo.leaf, leaf, 0, 4.95 * s, 0, 1.8 * s, 1.2 * s, 1.8 * s);
      if (collision) obstacle(0, 0, .5 * s, .5 * s, 4 * s);
    });
  }
  function planter(x, z, w = 2.8, d = 2.8, type = 'green') {
    box(m.stone, x, .28, z, w, .56, d);
    box(m.soil, x, .57, z, w - .23, .04, d - .23);
    tree(x, z, type, .82, false); obstacle(x, z, w, d, .65);
  }
  function marketStall(x, z, side, variant) {
    inFrame(x, 0, z, side * Math.PI / 2, () => {
      for (const px of [-1.7, 1.7]) for (const pz of [-.9, .9]) cylinder(m.timber, px, 1.5, pz, .055, 3);
      box(variant % 2 ? m.awningCream : m.awningRed, 0, 2.9, 0, 4.2, .12, 2.8);
      for (let k = 0; k < 10; k++) box(variant % 2 ? m.awningRed : m.awningCream, -1.9 + k * .42, 2.84, 1.43, .39, .33, .07);
      box(m.timber, 0, .85, .4, 3.7, .13, 1.4);
      box(m.red, 0, .42, .8, 3.5, .8, .2);
      for (let i = 0; i < 9; i++) {
        const px = -1.45 + (i % 5) * .65, pz = .05 + Math.floor(i / 5) * .45;
        if (variant % 3 === 0) instance(geo.sphere, m.fruit, px, 1.04, pz, .19, .17, .18);
        else {
          cylinder(variant % 3 === 1 ? m.pottery : m.jade, px, 1.12, pz, .20, .40);
          cylinder(m.timber, px, 1.34, pz, .13, .05);
        }
      }
      lantern(-1.9, 2.25, 1.1, .75, true);
      obstacle(0, .1, 4, 2.4, 3.2);
    });
  }
  function calligraphySign(x, y, z, text, ry = 0) {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#34251c'; ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#b39050'; ctx.lineWidth = 6; ctx.strokeRect(9, 9, 494, 110);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#d8b66c';
    ctx.font = '68px "KaiTi", "STKaiti", "Noto Serif SC", serif'; ctx.fillText(text, 256, 66);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshStandardMaterial({ map: texture, roughness: .8, emissive: 0x80622b, emissiveMap: texture, emissiveIntensity: .22 });
    instance(geo.box, m.timber, x, y, z - .05, 4.3, 1.12, .14, 0, ry);
    instance(new THREE.PlaneGeometry(4.1, 1.02), mat, x, y, z + .031, 1, 1, 1, 0, ry);
  }
  function wall(x, z, width, depth, height = 6.5, palace = false, ry = 0) {
    inFrame(x, 0, z, ry, () => {
      box(palace ? m.red : m.wall, 0, height / 2, 0, width, height, depth);
      box(m.stone, 0, .4, 0, width + .4, .8, depth + .4);
      box(m.stone, 0, height + .08, 0, width + .3, .24, depth + .4);
      if (palace) {
        roof(0, height + .16, 0, width + .5, depth + 1.4, .9, m.roof, false);
      } else {
        const n = Math.floor(width / 4.2);
        for (let i = 0; i < n; i++) {
          for (const s of [-1, 1]) box(m.wall, -width / 2 + (i + .5) * width / n, height + .65, s * (depth / 2 - .23), 2.25, 1.1, .65);
        }
      }
      obstacle(0, 0, width, depth, height + 1.5);
    });
  }
  function gate(x, z, palace = false) {
    inFrame(x, 0, z, 0, () => {
      const w = palace ? 27 : 34, d = palace ? 9 : 12, h = palace ? 5.7 : 7.6;
      for (const side of [-1, 1]) {
        box(palace ? m.red : m.stone, side * (w / 4 + 3.5), h / 2, 0, w / 2 - 7, h, d);
        box(m.stone, side * (w / 4 + 3.5), .35, 0, w / 2 - 6.7, .7, d + .4);
        obstacle(side * (w / 4 + 3.5), 0, w / 2 - 7, d, h + 1);
        for (const edge of [-1, 1]) cylinder(m.red, side * 6.9, h * .48, edge * (d / 2 + .2), .32, h * .96);
      }
      box(palace ? m.red : m.stone, 0, h - .4, 0, w, 1.3, d);
      const upper = h + .2;
      box(m.plaster, 0, upper + 2, 0, w - 4, 4, d - 2);
      for (let i = -4; i <= 4; i++) {
        cylinder(m.redLight, i * (w - 5) / 8, upper + 2, d / 2 - .4, .18, 4);
        if (i < 4) lattice((i + .5) * (w - 5) / 8, upper + 2, d / 2 - .25, (w - 5) / 8 - .5, 2.05, true);
      }
      roof(0, upper + .1, 0, w + 4, d + 4.5, 2.8, palace ? m.roofWarm : m.roof, true, true);
      roof(0, upper + 4, 0, w + 2, d + 2.5, 3.5, palace ? m.roofWarm : m.roof, true, true);
      box(m.red, 0, upper + .8, d / 2 + 1.1, w + 1, .12, .12);
      for (let i = -12; i <= 12; i++) box(m.red, i * w / 24, upper + .44, d / 2 + 1.1, .075, .7, .075);
      for (const side of [-1, 1]) {
        lantern(side * 5.7, h - 1.25, d / 2 + .25, 2.3, true);
        lantern(side * 9.5, h - 1.25, d / 2 + .25, 1.6);
      }
      calligraphySign(0, h + 2.35, d / 2 + .2, palace ? '承天门' : '长安');
    });
  }

  progress('铺设城坊与朱雀大街', .13);
  // Ground and the city's stone foundation are deliberately independent from
  // building chunks, allowing the main camera to reveal their whole silhouette.
  box(m.grass, 0, -1.35, -35, 1450, 1, 1300);
  box(m.soil, 0, -.53, -35, 438, .8, 408);
  // The foundation top is below all walkable terrain; its top face cannot
  // compete with the independent, non-overlapping road/yard tiles.
  box(m.paving, 0, -.34, -35, 400, .24, 366);
  const roadRects = [];
  const groundRects = [];
  function subtractRect(rect, cut) {
    const x0 = Math.max(rect.x0, cut.x0), x1 = Math.min(rect.x1, cut.x1);
    const z0 = Math.max(rect.z0, cut.z0), z1 = Math.min(rect.z1, cut.z1);
    if (x0 >= x1 || z0 >= z1) return [rect];
    const parts = [];
    if (rect.x0 < x0) parts.push({ x0: rect.x0, x1: x0, z0: rect.z0, z1: rect.z1 });
    if (x1 < rect.x1) parts.push({ x0: x1, x1: rect.x1, z0: rect.z0, z1: rect.z1 });
    if (rect.z0 < z0) parts.push({ x0, x1, z0: rect.z0, z1: z0 });
    if (z1 < rect.z1) parts.push({ x0, x1, z0: z1, z1: rect.z1 });
    return parts;
  }
  function cutAgainst(rect, cuts) {
    let parts = [rect];
    for (const cut of cuts) parts = parts.flatMap(p => subtractRect(p, cut));
    return parts;
  }
  function groundPlane(rect, mat, y = 0) {
    const w = rect.x1 - rect.x0, d = rect.z1 - rect.z0;
    if (w < .001 || d < .001) return;
    const geometry = new THREE.PlaneGeometry(w, d);
    const uv = geometry.getAttribute('uv');
    // Texture coordinates follow world coordinates across adjoining rectangles.
    for (let i = 0; i < uv.count; i++) {
      // Rotating the XY plane down into XZ reverses its V direction.
      const wx = rect.x0 + uv.getX(i) * w, wz = rect.z1 - uv.getY(i) * d;
      uv.setXY(i, wx / 7, wz / 7);
    }
    instance(geometry, mat, (rect.x0 + rect.x1) / 2, y, (rect.z0 + rect.z1) / 2, 1, 1, 1, -Math.PI / 2);
  }
  const road = (x, z, w, d, light = false) => {
    const rect = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
    const pieces = cutAgainst(rect, roadRects);
    for (const piece of pieces) { groundPlane(piece, light ? m.pavingLight : m.road, 0); roadRects.push(piece); }
  };
  road(0, 32, 26, 231);
  road(0, -92, 79, 91, true);
  for (const z of [-178, -27, 14, 66, 122]) road(0, z, 396, 9);
  for (const x of [-155, -98, -43, 43, 98, 155]) road(x, -35, 7, 361);
  for (const side of [-1, 1]) {
    box(m.pavingLight, side * 15.1, .10, 37, 4.4, .2, 211);
    box(m.stone, side * 12.85, .18, 37, .26, .36, 211);
  }
  // Main avenue inlay. Long uninterrupted sight lines make the perspective
  // reveal work without having to move any architecture behind the user's back.
  for (const z of [115, 81, 47, 13, -21, -69, -95]) {
    box(m.pavingLight, 0, .05, z, 5.2, .03, 5.2, Math.PI / 4);
    box(m.darkStone || m.stone, 0, .07, z, 3.1, .025, 3.1, Math.PI / 4);
  }

  progress('搭建坊市与沿街木构', .26);
  const shopNames = ['春和茶肆', '西域香铺', '锦绣坊', '长安酒家', '青玉堂', '听雨书舍'];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const z = 115 - i * 14;
      const shopIndex = (i + (side > 0 ? 2 : 0)) % shopNames.length;
      house(side * 23, z, { w: i % 3 === 0 ? 12 : 10, d: 9, h: 3.6, floors: i % 3 === 1 ? 1 : 2, ry: -side * Math.PI / 2, shadow: true, ornate: i === 3, label: shopNames[shopIndex], type: INTERIOR_TYPES[shopIndex].type });
      if (i < 7) {
        inFrame(side * 23, 0, z, -side * Math.PI / 2, () => {
          calligraphySign(0, 3.02, 4.61, shopNames[(i + (side > 0 ? 2 : 0)) % shopNames.length]);
        });
      }
      if (i % 2 === 0) {
        house(side * 38, z + 1, { w: 9, d: 8, h: 4.4, ry: side > 0 ? Math.PI : 0 });
        tree(side * 37, z - 6.8, i % 4 === 0 ? 'pink' : 'green', .8);
      }
    }
    for (let i = 0; i < 7; i++) lanternPost(side * 12.25, 117 - i * 22, false);
    for (let i = 0; i < 5; i++) marketStall(side * 10.4, 103 - i * 19, -side, i + (side > 0 ? 1 : 0));
    for (const z of [123, 79, 14, -27]) planter(side * 16, z, 2.5, 2.5, z === 79 ? 'pink' : 'green');
  }
  // Suspended lanterns: the foreground, mid-ground and far row create an
  // immediately readable sense of scale from pedestrian height.
  for (const z of [105, 66, 27]) {
    beam(new THREE.Vector3(-15.5, 8.1, z), new THREE.Vector3(15.5, 8.1, z), .026, m.black);
    for (let i = 0; i < 11; i++) {
      const x = -13 + i * 2.6, sag = .85 * (1 - (x / 14) ** 2);
      lantern(x, 7.85 - sag, z, i % 2 ? 1 : .85, i % 3 === 0);
    }
  }

  // Walled courtyard blocks, with roads left open between every block. The
  // repeated modules vary in layout, heights and orientation rather than scale.
  for (const side of [-1, 1]) {
    for (const x0 of [68, 125, 177]) {
      for (const z0 of [98, 42, -9, -65, -121, -186]) {
        if (x0 === 125 && z0 === -121) continue;
        if (side < 0 && x0 === 125 && z0 === -65) continue;
        const x = side * x0, z = z0;
        const bw = x0 === 177 ? 31 : 40;
        const yardRect = { x0: x - bw / 2, x1: x + bw / 2, z0: z - 18.5, z1: z + 18.5 };
        groundRects.push({ rect: yardRect, material: m.soil });
        // Front and rear court gates are genuine openings. Every yard has two
        // street connections, so side wings are reached without crossing walls.
        const yardIndex = ++courtyardCount, yardName = ['永宁坊', '安仁坊', '昭国坊', '崇仁坊', '平康坊', '兴庆坊'][(yardIndex - 1) % 6];
        for (const sz of [-1, 1]) {
          const gap = 3.6, wing = (bw - gap) / 2;
          for (const s of [-1, 1]) {
            const px = x + s * (gap / 2 + wing / 2);
            box(m.plasterAlt, px, 1.3, z + sz * 18, wing, 2.6, .45);
            obstacle(px, z + sz * 18, wing, .45, 2.6);
            roof(px, 2.6, z + sz * 18, wing + .2, 1.3, .55, m.roofAlt);
          }
          const gateTransform = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z + sz * 18), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), sz > 0 ? 0 : Math.PI), new THREE.Vector3(1, 1, 1));
          doorSystem.add({ id: `courtyard-${yardIndex}-${sz > 0 ? 'south' : 'north'}`, label: `${yardName}·院门`, kind: 'courtyardGate', matrix: gateTransform, width: gap, height: 2.6, base: 0 });
          for (const s of [-1, 1]) box(m.red, x + s * (gap / 2 + .1), 1.55, z + sz * 18, .18, 3.1, .65);
          roof(x, 3.05, z + sz * 18, gap + 1, 2, .9, m.roof);
        }
        for (const sx of [-1, 1]) {
          box(m.plasterAlt, x + sx * bw / 2, 1.3, z, .45, 2.6, 36);
          obstacle(x + sx * bw / 2, z, .45, 36, 2.6);
        }
        const h = z0 < -100 ? 4.4 : 3.6;
        house(x, z - 9, { w: 12, d: 8, h, floors: (x0 + z0) % 3 === 0 ? 2 : 1, ry: 0, lit: rand() > .3 });
        // Blocks beside the palace wall keep both side houses fully outside
        // the enclosure. Their inner lane remains wide enough for a person.
        const wingOffset = x0 === 68 && z0 < -40 ? 6.4 : 10;
        house(x - wingOffset, z + 6, { w: 9, d: 7.5, h: 3.6, ry: Math.PI / 2, lit: rand() > .25 });
        if (bw > 35) house(x + wingOffset, z + 6, { w: 9, d: 7.5, h: 3.6, ry: -Math.PI / 2, lit: rand() > .25 });
        tree(x + (side < 0 ? 4 : -4), z + 8, rand() > .7 ? 'pink' : 'green', .8 + rand() * .3);
      }
    }
  }

  progress('修建宫城、城门与塔院', .49);
  gate(0, 148, false);
  wall(-109, 148, 182, 5, 7.2); wall(109, 148, 182, 5, 7.2);
  wall(-202, -35, 366, 5, 7.2, false, Math.PI / 2);
  wall(202, -35, 366, 5, 7.2, false, Math.PI / 2);
  wall(0, -218, 409, 5, 7.2);
  for (const x of [-201, 201]) for (const z of [-216, 146]) {
    box(m.wall, x, 4.6, z, 13, 9.2, 13);
    house(x, z, { w: 11, d: 11, h: 4.4, ornate: true, collision: false });
    // Corner towers sit on the wall, rather than sinking into the plinth.
    inFrame(x, 8.9, z, 0, () => {
      box(m.red, 0, 1.6, 0, 8.6, 3.2, 8.6);
      for (const side of [-1, 1]) lattice(side * 2, 1.8, 4.36, 2.5, 1.8, true);
      roof(0, 3.1, 0, 14, 14, 3.1, m.roof, true);
    });
  }
  // Palace enclosure and ceremonial gate. Central route remains 14m wide.
  gate(0, -45, true);
  wall(-45, -45, 63, 2.7, 4.6, true); wall(45, -45, 63, 2.7, 4.6, true);
  wall(-77, -130, 170, 2.7, 4.6, true, Math.PI / 2);
  wall(77, -130, 170, 2.7, 4.6, true, Math.PI / 2);
  wall(0, -214, 153, 2.7, 4.6, true);
  for (const side of [-1, 1]) {
    for (const z of [-76, -102, -177]) {
      house(side * 49, z, { w: 18, d: 9, h: 5, ry: -side * Math.PI / 2, ornate: true, shadow: true });
    }
    for (const z of [-63, -78, -193]) lanternPost(side * 24, z, true);
    for (const z of [-67, -83, -193]) planter(side * 34, z, 4, 4, z === -67 ? 'pink' : 'green');
    box(m.stone, side * 35, .2, -68, 1.1, .4, 17);
    for (let i = 0; i < 13; i++) {
      if (i >= 5) continue;
      cylinder(m.stone, side * 35, .9, -76 + i * 4, .13, 1.5);
      box(m.stone, side * 35, 1.42, -76 + i * 4, .5, .12, .5);
    }
    box(m.stone, side * 35, 1.15, -68, .18, .18, 17);
  }
  // Incense burners and ceremonial bronze vessels leave the main approach open.
  for (const side of [-1, 1]) {
    const x = side * 22, z = -78;
    cylinder(m.stone, x, .3, z, 1.1, .6);
    cylinder(m.gold, x, 1.08, z, .63, 1.1);
    instance(geo.sphere, m.gold, x, 1.52, z, .84, .35, .84);
    roof(x, 2.1, z, 1.9, 1.9, .6, m.roofWarm, true);
    obstacle(x, z, 2.2, 2.2, 3);
  }

  // Temple complex and a seven-storey pagoda. Each storey's roof is a full
  // curved hip surface, with alternating galleries and small glowing windows.
  const tx = -126, tz = -96;
  road(tx, tz, 46, 54, true);
  house(tx, tz + 17, { w: 20, d: 10, h: 5.6, ornate: true, shadow: true });
  for (let level = 0; level < 7; level++) {
    const w = 10.5 - level * .75, y = .5 + level * 4.2;
    box(m.stone, tx, y + 1.6, tz - 8, w - 2, 3.2, w - 2);
    for (const s of [-1, 1]) lattice(tx + s * w * .22, y + 1.8, tz - 8 + (w - 2) / 2 + .02, w * .2, 1.5, level % 2 === 0);
    for (const a of [-1, 1]) for (const b of [-1, 1]) cylinder(m.red, tx + a * (w - 2) / 2, y + 1.7, tz - 8 + b * (w - 2) / 2, .12, 3.4);
    roof(tx, y + 3.1, tz - 8, w + 1, w + 1, 1.7, m.roofWarm, true, level < 3);
  }
  cylinder(m.gold, tx, 32, tz - 8, .14, 4);
  instance(geo.sphere, m.gold, tx, 34.1, tz - 8, .35, .48, .35);
  obstacle(tx, tz - 8, 11, 11, 35);
  for (const x of [-145, -108]) for (const z of [-116, -81]) tree(x, z, 'gold', 1.25);

  progress('布置园林、灯火与街市', .67);
  // The original pool, blossoms and waterside shelter are detailed into a
  // walkable bridge, shore walk, connected covered galleries and open pavilions.
  const [gx, gz] = GARDEN_LAYOUT.center;
  const garden = createGarden({ m, geo, rand, instance, box, cylinder, beam, roof, inFrame, obstacle, lantern, tree, calligraphySign, groundRects });
  buildingCount++; // The original scenic pavilion is upgraded, not removed.

  // Market barrels, baskets and handcarts near the edge of the walking route.
  for (const side of [-1, 1]) for (let i = 0; i < 8; i++) {
    const x = side * (15.6 + rand() * 1.3), z = 111 - i * 15;
    cylinder(m.timber, x, .47, z, .4, .9);
    for (const y of [.2, .68]) cylinder(m.black, x, y, z, .416, .045);
    cylinder(m.awningCream, x + side * .8, .24, z + .2, .3, .48);
  }
  for (const side of [-1, 1]) {
    inFrame(side * 15, 0, 46, .2 * side, () => {
      box(m.timber, 0, .65, 0, 1.7, .16, 2.8);
      for (const sx of [-1, 1]) {
        instance(geo.torus, m.timber, sx * .95, .5, 0, .48, .48, .48, 0, Math.PI / 2);
        beam(new THREE.Vector3(sx * .7, .65, 0), new THREE.Vector3(sx * .7, .45, 3.1), .055, m.timber);
      }
      for (let k = 0; k < 5; k++) box(m.awningCream, 0, 1 + k * .14, -.1 + k * .08, 1.2, .14, 1.5);
      obstacle(0, .4, 2.2, 3.5, 1.8);
    });
  }

  // The app owns the distant horizon. Keeping it out of city chunks avoids
  // duplicate silhouettes and lets the day/night grade treat it independently.

  // Finish the terrain as a disjoint tiling: roads take precedence, courtyards
  // occupy their own rectangles, and the remaining city surface fills the gaps.
  // There is exactly one coplanar top face at each (x,z), including intersections.
  const paintedGround = [...roadRects];
  for (const { rect, material } of groundRects) {
    const pieces = cutAgainst(rect, paintedGround);
    for (const piece of pieces) { groundPlane(piece, material, 0); paintedGround.push(piece); }
  }
  const citySurface = { x0: -200, x1: 200, z0: -218, z1: 148 };
  const barePaving = cutAgainst(citySurface, paintedGround);
  for (const piece of barePaving) groundPlane(piece, m.paving, 0);

  // A low detail architectural fallback is also the distant LOD. It follows
  // the exact same shared terrace/stair contract as the Blender generator.
  const palaceFallback = new THREE.Group(); palaceFallback.name = 'Palace · monumental silhouette LOD'; root.add(palaceFallback);
  const fallbackBatches = new InstanceDistricts(palaceFallback);
  const saveActive = active; active = fallbackBatches;
  inFrame(...PALACE_WORLD, 0, () => {
    for (const terrace of PALACE_LAYOUT.terraces) {
      const centerZ = (terrace.minZ + terrace.maxZ) / 2, depth = terrace.maxZ - terrace.minZ;
      box(m.stone, 0, terrace.height / 2, centerZ, terrace.width, terrace.height, depth);
      box(m.pavingLight, 0, terrace.height + .035, centerZ, terrace.width, .07, depth);
      box(m.stone, 0, terrace.height - .18, terrace.maxZ, terrace.width + .6, .3, .5);
    }
    for (const flight of PALACE_LAYOUT.stairFlights) {
      const run = flight.startZ - flight.endZ, rise = flight.endHeight - flight.startHeight;
      for (let step = 0; step < flight.steps; step++) {
        const top = flight.startHeight + (step + 1) / flight.steps * rise;
        const localZ = flight.startZ - PALACE_WORLD[2] - (step + .5) / flight.steps * run;
        box(m.stone, 0, top / 2, localZ, flight.width, top, run / flight.steps);
      }
      for (const side of [-1, 1]) {
        for (let step = 0; step <= 6; step++) {
          const t = step / 6, top = flight.startHeight + rise * t;
          cylinder(m.stone, side * (flight.width / 2 + .15), top + .75, flight.startZ - PALACE_WORLD[2] - run * t, .14, 1.5);
        }
        beam(new THREE.Vector3(side * (flight.width / 2 + .15), flight.startHeight + 1.2, flight.startZ - PALACE_WORLD[2]),
          new THREE.Vector3(side * (flight.width / 2 + .15), flight.endHeight + 1.2, flight.endZ - PALACE_WORLD[2]), .11, m.stone);
      }
    }
    box(m.timber, 0, PALACE_FLOOR + .045, 0, 58.5, .09, 32.5);
    box(m.red, 0, PALACE_FLOOR + 6.7, -15.5, 58.8, 13.4, .6);
    for (const side of [-1, 1]) {
      box(m.plaster, side * 29.1, PALACE_FLOOR + 6.7, 0, .6, 13.4, 31.6);
      box(m.red, side * 17.7, PALACE_FLOOR + 6.7, 15.5, 23.4, 13.4, .6);
      for (let i = 0; i < 4; i++) lattice(side * (8.3 + i * 5.5), PALACE_FLOOR + 6.7, 15.87, 3.8, 7.5, true);
      for (let z = -12; z <= 12; z += 12) cylinder(m.redLight, side * 23, PALACE_FLOOR + 6.75, z, .5, 13.5, 0, true);
    }
    for (let x = -28; x <= 28; x += 7) if (Math.abs(x) >= 6) cylinder(m.redLight, x, PALACE_FLOOR + 6.75, 16.3, .45, 13.5, 0, true);
    box(m.red, 0, 22.6, 15.7, 60, .65, 1.1);
    roof(0, 24, 0, 68, 43, 4.8, m.roofWarm, true, true);
    roof(0, 30, 0, 62, 37, 4.8, m.roofWarm, true, true);
    calligraphySign(0, 21.2, 16.4, '含元殿');
    box(m.red, 0, PALACE_FLOOR + .9, -10.2, 14.4, 1.8, 6.4);
    box(m.gold, 0, PALACE_FLOOR + 3, -11, 4.1, 3, 1.8);
    for (const side of [-1, 1]) lantern(side * 9, 20.5, 16.3, 2.5, true);
  });
  active = saveActive;
  const fallbackBatchCount = fallbackBatches.finish();
  // Shared collision envelope also works for the exported Blender palace.
  inFrame(...PALACE_WORLD, 0, () => {
    for (const b of PALACE_LAYOUT.localWallColliders) obstacle((b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2, b.maxX - b.minX, b.maxZ - b.minZ, 16, PALACE_FLOOR);
    // Guard the outer edges and each raised front. The wide central opening
    // matches the next stair flight; no invisible wall crosses the ascent.
    PALACE_LAYOUT.terraces.forEach((tier, index) => {
      const nextFlight = PALACE_LAYOUT.stairFlights[index];
      const halfGap = nextFlight.width / 2 + .55;
      const wing = tier.width / 2 - halfGap;
      // Every raised plinth has a physical side face.  The old outermost
      // guard alone allowed a player to walk across the side of the second
      // and third tiers and effectively skip the ceremonial stairs.  These
      // narrow AABBs follow the actual tier perimeter while leaving the
      // central flight opening untouched.
      const tierDepth = tier.maxZ - tier.minZ;
      if (index > 0) {
        for (const side of [-1, 1]) obstacle(side * tier.width / 2, (tier.minZ + tier.maxZ) / 2, .62, tierDepth + .35, tier.height + 1.25, 0);
      }
      for (const side of [-1, 1]) {
        obstacle(side * (halfGap + wing / 2), tier.maxZ, wing, .45, 4, tier.height);
      }
      if (index === 0) {
        for (const side of [-1, 1]) obstacle(side * tier.width / 2, (tier.minZ + tier.maxZ) / 2, .45, tier.maxZ - tier.minZ, 12, 0);
        obstacle(0, tier.minZ, tier.width, .45, 12, 0);
      }
    });
    // Keep the edge of each long flight and landing as a walkable guard.  The
    // collision loop is XZ/radius based, so a slim full-height box is the
    // stable representation even where the visible rail slopes upward.
    for (const flight of PALACE_LAYOUT.stairFlights) {
      const run = Math.abs(flight.endZ - flight.startZ);
      const centerZ = (flight.startZ + flight.endZ) / 2 - PALACE_WORLD[2];
      for (const side of [-1, 1]) obstacle(side * flight.width / 2, centerZ, .62, run + .42, 13, 0);
    }
    for (const landing of PALACE_LAYOUT.landings) {
      const depth = Math.abs(landing.endZ - landing.startZ);
      const centerZ = (landing.startZ + landing.endZ) / 2 - PALACE_WORLD[2];
      for (const side of [-1, 1]) obstacle(side * landing.width / 2, centerZ, .62, depth + .38, 13, 0);
    }
  });

  progress('合并街坊实例并点亮长安', .83);
  const batchCount = districts.finish();
  doorSystem.finish();
  // Only a handful of practical lights. Hundreds of lanterns are emissive
  // instances rather than hundreds of expensive real-time point lights.
  for (const [x, y, z, power, range] of [[-10, 5, 100, 75, 29], [10, 5, 42, 75, 29], [0, 6, -40, 100, 29], [0, 15, -157, 185, 40]]) {
    const light = new THREE.PointLight(0xffb463, power, range, 2); light.position.set(x, y, z); root.add(light);
    animated.push({ light, power, phase: rand() * Math.PI * 2 });
  }

  const residents = createResidents(root, { count: 60, seed: 7417 });

  // Subtle drifting blossom petals in the garden, not a full-screen overlay.
  const petalPositions = new Float32Array(105 * 3);
  for (let i = 0; i < 105; i++) { petalPositions[i * 3] = gx - 27 + rand() * 54; petalPositions[i * 3 + 1] = 1 + rand() * 9; petalPositions[i * 3 + 2] = gz - 35 + rand() * 70; }
  const petalGeometry = new THREE.BufferGeometry(); petalGeometry.setAttribute('position', new THREE.BufferAttribute(petalPositions, 3));
  const petals = new THREE.Points(petalGeometry, new THREE.PointsMaterial({ color: 0xe8acb0, size: .10, transparent: true, opacity: .7, depthWrite: false })); root.add(petals);

  const stats = { buildings: buildingCount + 1, totalBuildings: buildingCount + 1, enterableBuildings: interiorSystem.buildings.length + 1,
    courtyardGates: courtyardCount * 2, doors: doorSystem.doors.length, residents: residents.stats.count,
    residentBatches: residents.stats.residentBatches, residentArchetypes: residents.stats.archetypes,
    staticInstances: districts.count, staticBatches: batchCount + fallbackBatchCount, palaceSource: 'procedural-fallback',
    groundTiles: roadRects.length + paintedGround.length - roadRects.length + barePaving.length, overlappingRoadTiles: 0, interiorTypes: INTERIOR_TYPES.length,
    garden: garden.stats };
  const reachability = auditBuildingReachability(colliders, doorSystem.doors, interiorSystem.buildings);
  stats.reachableBuildings = reachability.reachable + 1;
  stats.reachableOrdinaryBuildings = reachability.reachable;
  stats.unreachableBuildings = reachability.unreachable.map(b => b.id);
  const assetBase = import.meta.env?.BASE_URL ?? './';
  const palaceLOD = new THREE.Group(); palaceLOD.name = 'Palace · distance-selected assets'; root.add(palaceLOD);
  let palaceHigh = null, palaceLow = null, palaceShadow = null;
  const palaceRenderStats = { highTriangles: 0, lowTriangles: 0, highMeshes: 0, lowMeshes: 0 };
  function triangleCount(object) {
    let count = 0, meshes = 0;
    object.traverse(node => {
      if (!node.isMesh || !node.geometry) return;
      meshes++;
      const index = node.geometry.getIndex?.();
      count += index ? index.count / 3 : (node.geometry.getAttribute('position')?.count ?? 0) / 3;
    });
    return { count: Math.round(count), meshes };
  }
  function preparePalace(gltf, name) {
    const palace = gltf.scene;
    palace.name = name; palace.position.set(...PALACE_WORLD);
    palace.updateMatrixWorld(true);
    palace.traverse(obj => {
      if (!obj.isMesh) return;
      // A single low-detail shadow proxy below owns the static sun shadow.
      // Keeping the visible HIGH/LOW meshes out of the shadow pass means a
      // distance LOD switch never invalidates or changes the cached map.
      obj.castShadow = false; obj.receiveShadow = true;
      if (obj.material) {
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) {
          if (mat.map) mat.map.anisotropy = 4;
          if (mat.emissive) mat.emissiveIntensity = Math.min(mat.emissiveIntensity || 0, 2.5);
        }
      }
    });
    palaceLOD.add(palace); return palace;
  }
  function makePalaceShadowProxy(source) {
    if (palaceShadow || !source) return palaceShadow;
    const pieces = [];
    source.updateMatrixWorld(true);
    source.traverse(obj => {
      if (!obj.isMesh || !obj.geometry) return;
      const geometry = obj.geometry.index ? obj.geometry.toNonIndexed() : obj.geometry.clone();
      geometry.applyMatrix4(obj.matrixWorld);
      for (const attr of Object.keys(geometry.attributes)) if (!['position', 'normal'].includes(attr)) geometry.deleteAttribute(attr);
      pieces.push(geometry);
    });
    if (!pieces.length) return null;
    const merged = mergeGeometries(pieces, false);
    pieces.forEach(piece => piece.dispose());
    if (!merged) return null;
    merged.computeBoundingSphere();
    const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, colorWrite: false, depthWrite: false, depthTest: true });
    const proxy = new THREE.Mesh(merged, shadowMaterial);
    proxy.name = '含元殿 · cached static shadow proxy';
    proxy.position.set(0, 0, 0);
    proxy.castShadow = true; proxy.receiveShadow = false;
    // Visible pass is colour/depth silent; shadow pass uses a real depth
    // material so DirectionalLight still receives the silhouette.
    proxy.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    proxy.customDistanceMaterial = new THREE.MeshDistanceMaterial();
    palaceLOD.add(proxy); palaceShadow = proxy;
    return proxy;
  }
  const palaceReady = new GLTFLoader().loadAsync(`${assetBase}assets/palace.glb`).then(async gltf => {
    palaceHigh = preparePalace(gltf, 'Hanyuan Hall · Blender high detail');
    palaceFallback.visible = false;
    const highInfo = triangleCount(palaceHigh);
    palaceRenderStats.highTriangles = highInfo.count; palaceRenderStats.highMeshes = highInfo.meshes;
    // Await LOW before resolving palaceReady. main.js compiles and freezes the
    // shadow map immediately after this promise, so no late LOD asset may
    // alter the cached projection.
    try {
      const low = await new GLTFLoader().loadAsync(`${assetBase}assets/palace-low.glb`);
      palaceLow = preparePalace(low, 'Hanyuan Hall · Blender low detail'); palaceLow.visible = false;
      const lowInfo = triangleCount(palaceLow);
      palaceRenderStats.lowTriangles = lowInfo.count; palaceRenderStats.lowMeshes = lowInfo.meshes;
      stats.palaceLowLoaded = true;
    } catch (error) {
      stats.palaceLowLoaded = false;
      console.info('Distant palace LOD unavailable; HIGH remains the close/distant asset.', error.message);
    }
    makePalaceShadowProxy(palaceLow || palaceHigh);
    stats.palaceSource = 'blender-glb'; stats.palaceLoaded = true;
    stats.palaceLOD = 'high'; stats.palaceFloor = PALACE_FLOOR; stats.palaceHeight = PALACE_LAYOUT.body.totalHeight;
    stats.palaceHighTriangles = palaceRenderStats.highTriangles;
    stats.palaceLowTriangles = palaceRenderStats.lowTriangles;
    stats.palaceHighMeshes = palaceRenderStats.highMeshes;
    stats.palaceLowMeshes = palaceRenderStats.lowMeshes;
    stats.palaceShadowTriangles = palaceRenderStats.lowTriangles || palaceRenderStats.highTriangles;
    progress('含元殿 Blender 高低模与静态阴影已就绪', 1);
    return { loaded: true, object: palaceHigh, low: palaceLow, shadow: palaceShadow };
  }).catch(error => {
    stats.palaceLoaded = false;
    console.info('Blender palace asset unavailable; using the playable architectural fallback.', error.message);
    return { loaded: false, error: error.message };
  });

  function getHeight(x, z) {
    const palaceHeight = getPalaceHeight(x, z);
    if (palaceHeight !== null) return palaceHeight;
    const gardenHeight = garden.getHeight(x, z);
    if (gardenHeight !== null) return gardenHeight;
    for (const b of interiorSystem.buildings) {
      if (Math.abs(x - b.position[0]) > b.radius + 2 || Math.abs(z - b.position[2]) > b.radius + 2) continue;
      const p = v.set(x, 0, z).applyMatrix4(b.worldToLocal);
      if (Math.abs(p.x) <= b.w / 2 + .25 && p.z > -b.d / 2 - .25 && p.z < b.d / 2 + .26) return b.floorHeight;
      const rampStart = b.d / 2 + .26, rampEnd = rampStart + 1.6;
      if (Math.abs(p.x) < Math.min(3, b.w * .34) / 2 + .22 && p.z >= rampStart && p.z <= rampEnd) return .08 + (b.floorHeight - .08) * (rampEnd - p.z) / 1.6;
    }
    return .08;
  }
  const palaceInterior = { id: 'palace-hall', label: '含元殿', type: 'palace', description: '循三重丹陛登临九米高台，穿过十三米朱柱与双重檐，沿中央通道参观御座与大殿陈设。', doorId: null, position: [PALACE_WORLD[0], PALACE_FLOOR, PALACE_WORLD[2]] };
  function getInteriorAt(x, z) {
    if (isPalaceInterior(x, z)) return palaceInterior;
    return interiorSystem.getInteriorAt(x, z);
  }
  function update(elapsed, delta = .016, player = null, options = {}) {
    const animate = animationEnabled && options.animate !== false;
    if (animate) residents.update(elapsed, delta, player, options.camera);
    doorSystem.update(delta, player);
    interiorSystem.update(player, delta);
    stats.furnishedInteriors = interiorSystem.stats.furnishedInteriors;
    stats.prewarmedInteriorTemplates = interiorSystem.stats.interiorTemplates;
    if (palaceHigh && player) {
      const distance = Math.hypot(player.x - PALACE_WORLD[0], player.y - 17, player.z - PALACE_WORLD[2]);
      const highVisible = distance < (palaceHigh.visible ? 155 : 125);
      palaceHigh.visible = highVisible;
      if (palaceLow) palaceLow.visible = !highVisible;
      if (palaceShadow) palaceShadow.visible = true;
      palaceFallback.visible = !highVisible && !palaceLow;
      stats.palaceLOD = highVisible ? 'high' : palaceLow ? 'low' : 'procedural-low';
    }
    if (!animate) return;
    garden.update(elapsed);
    const pos = petalGeometry.attributes.position;
    for (let i = 0; i < 105; i++) {
      pos.array[i * 3] += Math.sin(elapsed * .4 + i) * delta * .12;
      pos.array[i * 3 + 1] -= delta * (.08 + (i % 5) * .025);
      if (pos.array[i * 3 + 1] < .3) pos.array[i * 3 + 1] = 9;
    }
    pos.needsUpdate = true;
  }
  const locations = {
    overview: { label: '长安总览', position: [292, 228, 315], target: [0, 0, -30] },
    market: { label: '朱雀大街', position: [0, 2.1, 100], target: [0, 3.2, 65] },
    palace: { label: '宫城庭院', position: PALACE_CAMERAS.courtyard.position, target: PALACE_CAMERAS.courtyard.target },
    interior: { label: '含元殿', position: PALACE_CAMERAS.interior.position, target: PALACE_CAMERAS.interior.target },
    garden: garden.location,
  };
  progress('长安城场景已就绪', .97);
  return { root, colliders, getHeight, update, palaceReady, stats, locations, lamps, reachability,
    buildings: interiorSystem.buildings, doors: doorSystem.doors, getInteriorAt,
    getBuildingAt: position => getInteriorAt(position.x, position.z),
    getNearbyDoor: doorSystem.getNearbyDoor, interactDoor: doorSystem.interactDoor,
    setAnimationEnabled(value) { animationEnabled = Boolean(value); },
    async prewarmInteriors(renderer = null, camera = null) {
      const result = await interiorSystem.prewarm(renderer, camera, scene);
      stats.prewarmedInteriorTemplates = result.templateCount; stats.interiorsPrewarmed = result.warmed;
      stats.interiorGeometryGPUWarmed = result.gpuWarmed;
      return result;
    },
    dispose() {
      doorSystem.dispose(); interiorSystem.dispose(); residents.dispose();
      scene.remove(root);
      const geometries = new Set(), materials = new Set(), textures = new Set();
      root.traverse(obj => {
        if (obj.geometry) geometries.add(obj.geometry);
        if (obj.material) for (const material of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(material);
      });
      for (const mat of materials) { for (const val of Object.values(mat)) if (val?.isTexture) textures.add(val); mat.dispose(); }
      for (const g of geometries) g.dispose(); for (const t of textures) t.dispose();
    },
  };
}
