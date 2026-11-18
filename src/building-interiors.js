import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { optimizePointLightMaterial } from './light-optimization.js';

export const INTERIOR_TYPES = [
  { type: 'tea', label: '春和茶肆', description: '矮几与坐榻围合成茶席，案上陈列茶碗、茶壶与点心。推开原门即可回到街巷。' },
  { type: 'incense', label: '西域香铺', description: '木架陈列香罐与小瓶，长案上摆着熏炉，屏风后是掌柜的收纳架。' },
  { type: 'textile', label: '锦绣坊', description: '布匹卷轴与陈列桌展示不同色彩的织物，室内保留中间通道，可走近细看。' },
  { type: 'tavern', label: '长安酒家', description: '酒瓮靠墙排列，桌凳与食案错落分布，窗下是一处供旅人休憩的席位。' },
  { type: 'home', label: '坊民居舍', description: '床榻、衣箱、食案与屏风构成一处安静的唐风居舍，门外连接院落与街巷。' },
  { type: 'book', label: '听雨书舍', description: '书架、卷轴和文房几案分列两侧，案头有笔架与砚台，中央通道可自由往返。' },
];

// Furniture is lazily created as a handful of material-merged meshes. Rooms
// farther than 24 metres stay unbuilt/hidden, rather than adding hundreds of
// complete interiors to the city's rendering budget.
export function createInteriorSystem(root, materials, cubeGeometry, cylinderGeometry) {
  const buildings = [], byId = new Map();
  const templates = new Map();
  const woods = new THREE.MeshStandardMaterial({ color: 0x493328, roughness: .86 });
  const paper = new THREE.MeshStandardMaterial({ color: 0xcbba91, roughness: .98 });
  const blueSilk = new THREE.MeshStandardMaterial({ color: 0x567a7c, roughness: .86 });
  const redSilk = new THREE.MeshStandardMaterial({ color: 0x9a5c4b, roughness: .92 });
  const wovenMat = new THREE.MeshStandardMaterial({ color: 0x91866b, roughness: 1 });
  const lanternPaper = new THREE.MeshStandardMaterial({ color: 0xe9bb75, roughness: .9, emissive: 0xffa94f, emissiveIntensity: .6 });
  const greenJade = materials.jade;
  let interiorBuildCount = 0;
  const temp = new THREE.Vector3();
  // Exactly two stable lamps are reused for the room currently being visited.
  // Their positions are locked to architecture, never to the moving camera.
  const roomLamps = [new THREE.PointLight(0xffd4a0, 24, 12, 1.65), new THREE.PointLight(0xffdcb5, 18, 11, 1.65)];
  roomLamps.forEach((light, index) => { light.name = `Shared interior lantern ${index + 1}`; light.castShadow = false; light.visible = true; light.intensity = 0; root.add(light); });
  let litBuilding = null;
  let targetLitBuilding = null;
  let lampFade = 0;
  let gpuTemplatesWarmed = false;
  let templatesWarmed = false;
  let scanElapsed = 0;
  const previousPlayer = new THREE.Vector3(Infinity, Infinity, Infinity);
  const pendingRooms = new Set();
  const yieldFrame = () => new Promise(resolve => typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 0));

  function updateRoomLighting(delta) {
    // Moving a lit shared lamp to a neighbouring room changes every nearby
    // wall's colour in one frame. Fade it out before relocating, then warm the
    // new interior gradually; keep both lights registered for stable shaders.
    const relocating = litBuilding !== targetLitBuilding;
    lampFade = THREE.MathUtils.damp(lampFade, relocating || !litBuilding ? 0 : 1, 11, Math.min(delta, .1));
    if (relocating && lampFade < .015) {
      lampFade = 0; litBuilding = targetLitBuilding;
      if (litBuilding) {
        const room = litBuilding;
        roomLamps[0].position.set(-Math.min(1.9, room.w * .2), room.floorHeight + 2.48, room.d * .17).applyMatrix4(room.transform);
        roomLamps[1].position.set(Math.min(1.9, room.w * .2), room.floorHeight + 2.48, -.9).applyMatrix4(room.transform);
      }
    }
    roomLamps[0].intensity = 24 * lampFade;
    roomLamps[1].intensity = 18 * lampFade;
  }

  function add(record) {
    const b = { ...record, worldToLocal: record.transform.clone().invert(), group: null, ready: false };
    buildings.push(b); byId.set(b.id, b); return b;
  }
  function localPoint(b, x, z) { return temp.set(x, 0, z).applyMatrix4(b.worldToLocal); }
  function getInteriorAt(x, z) {
    for (const b of buildings) {
      if (Math.abs(x - b.position[0]) > b.radius || Math.abs(z - b.position[2]) > b.radius) continue;
      const point = localPoint(b, x, z);
      if (point.x > -b.w / 2 + .35 && point.x < b.w / 2 - .35 && point.z > -b.d / 2 + .35 && point.z < b.d / 2 - .78) return b;
    }
    return null;
  }
  function template(b) {
    const key = `${b.type}/${b.w}/${b.d}/${b.floorHeight}`;
    if (templates.has(key)) return templates.get(key);
    const parts = new Map();
    const y0 = b.floorHeight, sideX = Math.max(2, b.w / 2 - 1.25), back = -b.d / 2 + 1.1;
    function part(geometry, material, x, y, z, sx, sy, sz, ry = 0, rz = 0) {
      const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      for (const attr of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(attr)) g.deleteAttribute(attr);
      const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y0 + y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)), new THREE.Vector3(sx, sy, sz));
      g.applyMatrix4(matrix); let entry = parts.get(material); if (!entry) { entry = []; parts.set(material, entry); } entry.push(g);
    }
    const box = (mat, x, y, z, w, h, d, ry = 0) => part(cubeGeometry, mat, x, y, z, w, h, d, ry);
    const cyl = (mat, x, y, z, r, h, ry = 0) => part(cylinderGeometry, mat, x, y, z, r, h, r, ry);
    function table(x, z, w = 1.65, d = 1.1, high = .78) {
      box(woods, x, high, z, w, .12, d);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(woods, x + sx * (w / 2 - .12), high / 2, z + sz * (d / 2 - .12), .10, high, .10);
      cyl(greenJade, x, high + .17, z, .13, .19);
      for (const s of [-1, 1]) cyl(materials.pottery, x + s * .4, high + .1, z + .17, .09, .08);
    }
    function stool(x, z) { box(woods, x, .31, z, .48, .1, .48); for (const s of [-1, 1]) box(woods, x + s * .16, .16, z, .08, .3, .32); }
    function shelf(x, z, w = 2, height = 2.2, style = 'pots') {
      box(woods, x - w / 2, height / 2, z, .1, height, .55); box(woods, x + w / 2, height / 2, z, .1, height, .55);
      for (let level = 0; level < 4; level++) {
        const y = .22 + level * .54;
        box(woods, x, y, z, w, .08, .62);
        for (let i = 0; i < 5; i++) {
          const px = x - w * .38 + i * w * .19;
          if (style === 'books') {
            box(i % 2 ? blueSilk : paper, px, y + .16, z, .24, .25 + (i % 3) * .035, .36);
            box(paper, px, y + .19, z + .19, .2, .018, .015);
          } else if (style === 'silk') {
            part(cylinderGeometry, i % 2 ? redSilk : blueSilk, px, y + .16, z, .14, .45, .14, 0, Math.PI / 2);
          } else {
            cyl(i % 2 ? materials.pottery : greenJade, px, y + .20, z, .13, .30);
            cyl(woods, px, y + .37, z, .09, .04);
          }
        }
      }
    }
    function screen(x, z, w = 1.9, ry = 0) {
      box(woods, x, 1.1, z, w, 2.2, .10, ry); box(paper, x, 1.2, z + .065, w - .18, 1.7, .025, ry);
      for (let i = -2; i <= 2; i++) box(woods, x + i * w / 5, 1.2, z + .085, .025, 1.75, .02, ry);
    }
    // A compact hanging landscape/calligraphy scroll fills the rear wall,
    // with all marks built from geometry rather than external image assets.
    function hangingScroll(x, z, width = 1.08, height = 1.5) {
      const cy = 1.9;
      box(b.type === 'textile' ? redSilk : blueSilk, x, cy, z, width + .16, height + .22, .045);
      box(paper, x, cy, z + .032, width, height, .018);
      for (const sign of [-1, 1]) part(cylinderGeometry, woods, x, cy + sign * (height / 2 + .09), z + .045, .045, width + .28, .045, 0, Math.PI / 2);
      if (['book', 'incense'].includes(b.type)) {
        for (let i = 0; i < 5; i++) {
          const yy = cy + .48 - i * .22;
          box(woods, x, yy, z + .045, .16 + (i % 2) * .05, .027, .012);
          box(woods, x - .025, yy - .055, z + .047, .025, .14, .012);
        }
      } else {
        for (let i = 0; i < 4; i++) {
          box(greenJade, x - width * .3 + i * width * .2, cy - .1 + Math.sin(i) * .12, z + .045, width * .28, .055, .012, 0);
          part(cubeGeometry, blueSilk, x - .22 + i * .14, cy + .03, z + .052, .04, .47 - i * .055, .01, 0, -.5 + i * .25);
        }
        cyl(materials.gold, x + width * .27, cy + .43, z + .06, .075, .016);
      }
    }
    const rearWall = -b.d / 2 + .32;
    hangingScroll(0, rearWall, Math.min(1.25, b.w * .14), 1.55);
    // The raised shallow trims and floor mats do not change navigation.
    const beamY = 2.96;
    box(woods, 0, beamY, -b.d * .18, b.w - .45, .18, .19);
    box(woods, 0, beamY + .06, b.d * .20, b.w - .45, .16, .18);
    for (const sign of [-1, 1]) {
      const lampX = sign * Math.min(1.9, b.w * .2), lampZ = sign > 0 ? -.9 : b.d * .17;
      box(woods, lampX, 2.78, lampZ, .035, .32, .035);
      cyl(lanternPaper, lampX, 2.48, lampZ, .19, .37);
      cyl(woods, lampX, 2.68, lampZ, .21, .045); cyl(woods, lampX, 2.28, lampZ, .21, .045);
      box(wovenMat, sign * (sideX - .12), .022, b.type === 'home' ? .15 : -.25, 1.9, .034, b.type === 'home' ? 1.3 : 2.55);
      for (const edge of [-1, 1]) box(blueSilk, sign * (sideX - .12) + edge * .91, .043, b.type === 'home' ? .15 : -.25, .045, .012, b.type === 'home' ? 1.28 : 2.53);
    }
    // Every room is arranged around a broad, obstacle-free door-to-rear axis.
    const style = b.type === 'book' ? 'books' : b.type === 'textile' ? 'silk' : 'pots';
    shelf(-sideX, back, Math.min(2.4, b.w * .26), 2.2, style);
    if (b.type === 'home') {
      box(woods, sideX - .2, .4, back + .3, 2.1, .8, 2.7);
      box(blueSilk, sideX - .2, .85, back + .3, 2, .15, 2.6);
      box(paper, sideX - .2, 1.02, back - .55, 1.2, .18, .45);
      screen(sideX - .1, back + 2.05, 2.4);
      box(woods, -sideX, .34, 1, 1.65, .68, .85);
      table(-sideX + .5, -1, 1.2, .85, .45);
    } else if (b.type === 'book') {
      shelf(sideX, back, 2.2, 2.2, 'books');
      table(-sideX + .3, .1, 1.7, 1.05, .8); stool(-sideX + .3, 1.15);
      box(paper, -sideX + .3, .885, .1, .63, .015, .42);
      box(materials.black, -sideX + .8, .92, .1, .23, .035, .18);
      box(woods, sideX, .8, .5, 1.5, .1, .9); screen(sideX, 2, 1.8);
    } else if (b.type === 'incense') {
      shelf(sideX, back, 2.1, 2.2, 'pots');
      table(-sideX + .4, .3, 1.7, 1.1, .85);
      cyl(materials.gold, -sideX + .4, 1.08, .3, .25, .3);
      box(woods, sideX, .5, .4, 1.7, 1, .9);
      for (let i = 0; i < 5; i++) cyl(greenJade, sideX - .6 + i * .3, 1.15, .4, .10, .27);
    } else if (b.type === 'textile') {
      shelf(sideX, back, 2.1, 2.2, 'silk');
      for (const s of [-1, 1]) {
        table(s * (sideX - .1), .3, 1.8, 1.2, .8);
        for (let i = 0; i < 4; i++) box(i % 2 ? blueSilk : redSilk, s * (sideX - .1), .91 + i * .07, .3, 1.4, .06, .9);
      }
    } else {
      for (const s of [-1, 1]) {
        table(s * (sideX - .15), -.3, 1.6, 1.1, b.type === 'tea' ? .48 : .78);
        stool(s * (sideX - .15), .8); stool(s * (sideX - .15), -1.35);
      }
      if (b.type === 'tavern') {
        for (let i = 0; i < 4; i++) { cyl(materials.pottery, sideX - .7 + i * .48, .48, back + .2, .26, .92); cyl(woods, sideX - .7 + i * .48, .96, back + .2, .19, .05); }
      } else { screen(sideX, back + .2, 2.1); box(redSilk, sideX, .1, 1, 1.3, .2, 1.3); }
    }
    const result = [];
    for (const [material, pieces] of parts) {
      optimizePointLightMaterial(material);
      const geometry = mergeGeometries(pieces, false); pieces.forEach(g => g.dispose());
      result.push({ geometry, material });
    }
    templates.set(key, result); return result;
  }
  function ensure(b) {
    if (b.ready) return;
    const group = new THREE.Group(); group.name = `${b.label} · walkable furnished interior`;
    group.matrixAutoUpdate = false; group.matrix.copy(b.transform);
    for (const data of template(b)) { const mesh = new THREE.Mesh(data.geometry, data.material); mesh.receiveShadow = true; group.add(mesh); }
    root.add(group); b.group = group; b.ready = true; interiorBuildCount++;
  }
  async function prewarm(renderer = null, camera = null, scene = null) {
    if (!templatesWarmed) {
      // Geometry is prepared during the loading screen, one unique room shape
      // per frame. Approaching a new shop only clones cheap shared meshes.
      const unique = new Map();
      for (const b of buildings) unique.set(`${b.type}/${b.w}/${b.d}/${b.floorHeight}`, b);
      for (const b of unique.values()) { template(b); await yieldFrame(); }
      templatesWarmed = true;
    }
    if (renderer && camera && scene && !gpuTemplatesWarmed) {
      // compileAsync prepares programs, but does not upload furniture VBOs.
      // Draw the shared templates once into a tiny target during the loading
      // screen so the first opening does not have to upload a complete room.
      const warmScene = new THREE.Scene(); warmScene.name = 'Interior GPU warmup';
      warmScene.fog = scene.fog;
      warmScene.environment = scene.environment;
      warmScene.environmentIntensity = scene.environmentIntensity;
      scene.traverse(obj => {
        if (obj.isLight && obj.visible) { const light = obj.clone(); obj.getWorldPosition(light.position); warmScene.add(light); }
      });
      for (const entries of templates.values()) for (const entry of entries) {
        const mesh = new THREE.Mesh(entry.geometry, entry.material);
        mesh.frustumCulled = false; mesh.receiveShadow = true; warmScene.add(mesh);
      }
      const target = new THREE.WebGLRenderTarget(8, 8, { depthBuffer: true });
      let previous = null;
      try {
        if (renderer.compileAsync) await renderer.compileAsync(warmScene, camera);
        else renderer.compile(warmScene, camera);
        previous = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
          autoClear: renderer.autoClear, shadowAuto: renderer.shadowMap.autoUpdate, shadowNeeds: renderer.shadowMap.needsUpdate };
        renderer.autoClear = true;
        renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
        renderer.setRenderTarget(target);
        renderer.render(warmScene, camera);
        gpuTemplatesWarmed = true;
      } finally {
        if (previous) {
          renderer.setRenderTarget(previous.target, previous.face, previous.mip);
          renderer.autoClear = previous.autoClear;
          renderer.shadowMap.autoUpdate = previous.shadowAuto; renderer.shadowMap.needsUpdate = previous.shadowNeeds;
        }
        target.dispose();
      }
    }
    return { templateCount: templates.size, warmed: templatesWarmed, gpuWarmed: gpuTemplatesWarmed };
  }
  function update(player, delta = .016) {
    updateRoomLighting(delta);
    scanElapsed += delta;
    if (player && scanElapsed < .12 && previousPlayer.distanceToSquared(player) < .0625) return;
    scanElapsed = 0; if (player) previousPlayer.copy(player);
    let room = player && player.y < 15 ? getInteriorAt(player.x, player.z) : null;
    if (!room && player && player.y < 15) {
      let nearest = Infinity;
      for (const b of buildings) {
        if (!b.door?.open || b.door.angle < .18) continue;
        const point = localPoint(b, player.x, player.z);
        const front = b.d / 2 - .6;
        const extra = b === litBuilding ? 1 : 0;
        const halfDoor = (b.door.width ?? Math.min(3, b.w * .34)) / 2;
        const distance = point.z - front;
        // Warm the destination before the player crosses its threshold. The
        // extra metre retains the current room at the range boundary.
        if (distance < -.5 || distance > 4 + extra || Math.abs(point.x) > halfDoor + .65 + extra) continue;
        const score = Math.hypot(point.x, distance) - (extra ? .6 : 0);
        if (score < nearest) { nearest = score; room = b; }
      }
    }
    for (const b of buildings) {
      const distance = player ? Math.hypot(player.x - b.position[0], player.z - b.position[2]) : Infinity;
      const isNearDoor = b.door && player && Math.hypot(player.x - b.door.position.x, player.z - b.door.position.z) < 7;
      const visible = (b === room || distance < Math.max(13, b.radius + 3) && (b.door?.open || isNearDoor)) && (player?.y ?? 100) < 15;
      if (visible && !b.ready) pendingRooms.add(b);
      if (b.group) b.group.visible = visible;
    }
    // One group construction per scan avoids first-approach spikes from three
    // or four adjacent shops appearing in the same frame.
    const next = room && !room.ready ? room : pendingRooms.values().next().value;
    if (next) { ensure(next); pendingRooms.delete(next); }
    targetLitBuilding = room;
  }
  return { buildings, byId, add, getInteriorAt, update, prewarm, get stats() { return { furnishedInteriors: interiorBuildCount, interiorTypes: INTERIOR_TYPES.length, sharedInteriorLights: roomLamps.length, interiorTemplates: templates.size, templatesWarmed }; }, dispose() {
    for (const b of buildings) if (b.group) root.remove(b.group);
    for (const batch of templates.values()) batch.forEach(d => d.geometry.dispose());
    roomLamps.forEach(light => { root.remove(light); light.dispose(); });
    for (const mat of [woods, paper, blueSilk, redSilk, wovenMat, lanternPaper]) mat.dispose();
  } };
}
