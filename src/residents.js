import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Tang-inspired residents. All people share a small set of instance batches;
// cloth, jointed limbs and facial landmarks are geometry, never billboards.
const TAU = Math.PI * 2;
const Y = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(0xffffff);
const PALETTES = [
  { name: '行商', coat: 0x647976, hem: 0x435957, trim: 0xd6ba88, kind: 0 },
  { name: '书生', coat: 0x8a9faa, hem: 0x687e8a, trim: 0xeee0bc, kind: 1 },
  { name: '坊民', coat: 0xa17c59, hem: 0x695943, trim: 0xdcc19d, kind: 2 },
  { name: '襦裙女子', coat: 0xb77267, hem: 0x657c72, trim: 0xf0d4b3, kind: 3 },
  { name: '挑夫', coat: 0x6e737f, hem: 0x404d5c, trim: 0xd6c5a1, kind: 4 },
  { name: '孩童', coat: 0x997c4c, hem: 0x655b52, trim: 0xe0c491, kind: 5 },
];

function randomGenerator(seed) {
  let value = seed >>> 0;
  return () => { value = Math.imul(1664525, value) + 1013904223 >>> 0; return value / 4294967296; };
}

// Closed elliptical garments have a shoulder line and folded hems. Normals
// follow broad cloth panels instead of a single smooth cone silhouette.
function garment(rings, segments = 20, fold = .009) {
  const p = [], ix = [];
  for (let j = 0; j < rings.length; j++) {
    const [height, width, depth] = rings[j];
    for (let i = 0; i < segments; i++) {
      const a = i / segments * TAU;
      const pleat = fold * Math.cos(a * 10) * (j === 0 ? 1 : .45);
      p.push(Math.sin(a) * (width + pleat), height, Math.cos(a) * (depth + pleat * .45));
    }
  }
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < segments; i++) {
    const a = j * segments + i, b = j * segments + (i + 1) % segments;
    ix.push(a, b, a + segments, b, b + segments, a + segments);
  }
  p.push(0, rings[0][0], 0, 0, rings.at(-1)[0], 0);
  const lo = p.length / 3 - 2, hi = lo + 1, top = (rings.length - 1) * segments;
  for (let i = 0; i < segments; i++) {
    ix.push(lo, (i + 1) % segments, i, hi, top + i, top + (i + 1) % segments);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix); g.computeVertexNormals();
  return g;
}

function headGeometry() {
  const g = new THREE.SphereGeometry(1, 14, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // A jaw that narrows toward the chin, and a broad, gently flattened face.
    const jaw = y < -.18 ? 1 - (-y - .18) * .22 : 1;
    p.setXYZ(i, x * jaw, y, z > .55 ? .55 + (z - .55) * .58 : z);
  }
  g.computeVertexNormals(); return g;
}

export function createResidents(root, { count = 60, seed = 7417 } = {}) {
  count = Math.max(0, Math.min(180, Math.floor(count)));
  const rand = randomGenerator(seed);
  const group = new THREE.Group(); group.name = '长安百姓 · articulated instance crowd'; root.add(group);
  const people = [], batches = {}, geometries = new Set();
  const materials = {
    cloth: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .94 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .84 }),
    dark: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9 }),
    trim: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .82 }),
    basket: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .95 }),
  };
  const ellipsoid = new THREE.SphereGeometry(1, 10, 7);
  const cylinder = new THREE.CylinderGeometry(.86, 1, 1, 10, 1);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  function batch(name, geometry, material, capacity) {
    geometries.add(geometry);
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, count * capacity));
    mesh.name = `Residents · ${name}`; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The sun's architecture shadow is cached. People receive that shadow;
    // they must not be baked into it or redraw the entire city every frame.
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    // Allocate instance colors before shader warmup, including batches that
    // happen to contain no visible resident at the initial overview camera.
    mesh.setColorAt(0, WHITE);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; group.add(mesh); batches[name] = { mesh, used: 0 }; return mesh;
  }
  batch('bodices', garment([[.96, .155, .11], [1.09, .17, .125], [1.32, .218, .124], [1.41, .177, .115]]), materials.cloth, 1);
  batch('long robes', garment([[.35, .235, .18], [.52, .22, .16], [.79, .181, .132], [1.01, .158, .115]]), materials.cloth, 1);
  batch('pleated skirts', garment([[.22, .27, .205], [.43, .252, .18], [.75, .205, .148], [1.04, .151, .108]], 24, .014), materials.cloth, 1);
  batch('short tunics', garment([[.68, .204, .155], [.83, .178, .135], [1.02, .155, .116]]), materials.cloth, 1);
  batch('heads', headGeometry(), materials.skin, 1);
  batch('skin details', ellipsoid, materials.skin, 8);
  batch('hair caps', new THREE.SphereGeometry(1, 12, 8, 0, TAU, 0, Math.PI * .49), materials.dark, 1);
  batch('hair knots', ellipsoid, materials.dark, 4);
  batch('face details', ellipsoid, materials.dark, 6);
  batch('sleeves', cylinder, materials.cloth, 4);
  batch('cloth joints', ellipsoid, materials.cloth, 6);
  batch('trousers', cylinder, materials.cloth, 4);
  batch('shoes', ellipsoid, materials.dark, 2);
  batch('collars and bands', cube, materials.trim, 12);
  batch('belts', garment([[-.031, .164, .122], [.031, .164, .122]], 20, 0), materials.dark, 1);
  batch('scholar hats', garment([[0, .126, .112], [.135, .115, .1], [.16, .087, .08]], 12, 0), materials.dark, 1);
  batch('wicker baskets', garment([[-.135, .115, .1], [.12, .155, .13]], 14, .007), materials.basket, 1);
  batch('basket bands', new THREE.TorusGeometry(1, .025, 4, 16), materials.basket, 3);
  batch('scrolls', cylinder, materials.trim, 2);

  // Beyond the distance at which fingers and faces are visible, keep a clothed
  // silhouette, head and two legs in three shared low-detail batches.
  function mergedParts(parts) {
    const pieces = parts.map(([geometry, x, y, z, sx, sy, sz]) => {
      const copy = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      for (const name of Object.keys(copy.attributes)) if (!['position', 'normal'].includes(name)) copy.deleteAttribute(name);
      copy.scale(sx, sy, sz); copy.translate(x, y, z); return copy;
    });
    const geometry = mergeGeometries(pieces, false); pieces.forEach(piece => piece.dispose()); return geometry;
  }
  const proxyBody = garment([[.55, .20, .15], [.98, .16, .12], [1.32, .21, .12], [1.41, .16, .11]], 8, 0);
  const proxyLimb = new THREE.CylinderGeometry(.86, 1, 1, 5, 1);
  batch('distant garments', mergedParts([
    [proxyBody, 0, 0, 0, 1, 1, 1],
    [proxyLimb, -.245, 1.14, 0, .075, .45, .08], [proxyLimb, .245, 1.14, 0, .075, .45, .08],
  ]), materials.cloth, 1);
  batch('distant heads', new THREE.SphereGeometry(1, 7, 5), materials.skin, 1);
  batch('distant legs', mergedParts([
    [proxyLimb, -.085, .3, 0, .055, .5, .06], [proxyLimb, .085, .3, 0, .055, .5, .06],
  ]), materials.dark, 1);
  proxyBody.dispose(); proxyLimb.dispose();

  const skinColors = [0xc89d7b, 0xc09878, 0xba8d6d, 0xd0aa88];
  for (let i = 0; i < count; i++) {
    const role = PALETTES[i % PALETTES.length], side = i % 2 ? 1 : -1;
    const walking = i < Math.round(count * .7), child = role.kind === 5;
    const scale = child ? .67 + rand() * .08 : .94 + rand() * .095;
    // Balanced lanes leave the centre line open. Static villagers stand by the
    // stalls, without extending into the footprints of the market buildings.
    const lane = walking ? 2.8 + rand() * 3.25 : 5.65 + rand() * .6;
    people.push({
      i, role, side, walking, scale, x: side * lane,
      z: -23 + rand() * 146, speed: walking ? side * (.48 + rand() * .28) : 0,
      phase: rand() * TAU, stride: .15 + rand() * .055,
      heading: walking ? (side > 0 ? 0 : Math.PI) : (side > 0 ? -Math.PI / 2 : Math.PI / 2),
      skin: skinColors[i % skinColors.length], hair: i % 9 === 0 ? 0x4d4940 : 0x282723,
      coat: new THREE.Color(role.coat).offsetHSL((rand() - .5) * .018, 0, (rand() - .5) * .055),
      hem: new THREE.Color(role.hem).offsetHSL(0, 0, (rand() - .5) * .04),
      pos: new THREE.Vector3(), height: 1.73 * scale,
    });
  }

  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3();
  const turn = new THREE.Quaternion(), localQ = new THREE.Quaternion();
  const localA = new THREE.Vector3(), localB = new THREE.Vector3(), direction = new THREE.Vector3();
  const rotationZ = new THREE.Vector3(0, 0, 1);
  const itemColor = new THREE.Color(), frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
  const sphere = new THREE.Sphere(new THREE.Vector3(), 1.15);
  let initialized = false, lastPoseTime = -Infinity;

  function item(name, person, x, y, z, sx = 1, sy = sx, sz = sx, color = WHITE, quaternion = null) {
    const b = batches[name], index = b.used++;
    v.set(x, y, z).multiplyScalar(person.scale).applyQuaternion(turn).add(person.pos);
    if (quaternion) q.copy(turn).multiply(quaternion); else q.copy(turn);
    s.set(sx, sy, sz).multiplyScalar(person.scale); m.compose(v, q, s); b.mesh.setMatrixAt(index, m);
    b.mesh.setColorAt(index, color?.isColor ? color : itemColor.setHex(color));
  }
  function segment(name, person, ax, ay, az, bx, by, bz, width, depth, color) {
    localA.set(ax, ay, az); localB.set(bx, by, bz); direction.subVectors(localB, localA);
    const length = direction.length(); localQ.setFromUnitVectors(Y, direction.normalize());
    localA.add(localB).multiplyScalar(.5);
    item(name, person, localA.x, localA.y, localA.z, width, length, depth, color, localQ);
  }
  function ribbon(person, ax, ay, az, bx, by, bz, width, color) {
    segment('collars and bands', person, ax, ay, az, bx, by, bz, width, .018, color);
  }
  function drawPerson(p, elapsed) {
    const role = p.role, child = role.kind === 5, female = role.kind === 3;
    const z = p.walking ? -28 + ((p.z + 28 + elapsed * p.speed) % 156 + 156) % 156 : p.z;
    const theta = elapsed * (3.5 + Math.abs(p.speed) * 1.7) + p.phase;
    const stride = p.walking ? Math.sin(theta) : 0;
    const bob = p.walking ? .011 * (1 - Math.cos(theta * 2)) : Math.sin(elapsed * 1.3 + p.phase) * .004;
    const drift = p.walking ? Math.sin(theta / 2) * .018 : Math.sin(elapsed * .55 + p.phase) * .012;
    p.pos.set(p.x + drift, .012, z);
    turn.setFromAxisAngle(Y, p.heading + (p.walking ? Math.sin(theta) * .025 : Math.sin(elapsed * .42 + p.phase) * .07));
    const hipY = .86 + bob;
    item('bodices', p, 0, bob, 0, female ? .94 : 1, 1, 1, p.coat);
    const bottom = female ? 'pleated skirts' : [0, 2, 4, 5].includes(role.kind) ? 'short tunics' : 'long robes';
    item(bottom, p, 0, bob, 0, 1, 1, 1, female ? p.hem : p.coat);
    item('belts', p, 0, 1.002 + bob, 0, 1, 1, 1, 0x443c32);
    item('collars and bands', p, .06, 1.003 + bob, .129, .055, .045, .022, 0xb39b63);

    // Crossed lapels: two pale diagonal edges on the same fitted bodice.
    ribbon(p, -.10, 1.422 + bob, .109, .085, 1.145 + bob, .14, .034, role.trim);
    ribbon(p, .095, 1.422 + bob, .109, -.075, 1.255 + bob, .142, .034, role.trim);
    ribbon(p, .085, 1.145 + bob, .14, .155, 1.015 + bob, .117, .024, role.trim);
    item('skin details', p, 0, 1.435 + bob, -.003, .056, .09, .058, p.skin);
    const headY = 1.582 + bob, headScale = child ? 1.10 : 1;
    item('heads', p, 0, headY, .003, .105 * headScale, .137 * headScale, .102 * headScale, p.skin);
    for (const side of [-1, 1]) {
      item('skin details', p, side * .104 * headScale, headY -.005, -.005, .019, .035, .019, p.skin);
      // Tiny eyes are quiet dark shapes, without cartoon white eyeballs.
      item('face details', p, side * .04 * headScale, headY + .018, .090 * headScale, .012, .0055, .005, 0x433a30);
      item('face details', p, side * .04 * headScale, headY + .038, .088 * headScale, .020, .0033, .004, p.hair);
    }
    item('skin details', p, 0, headY -.006, .101 * headScale, .016, .028, .022, p.skin);
    item('face details', p, 0, headY -.054, .087 * headScale, .017, .003, .003, 0x92664e);
    item('hair caps', p, 0, headY + .018, -.01, .111 * headScale, .135 * headScale, .107 * headScale, p.hair);
    if (female) {
      item('hair knots', p, 0, headY + .142, -.025, .067, .056, .062, p.hair);
      item('hair knots', p, -.052, headY + .095, -.066, .045, .047, .052, p.hair);
      item('hair knots', p, .052, headY + .095, -.066, .045, .047, .052, p.hair);
      item('collars and bands', p, 0, headY + .149, -.025, .145, .012, .014, 0xbba26d);
    } else if (role.kind === 1) {
      item('scholar hats', p, 0, headY + .082, -.008, 1, 1, 1, 0x343c42);
    } else if (child) {
      for (const side of [-1, 1]) item('hair knots', p, side * .079, headY + .096, -.023, .044, .037, .044, p.hair);
    } else {
      item('hair knots', p, 0, headY + .143, -.037, .046, .047, .046, p.hair);
      if (role.kind === 4) item('collars and bands', p, 0, headY + .062, .087, .19, .035, .016, role.trim);
    }

    // Two-link leg IK keeps each planted foot on the ground, with a flexed knee
    // during swing. Long garments conceal the hips but never replace the legs.
    for (const side of [-1, 1]) {
      const swing = stride * side, lift = p.walking ? Math.max(0, Math.cos(theta + (side < 0 ? Math.PI : 0))) * .095 : 0;
      const ankleY = .105 + lift, ankleZ = swing * p.stride;
      const hipZ = -.012, dy = hipY - ankleY, dz = ankleZ - hipZ;
      const d = Math.min(.81, Math.hypot(dy, dz)), a = .41, b = .405;
      const along = (a * a - b * b + d * d) / (2 * d), perpendicular = Math.sqrt(Math.max(0, a * a - along * along));
      const kneeY = hipY - along * dy / d + perpendicular * dz / d;
      const kneeZ = hipZ + along * dz / d + perpendicular * dy / d;
      const x = side * .088;
      if (!female && bottom !== 'long robes') {
        segment('trousers', p, x, hipY, hipZ, x, kneeY, kneeZ, .068, .071, p.hem);
        item('cloth joints', p, x, kneeY, kneeZ, .058, .065, .061, p.hem);
      }
      // The garment itself conceals thighs. Only the exposed ankle section is
      // drawn for robes/skirts, so flexed knees cannot poke through the cloth.
      const calfTopY = female ? .25 : bottom === 'long robes' ? .39 : kneeY;
      const calfTopZ = female || bottom === 'long robes' ? ankleZ * .62 : kneeZ;
      segment('trousers', p, x, calfTopY, calfTopZ, x, ankleY, ankleZ, .052, .057, p.hem);
      item('shoes', p, x, .061 + lift, ankleZ + .046, .063, .052, .13, 0x35352f);
      item('collars and bands', p, x, .092 + lift, ankleZ + .034, .105, .027, .17, 0x4c4940);
    }

    // Arms swing opposite to the leg on the same side. A mild elbow angle and
    // tapered hanging sleeves make these read as people rather than cylinders.
    for (const side of [-1, 1]) {
      const armSwing = p.walking ? -side * stride : Math.sin(elapsed * .9 + p.phase) * .06;
      const holding = role.kind === 0 || role.kind === 1;
      const elbowZ = holding ? .105 : armSwing * .09;
      const wristZ = holding ? .255 : armSwing * .17 + .025;
      const wristY = holding ? 1.04 : .969 + Math.abs(armSwing) * .025;
      const shoulderX = side * .208, elbowX = side * (holding ? .235 : .266), wristX = side * (holding ? .175 : .275);
      segment('sleeves', p, shoulderX, 1.355 + bob, -.006, elbowX, 1.15 + bob, elbowZ, .074, .087, p.coat);
      segment('sleeves', p, elbowX, 1.15 + bob, elbowZ, wristX, wristY + bob, wristZ, .073, .083, p.coat);
      item('cloth joints', p, shoulderX, 1.355 + bob, -.006, .077, .076, .089, p.coat);
      item('cloth joints', p, elbowX, 1.15 + bob, elbowZ, .077, .069, .085, p.coat);
      item('skin details', p, wristX, wristY -.035 + bob, wristZ + .013, .04, .058, .032, p.skin);
      item('collars and bands', p, wristX, wristY + .009 + bob, wristZ, .125, .038, .135, role.trim);
    }
    if (role.kind === 0) {
      item('wicker baskets', p, 0, .984 + bob, .271, 1, 1, 1, 0x9a7750);
      for (const y of [.91, 1.065]) {
        localQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        item('basket bands', p, 0, y + bob, .271, .145, .115, .145, 0x70543b, localQ);
      }
    } else if (role.kind === 1) {
      segment('scrolls', p, -.15, 1.055 + bob, .25, .15, 1.055 + bob, .25, .039, .039, 0xd7c6a0);
      segment('scrolls', p, -.16, 1.055 + bob, .25, -.13, 1.055 + bob, .25, .046, .046, 0x645442);
    }
  }

  function drawDistant(p, elapsed) {
    const bob = p.walking ? Math.sin(elapsed * 4 + p.phase) * .01 : 0;
    turn.setFromAxisAngle(Y, p.heading);
    item('distant garments', p, 0, bob, 0, 1, 1, 1, p.coat);
    item('distant heads', p, 0, 1.585 + bob, 0, .106, .14, .105, p.skin);
    item('distant legs', p, 0, 0, 0, 1, 1, 1, p.hem);
  }

  function update(elapsed, delta = 0, cameraPosition = null, camera = null) {
    // At a 144 Hz display, don't rebuild thousands of joint matrices at 144 Hz.
    // Nearby animation remains 40 Hz; distant silhouettes need even less work.
    if (initialized && elapsed - lastPoseTime < 1 / 40 && elapsed >= lastPoseTime) return;
    lastPoseTime = elapsed;
    if (camera) {
      camera.updateMatrixWorld();
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
    }
    for (const b of Object.values(batches)) b.used = 0;
    let detailed = 0, distant = 0;
    for (const p of people) {
      const z = p.walking ? -28 + ((p.z + 28 + elapsed * p.speed) % 156 + 156) % 156 : p.z;
      p.pos.set(p.x, .012, z);
      const distance = cameraPosition ? cameraPosition.distanceTo(p.pos) : 0;
      if (cameraPosition && distance > 245) continue;
      sphere.center.copy(p.pos); sphere.center.y += p.height * .5;
      if (camera && !frustum.intersectsSphere(sphere)) continue;
      if (distance < 34) { drawPerson(p, elapsed); detailed++; }
      else { drawDistant(p, elapsed); distant++; }
    }
    for (const b of Object.values(batches)) {
      b.mesh.count = b.used;
      // Visible residents are packed from index zero. Upload that live prefix,
      // not every unused capacity slot; empty batches only change their count.
      // Colors must follow every repack as different residents enter the view.
      if (!b.used) continue;
      b.mesh.instanceMatrix.clearUpdateRanges();
      b.mesh.instanceMatrix.addUpdateRange(0, b.used * 16);
      b.mesh.instanceMatrix.needsUpdate = true;
      if (b.mesh.instanceColor) {
        b.mesh.instanceColor.clearUpdateRanges();
        b.mesh.instanceColor.addUpdateRange(0, b.used * 3);
        b.mesh.instanceColor.needsUpdate = true;
      }
    }
    if (initialized) { stats.detailedResidents = detailed; stats.distantResidents = distant; stats.visibleResidents = detailed + distant; }
    initialized = true;
  }
  update(0);
  const stats = {
    count, residents: count, residentBatches: Object.values(batches).filter(b => b.used > 0).length,
    archetypes: PALETTES.map(p => p.name), articulated: true, detailedResidents: count, distantResidents: 0, visibleResidents: count,
  };
  group.userData.residents = people;
  return { update, stats, group, people, dispose() {
    root.remove(group); for (const g of geometries) g.dispose(); for (const mat of Object.values(materials)) mat.dispose();
  } };
}
