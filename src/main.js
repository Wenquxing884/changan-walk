import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createCity } from './city.js';
import { PALACE_LAYOUT, PALACE_WORLD, PALACE_FLOOR, PALACE_CAMERAS, isPalaceInterior } from './palace-layout.js';
import { GARDEN_LAYOUT, GARDEN_CAMERAS, isGardenArea } from './garden-layout.js';
import { optimizeScenePointLights } from './light-optimization.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#world');
const app = $('#app');
const isTest = new URLSearchParams(location.search).has('test');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = window.matchMedia('(max-width: 760px)').matches;
const vec = (a) => new THREE.Vector3(...a);
const clamp = THREE.MathUtils.clamp;
const smooth = (t) => t * t * (3 - 2 * t);

const DESTINATIONS = {
  overview: { title: '全城总览', kicker: '俯瞰山河', numeral: '零一', pos: [242, 195, 285], target: [0, 0, -27], fov: 43 },
  market: { title: '灯火长街', kicker: '烟火人间', numeral: '零二', pos: [0, 2.1, 100], target: [0, 3.5, 57], fov: 62 },
  palace: { title: '宫阙庭院', kicker: '三重丹陛', numeral: '零三', pos: PALACE_CAMERAS.courtyard.position, target: PALACE_CAMERAS.courtyard.target, fov: PALACE_CAMERAS.courtyard.fov },
  interior: { title: '步入大殿', kicker: '梁间见天地', numeral: '零四', pos: PALACE_CAMERAS.interior.position, target: PALACE_CAMERAS.interior.target, fov: PALACE_CAMERAS.interior.fov },
  garden: { title: '曲池亭廊', kicker: '临水听风', numeral: '零五', pos: GARDEN_CAMERAS.entry.position, target: GARDEN_CAMERAS.entry.target, fov: GARDEN_CAMERAS.entry.fov },
};

const state = {
  ready: false, mode: 'overview', location: 'overview', transitioning: false,
  yaw: 0, pitch: 0, time: 0.42, fps: 60, frames: 0, lastMove: 0,
  player: new THREE.Vector3(0, 2.1, 100), move: { forward: false, backward: false, left: false, right: false },
  shift: false, dragging: false, sound: false, drawCalls: 0, triangles: 0,
  nearbyDoor: null, insideBuilding: null,
};

const scene = new THREE.Scene();
scene.background = new THREE.Color('#617686');
scene.fog = new THREE.FogExp2('#627688', 0.0006);
const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 1.5, 1900);
camera.position.copy(vec(DESTINATIONS.overview.pos));
camera.lookAt(vec(DESTINATIONS.overview.target));

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (error) {
  $('#loading-detail').textContent = '浏览器未能创建 WebGL 场景，请开启硬件加速后刷新。';
  throw error;
}
renderer.setSize(innerWidth, innerHeight, false);
const pixelBudget = mobile ? 1_150_000 : 2_100_000;
const idealPixelRatio = () => Math.min(devicePixelRatio, mobile ? 1.15 : 1.35, Math.sqrt(pixelBudget / (innerWidth * innerHeight)));
renderer.setPixelRatio(idealPixelRatio());
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Only architecture casts the sun shadow. Its map is independent of the
// player's position, so rendering it at every display refresh wastes a pass.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.info.autoReset = false;

const controls = new OrbitControls(camera, canvas);
controls.target.copy(vec(DESTINATIONS.overview.target));
controls.enableDamping = true;
controls.dampingFactor = 0.2;
controls.minDistance = 35;
controls.maxDistance = 640;
controls.maxPolarAngle = Math.PI * 0.465;
controls.minPolarAngle = 0.12;
controls.zoomSpeed = 0.65;
controls.panSpeed = 0.65;
controls.enablePan = true;
controls.addEventListener('start', () => {
  if (state.mode === 'overview' && !state.transitioning) controls.enableDamping = false;
});
controls.addEventListener('end', () => {
  controls.enableDamping = true;
});

const hemi = new THREE.HemisphereLight('#afc9e4', '#5c4b37', 1.65);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffd3a0', 2.25);
sun.position.set(-140, 200, 120);
sun.target.position.set(0, 0, -30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -115, right: 115, top: 170, bottom: -150, near: 5, far: 570 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.12;
scene.add(sun, sun.target);
const moon = new THREE.DirectionalLight('#98b8df', 0.35);
moon.position.set(90, 160, -210);
scene.add(moon);
const palaceFill = new THREE.PointLight('#ffbb72', 55, 32, 1.6);
palaceFill.position.set(0, PALACE_FLOOR + 8, PALACE_WORLD[2] - 2);
scene.add(palaceFill);

const skyUniforms = {
  topColor: { value: new THREE.Color('#243b59') },
  horizonColor: { value: new THREE.Color('#bd9e91') },
  bottomColor: { value: new THREE.Color('#798f9c') },
  night: { value: state.time },
};
const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 36, 18), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, uniforms: skyUniforms,
  vertexShader: 'varying vec3 direction; void main(){direction=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: `varying vec3 direction;uniform vec3 topColor,horizonColor,bottomColor;uniform float night;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){vec3 d=normalize(direction);float h=max(d.y,0.);vec3 col=mix(horizonColor,topColor,pow(h,.52));col=mix(bottomColor,col,smoothstep(-.06,.1,d.y));
      vec2 uv=vec2(atan(d.z,d.x)*4.,d.y*20.);float clouds=noise(uv*2.)*.5+noise(uv*5.)*.3+noise(uv*11.)*.2;
      float band=smoothstep(.05,.14,d.y)*(1.-smoothstep(.3,.58,d.y));float cloud=smoothstep(.43,.73,clouds)*band;
      col=mix(col,mix(vec3(.7,.52,.48),vec3(.19,.27,.4),night),cloud*.45);
      vec3 sunDir=normalize(vec3(-.65,.14,-.8));float glow=pow(max(dot(d,sunDir),0.),18.);col+=vec3(.3,.12,.04)*glow*(1.-night);
      gl_FragColor=vec4(col,1.);}`,
}));
sky.renderOrder = -10;
scene.add(sky);

const horizon = new THREE.Group();
const mountainMats = [];
for (let layer = 0; layer < 3; layer++) {
  const positions = [], indices = [], radius = 950 + layer * 100;
  const segments = 144;
  for (let i = 0; i <= segments; i++) {
    const angle = i / segments * Math.PI * 2;
    const height = 22 + layer * 11 + Math.sin(angle * 5 + layer) * 15 + Math.sin(angle * 11 - layer) * 8 + Math.sin(angle * 19 + layer * 3) * 3;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
    positions.push(x, -30, z, x, height, z);
    if (i < segments) { const a = i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setIndex(indices); g.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({ color: ['#60788a', '#718695', '#83949e'][layer], side: THREE.DoubleSide, fog: true });
  mountainMats.push(mat); const ridge = new THREE.Mesh(g, mat); horizon.add(ridge);
}
scene.add(horizon);

const starPoints = [];
let seed = 7181;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 470; i++) {
  const a = random() * Math.PI * 2, y = 0.15 + random() * 0.8, r = Math.sqrt(1 - y * y);
  starPoints.push(Math.cos(a) * r * 1100, y * 1100, Math.sin(a) * r * 1100);
}
const starGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(starPoints, 3));
const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: '#efe6cf', size: 1.5, transparent: true, opacity: 0.15, depthWrite: false, fog: false }));
scene.add(stars);

// The renderer's antialias flag only covers its default framebuffer. Bloom
// renders through offscreen buffers, so those buffers also need multisampling
// to keep distant roof tiles, window grids and stone joints from shimmering.
const sceneTarget = new THREE.WebGLRenderTarget(innerWidth, innerHeight, {
  type: THREE.HalfFloatType,
  samples: Math.min(mobile ? 2 : 4, renderer.capabilities.maxSamples),
});
const composer = new EffectComposer(renderer, sceneTarget);
// Keep postprocessing in physical pixels. An adaptive DPR change then resizes
// every target exactly once instead of reallocating at both the old and new
// logical sizes during the same frame.
composer.setPixelRatio(1);
composer.setSize(canvas.width, canvas.height);
composer.addPass(new RenderPass(scene, camera));
class CityBloomPass extends UnrealBloomPass {
  setSize(width, height) { super.setSize(Math.max(2, Math.round(width * .55)), Math.max(2, Math.round(height * .55))); }
}
const bloom = new CityBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.26, 0.5, 1.4);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let city = null;
let transition = null;
let elapsed = 0;
let toastTimeout;
const clock = new THREE.Clock();
const playerEye = 1.68;
const playerRadius = 0.48;
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const offset = new THREE.Vector3();
let interactionClock = 0;
let lastDoorPrompt = '';
let lastInteriorId = '';
let sceneAnimationEnabled = true;
let resizeTimer;
let pendingViewport = null;
let appliedViewport = { width: innerWidth, height: innerHeight, ratio: renderer.getPixelRatio() };
let graphicsSuspended = false;

// Resizing a WebGL drawing buffer clears the default framebuffer. Queue all
// changes and apply them at the beginning of the next animation frame so a
// resize or adaptive-resolution step can never clear the canvas after it has
// already been rendered for the frame being presented.
function queueViewportResize(ratio = idealPixelRatio(), force = false) {
  const maximum = idealPixelRatio();
  const value = Number.isFinite(ratio) ? clamp(ratio, Math.min(.85, maximum), maximum) : maximum;
  pendingViewport = { width: Math.max(1, innerWidth), height: Math.max(1, innerHeight), ratio: value, force };
}

function applyViewportResize() {
  if (!pendingViewport || graphicsSuspended) return;
  const next = pendingViewport;
  pendingViewport = null;
  const widthChanged = next.width !== appliedViewport.width || next.height !== appliedViewport.height;
  const ratioChanged = Math.abs(next.ratio - appliedViewport.ratio) > 0.0001;
  if (!widthChanged && !ratioChanged && !next.force) return;

  camera.aspect = next.width / next.height;
  camera.updateProjectionMatrix();
  // Three's atomic drawing-buffer setter updates the logical size, physical
  // pixel ratio and viewport without the duplicate canvas clears caused by
  // setPixelRatio() followed by setSize().
  renderer.setDrawingBufferSize(next.width, next.height, next.ratio);
  composer.setSize(canvas.width, canvas.height);
  appliedViewport = next;
}

function updateClipRange() {
  const near = state.mode === 'overview' && !state.transitioning ? 1.5 : 0.16;
  if (camera.near !== near) { camera.near = near; camera.updateProjectionMatrix(); }
}

function serializeDoor(door) {
  if (!door) return null;
  return { id: door.id, label: door.label, open: Boolean(door.open), angle: door.angle ?? 0,
    position: door.position?.toArray?.() ?? door.position, kind: door.kind ?? door.type ?? null };
}

function updateInteractions(force = false) {
  const active = state.ready && state.mode === 'walk' && !state.transitioning;
  const door = active ? city?.getNearbyDoor?.(state.player, camera.getWorldDirection(forward)) : null;
  const interior = active ? (city?.getInteriorAt?.(state.player.x, state.player.z) ?? city?.getBuildingAt?.(state.player)) : null;
  const exitingRoom = Boolean(door && interior && (door.buildingId === interior.id || door.id === interior.doorId));
  state.nearbyDoor = door;
  const prompt = door ? `${door.id}:${Boolean(door.open)}:${exitingRoom}` : '';
  if (force || prompt !== lastDoorPrompt) {
    lastDoorPrompt = prompt;
    $('#interact-btn').hidden = !door;
    app.classList.toggle('has-door', Boolean(door));
    if (door) {
      $('#interact-action').textContent = door.open ? '轻掩门扉' : exitingRoom ? '开门离开' : '推门入内';
      $('#interact-label').textContent = door.label || '街巷人家';
      $('#interact-btn').setAttribute('aria-label', `${door.open ? '关门' : '开门'}：${door.label || '街巷人家'}`);
    }
  }
  state.insideBuilding = interior ?? null;
  const interiorId = interior?.id ?? '';
  if (force || interiorId !== lastInteriorId) {
    lastInteriorId = interiorId;
    $('#interior-card').hidden = !interior;
    app.classList.toggle('has-interior', Boolean(interior));
    if (interior) {
      $('#interior-name').textContent = interior.label || interior.name || '长安人家';
      $('#interior-description').textContent = interior.description || '静看室内陈设，循原门可回到街巷。';
    }
  }
}

function interactWithDoor(id = state.nearbyDoor?.id) {
  if (!id || state.mode !== 'walk' || state.transitioning) return { ok: false, reason: '请先走近门扉' };
  const result = city?.interactDoor?.(id, state.player) ?? { ok: false, reason: '门扉暂不可交互' };
  if (!result.ok) toast(result.reason || '请离门稍远，再轻掩门扉', 2300);
  else playDoorSound(Boolean(result.open));
  updateInteractions(true);
  return result;
}

function playDoorSound(opening) {
  if (!state.sound || !audio) return;
  const now = audio.context.currentTime;
  const osc = audio.context.createOscillator(), gain = audio.context.createGain();
  osc.type = 'triangle'; osc.frequency.setValueAtTime(opening ? 138 : 105, now);
  osc.frequency.exponentialRampToValueAtTime(opening ? 78 : 64, now + .32);
  gain.gain.setValueAtTime(.015, now); gain.gain.exponentialRampToValueAtTime(.0001, now + .4);
  osc.connect(gain).connect(audio.volume); osc.start(now); osc.stop(now + .42);
}

function toast(text, duration = 3300) {
  clearTimeout(toastTimeout);
  $('#toast').textContent = text;
  $('#toast').classList.add('show');
  toastTimeout = setTimeout(() => $('#toast').classList.remove('show'), duration);
}

function setTime(value) {
  state.time = clamp(Number(value), 0, 1);
  const t = state.time;
  const night = smooth(t);
  const mixColor = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), night);
  hemi.color.copy(mixColor('#b8cee1', '#738ba9'));
  hemi.groundColor.copy(mixColor('#76634a', '#302d3d'));
  hemi.intensity = THREE.MathUtils.lerp(2.1, 0.8, night);
  sun.color.copy(mixColor('#ffdab0', '#b4c7ed'));
  sun.intensity = THREE.MathUtils.lerp(3.1, 0.28, night);
  moon.intensity = THREE.MathUtils.lerp(0.14, 0.65, night);
  skyUniforms.topColor.value.copy(mixColor('#537b9e', '#07152f'));
  skyUniforms.horizonColor.value.copy(mixColor('#ddb8a2', '#34496c'));
  skyUniforms.bottomColor.value.copy(mixColor('#8c9da6', '#283c54'));
  skyUniforms.night.value = night;
  scene.fog.color.copy(mixColor('#9ba4a6', '#2d435b'));
  scene.fog.density = THREE.MathUtils.lerp(0.00042, 0.00072, night);
  mountainMats.forEach((mat, i) => mat.color.copy(mixColor(['#60788a', '#718695', '#83949e'][i], ['#1b2d44', '#26394f', '#30445d'][i])));
  stars.material.opacity = Math.max(0, (t - 0.28) * 0.85);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(1.12, 1.28, night);
  bloom.strength = THREE.MathUtils.lerp(0.17, 0.36, night);
  const minutes = Math.round(17 * 60 + t * 190);
  $('#time-value').textContent = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  $('#time-label').textContent = t < 0.35 ? '酉时' : t < 0.78 ? '戌时' : '亥时';
  $('#sky-name').textContent = t < 0.28 ? '斜阳 · 映宫阙' : t < 0.7 ? '日暮 · 灯初上' : '夜深 · 万家明';
  city?.setTime?.(t);
}

function markLocation(id) {
  state.location = id;
  const d = DESTINATIONS[id];
  $('#place-title').textContent = d.title;
  $('#place-kicker').textContent = d.kicker;
  $('#place-index').textContent = d.numeral;
  document.querySelectorAll('.destination').forEach((button) => {
    const selected = button.dataset.destination === id;
    button.classList.toggle('active', selected);
    if (selected) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
  });
}

function applyMode(mode) {
  state.mode = mode;
  app.classList.toggle('mode-walk', mode === 'walk');
  controls.enabled = mode === 'overview' && !state.transitioning;
  const label = $('#walk-toggle span');
  label.textContent = mode === 'walk' ? '返回全城' : '步入街巷';
  canvas.style.cursor = mode === 'walk' ? 'grab' : 'default';
  state.move = { forward: false, backward: false, left: false, right: false };
  updateClipRange();
  updateInteractions(true);
}

function directionFromTarget(target) {
  offset.copy(target).sub(camera.position).normalize();
  state.yaw = Math.atan2(-offset.x, -offset.z);
  state.pitch = Math.asin(clamp(offset.y, -0.95, 0.95));
}

function orientPlayer() {
  camera.rotation.order = 'YXZ';
  camera.rotation.set(state.pitch, state.yaw, 0);
}

function getGround(x, z) {
  return city?.getHeight?.(x, z) ?? 0;
}

function insideCollider(x, z) {
  for (const collider of city?.colliders ?? []) {
    if (collider.isEmpty?.() || collider.userData?.disabled) continue;
    const minX = collider.min?.x ?? collider.minX;
    const maxX = collider.max?.x ?? collider.maxX;
    const minZ = collider.min?.z ?? collider.minZ;
    const maxZ = collider.max?.z ?? collider.maxZ;
    if (x > minX - playerRadius && x < maxX + playerRadius && z > minZ - playerRadius && z < maxZ + playerRadius) return true;
  }
  return false;
}

function movePlayer(delta) {
  if (state.transitioning || state.mode !== 'walk') return;
  let x = Number(state.move.right) - Number(state.move.left);
  let z = Number(state.move.forward) - Number(state.move.backward);
  if (x || z) {
    const length = Math.hypot(x, z); x /= length; z /= length;
    forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    right.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
    const speed = state.shift ? 17 : 7.5;
    const dx = (forward.x * z + right.x * x) * speed * delta;
    const dz = (forward.z * z + right.z * x) * speed * delta;
    // Small steps prevent crossing thin walls when a frame takes longer than usual.
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
    for (let i = 0; i < steps; i++) {
      const nextX = clamp(state.player.x + dx / steps, -202, 202);
      if (!insideCollider(nextX, state.player.z)) state.player.x = nextX;
      const nextZ = clamp(state.player.z + dz / steps, -210, 170);
      if (!insideCollider(state.player.x, nextZ)) state.player.z = nextZ;
    }
    state.lastMove = elapsed;
    updateWalkLocation();
  }
  const height = getGround(state.player.x, state.player.z) + playerEye;
  state.player.y = THREE.MathUtils.damp(state.player.y, height, 16, delta);
  camera.position.copy(state.player);
  orientPlayer();
}

function updateWalkLocation() {
  const id = isPalaceInterior(state.player.x, state.player.z) ? 'interior' : isGardenArea(state.player.x, state.player.z) ? 'garden' : state.player.z < -49 ? 'palace' : 'market';
  if (id !== state.location) markLocation(id);
}

function groundJourney(points, duration) {
  const route = points.map(p => p.clone());
  const lengths = [0];
  for (let i = 1; i < route.length; i++) lengths.push(lengths.at(-1) + Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z));
  return { route, lengths, length: lengths.at(-1), duration, start: elapsed };
}

function groundJourneyPoint(journey, u, result = new THREE.Vector3()) {
  const distance = u * journey.length;
  let i = 1;
  while (i < journey.route.length - 1 && distance > journey.lengths[i]) i++;
  const span = journey.lengths[i] - journey.lengths[i - 1];
  result.lerpVectors(journey.route[i - 1], journey.route[i], span ? clamp((distance - journey.lengths[i - 1]) / span, 0, 1) : 1);
  result.y = getGround(result.x, result.z) + playerEye;
  return result;
}

function goTo(id) {
  if (!state.ready || !DESTINATIONS[id] || state.transitioning) return false;
  const d = DESTINATIONS[id];
  const initial = camera.position.clone();
  const initialTarget = state.mode === 'overview' ? controls.target.clone() : camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(24).add(initial);
  const endpoint = vec(d.pos);
  if (id !== 'overview') endpoint.y = getGround(endpoint.x, endpoint.z) + playerEye;
  const endTarget = vec(d.target);
  const points = [initial];
  let exitDoor = null;
  let exitPhase = null;
  let hallExit = null;
  let hallEntry = null;
  const currentInterior = state.mode === 'walk' ? (city?.getInteriorAt?.(state.player.x, state.player.z) ?? city?.getBuildingAt?.(state.player)) : null;
  // Exit an ordinary room through its doorway before lifting into the city.
  // Otherwise a destination click from indoors would take the camera through
  // the room's roof. The hall keeps its dedicated central entrance route below.
  if (currentInterior && currentInterior.id !== 'palace-hall') {
    const door = (city?.doors ?? []).find(item => item.buildingId === currentInterior.id || item.id === currentInterior.doorId);
    if (door) {
      exitDoor = door;
      const center = door.position.clone();
      const normal = door.normal?.clone?.() ?? center.clone().sub(vec(currentInterior.position ?? [0, 0, 0])).setY(0).normalize();
      const inside = center.clone().addScaledVector(normal, -2); inside.y = getGround(inside.x, inside.z) + playerEye;
      const outside = center.clone().addScaledVector(normal, 2.8); outside.y = getGround(outside.x, outside.z) + playerEye;
      // Door traversal has its own low, linear phase. It is not part of the
      // flight spline: the camera must wait for the actual leaves to clear.
      exitPhase = { door, stage: 'approach', from: initial.clone(), inside, outside,
        start: elapsed, duration: isTest ? .15 : reducedMotion ? .18 : Math.max(.3, Math.min(1.1, initial.distanceTo(inside) / 4.5)) };
      points[0] = outside;
      points.push(outside.clone().add(new THREE.Vector3(0, 17, 0)));
    }
  }
  const stairBase = new THREE.Vector3(0, playerEye + .08, PALACE_LAYOUT.stairFlights[0].startZ + 4);
  if (currentInterior?.id === 'palace-hall' && id !== 'interior') {
    const portalOutside = PALACE_WORLD[2] + PALACE_LAYOUT.entrance.localZ + 3;
    hallExit = groundJourney([initial, new THREE.Vector3(0, initial.y, initial.z),
      new THREE.Vector3(0, PALACE_FLOOR + playerEye, portalOutside), stairBase], isTest ? .65 : reducedMotion ? .9 : 5.8);
    points[0] = stairBase.clone();
  }
  if (id === 'interior') {
    if (currentInterior?.id === 'palace-hall') {
      points.push(endpoint);
    } else {
      if (state.location !== 'palace') points.push(new THREE.Vector3(0, 48, -60));
      points.push(stairBase.clone());
      hallEntry = groundJourney([stairBase, endpoint], isTest ? .55 : reducedMotion ? .9 : 6.2);
    }
  } else if (id === 'overview') {
    const launch = points[0];
    points.push(new THREE.Vector3(launch.x + 12, Math.max(launch.y + 30, 55), launch.z + 20));
    points.push(new THREE.Vector3(120, 150, 105), endpoint);
  } else if (state.mode === 'overview' || Math.abs(initial.z - endpoint.z) > 70) {
    points.push(new THREE.Vector3(endpoint.x + 12, Math.max(40, Math.min(initial.y * 0.5, 85)), endpoint.z + 55));
    points.push(new THREE.Vector3(endpoint.x, 8, endpoint.z + 20), endpoint);
  } else {
    points.push(initial.clone().lerp(endpoint, 0.5).add(new THREE.Vector3(0, 9, 0)), endpoint);
  }
  transition = {
    type: 'travel', id, start: elapsed, duration: isTest ? 0.26 : reducedMotion ? 0.5 : id === 'interior' ? 4.3 : 3.5,
    curve: new THREE.CatmullRomCurve3(points, false, 'centripetal'),
    flightEndpoint: hallEntry ? stairBase : endpoint,
    initialTarget, endTarget, startFov: camera.fov, endFov: d.fov, endpoint,
    exitDoor, exitPhase, hallExit, hallEntry, hallStage: hallExit ? 'exit' : 'flight',
  };
  state.transitioning = true;
  updateClipRange();
  updateInteractions(true);
  controls.enabled = false;
  controls.stopListenToKeyEvents();
  app.classList.add('transitioning');
  $('#transition-kicker').textContent = id === 'overview' ? '再看长安' : '循光而行';
  $('#transition-name').textContent = d.title;
  return true;
}

function finishTravel(t) {
  camera.position.copy(t.endpoint);
  camera.fov = t.endFov;
  camera.updateProjectionMatrix();
  markLocation(t.id);
  state.transitioning = false;
  transition = null;
  app.classList.remove('transitioning');
  if (t.id === 'overview') {
    applyMode('overview');
    controls.target.copy(t.endTarget);
    camera.lookAt(t.endTarget);
    controls.update();
  } else {
    applyMode('walk');
    state.player.copy(camera.position);
    directionFromTarget(t.endTarget);
    orientPlayer();
    updateInteractions(true);
    if (!isTest && t.id === 'interior') toast('已步入大殿 · 向前探索御座，回头可走出宫门');
    else if (!isTest && t.id === 'market') toast('沿街探索 · 靠近门扉，按 E 开门参观', 3800);
  }
}

function startIllusion() {
  if (!state.ready || state.transitioning) return;
  const focus = vec(PALACE_CAMERAS.illusionFocus);
  const aspect = camera.aspect;
  // Keep the palace's full ceremonial frontage fixed while the lens opens up.
  // Use vertical FOV internally; the width constraint includes the live aspect ratio.
  const frameWidth = PALACE_CAMERAS.illusionFrameWidth;
  const nearFov = 53;
  const farFov = 10;
  const distanceFor = (fov) => frameWidth / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * aspect);
  transition = {
    type: 'illusion', start: elapsed, duration: isTest ? 0.65 : reducedMotion ? 1.2 : 8.5,
    savedPosition: camera.position.clone(), savedQuaternion: camera.quaternion.clone(), savedFov: camera.fov,
    savedTarget: controls.target.clone(), focus, frameWidth, farFov, nearFov, distanceFor,
  };
  state.transitioning = true;
  updateClipRange();
  updateInteractions(true);
  controls.enabled = false;
  app.classList.add('transitioning');
  $('#transition-kicker').textContent = '一幅画，渐成一座城';
  $('#transition-name').textContent = '透视幻境';
}

function updateTransition() {
  if (!transition) return;
  const t = transition;
  if (t.type === 'travel' && t.hallExit) {
    const progress = clamp((elapsed - t.hallExit.start) / t.hallExit.duration, 0, 1);
    groundJourneyPoint(t.hallExit, smooth(progress), camera.position);
    camera.lookAt(new THREE.Vector3(camera.position.x, camera.position.y + .5, camera.position.z + 8));
    if (progress >= 1) {
      t.hallExit = null; t.hallStage = 'flight'; t.start = elapsed;
      t.initialTarget = camera.position.clone().add(new THREE.Vector3(0, 1, 12));
    }
    return;
  }
  if (t.type === 'travel' && t.hallStage === 'entry') {
    const journey = t.hallEntry;
    const progress = clamp((elapsed - journey.start) / journey.duration, 0, 1);
    groundJourneyPoint(journey, smooth(progress), camera.position);
    camera.lookAt(new THREE.Vector3(camera.position.x, camera.position.y + .65, camera.position.z - 10));
    if (progress >= 1) finishTravel(t);
    return;
  }
  if (t.type === 'travel' && t.exitPhase) {
    const exit = t.exitPhase;
    const normal = exit.door.normal;
    if (exit.stage === 'approach') {
      const u = smooth(clamp((elapsed - exit.start) / exit.duration, 0, 1));
      camera.position.lerpVectors(exit.from, exit.inside, u);
      camera.lookAt(exit.outside);
      if (u >= 1) {
        // Use the camera's current position, never a stale player position or a
        // distant interaction request which the door system correctly rejects.
        if (!exit.door.open) city?.interactDoor?.(exit.door.id, camera.position);
        exit.stage = 'wait';
      }
      return;
    }
    if (exit.stage === 'wait') {
      camera.position.copy(exit.inside); camera.lookAt(exit.outside);
      if (!exit.door.open) city?.interactDoor?.(exit.door.id, camera.position);
      if (exit.door.angle > Math.PI / 3) {
        exit.stage = 'cross'; exit.start = elapsed;
        exit.duration = isTest ? .2 : reducedMotion ? .25 : .85;
      }
      return;
    }
    if (exit.stage === 'cross') {
      // A door can be toggled during a journey by another input. Stop on the
      // inside until it clears instead of ever passing through a closed leaf.
      if (!exit.door.open || exit.door.angle <= Math.PI / 3) {
        if (!exit.door.open) city?.interactDoor?.(exit.door.id, camera.position);
        exit.start = elapsed;
        return;
      }
      const u = smooth(clamp((elapsed - exit.start) / exit.duration, 0, 1));
      camera.position.lerpVectors(exit.inside, exit.outside, u);
      camera.position.y = getGround(camera.position.x, camera.position.z) + playerEye;
      camera.lookAt(exit.outside.clone().addScaledVector(normal, 4));
      if (u >= 1) {
        t.exitPhase = null; t.start = elapsed;
        t.initialTarget = exit.outside.clone().addScaledVector(normal, 12);
      }
      return;
    }
  }
  const progress = clamp((elapsed - t.start) / t.duration, 0, 1);
  if (t.type === 'travel') {
    const u = smooth(progress);
    camera.position.copy(t.curve.getPoint(u));
    if (t.exitDoor && !t.exitDoor.open && Math.hypot(camera.position.x - t.exitDoor.position.x, camera.position.z - t.exitDoor.position.z) < 4.3) {
      city?.interactDoor?.(t.exitDoor.id, camera.position);
    }
    const target = t.initialTarget.clone().lerp(t.endTarget, smooth(clamp(progress * 1.4, 0, 1)));
    camera.lookAt(target);
    camera.fov = THREE.MathUtils.lerp(t.startFov, t.endFov, u);
    camera.updateProjectionMatrix();
    if (progress >= 1) {
      if (t.hallEntry) { t.hallStage = 'entry'; t.hallEntry.start = elapsed; }
      else finishTravel(t);
    }
    return;
  }
  const blendIn = smooth(clamp(progress / 0.17, 0, 1));
  const reveal = smooth(clamp((progress - 0.19) / 0.46, 0, 1));
  const blendOut = smooth(clamp((progress - 0.79) / 0.21, 0, 1));
  const fov = Math.exp(THREE.MathUtils.lerp(Math.log(t.farFov), Math.log(t.nearFov), reveal));
  const distance = t.distanceFor(fov);
  const yaw = THREE.MathUtils.degToRad(16) * smooth(clamp((progress - 0.45) / 0.25, 0, 1));
  const illusionPos = t.focus.clone().add(new THREE.Vector3(Math.sin(yaw) * distance, 0, Math.cos(yaw) * distance));
  // The raised palace platform is visible above the courtyard wall; do not move any buildings.
  illusionPos.y = PALACE_FLOOR + 9 + reveal * 8;
  const wanted = t.savedPosition.clone().lerp(illusionPos, blendIn).lerp(t.savedPosition, blendOut);
  camera.position.copy(wanted);
  camera.lookAt(t.focus);
  if (blendIn < 1) camera.quaternion.slerpQuaternions(t.savedQuaternion, camera.quaternion.clone(), blendIn);
  if (blendOut > 0) camera.quaternion.slerp(t.savedQuaternion, blendOut);
  camera.fov = THREE.MathUtils.lerp(THREE.MathUtils.lerp(t.savedFov, fov, blendIn), t.savedFov, blendOut);
  camera.updateProjectionMatrix();
  if (progress >= 1) {
    camera.position.copy(t.savedPosition); camera.quaternion.copy(t.savedQuaternion); camera.fov = t.savedFov;
    camera.updateProjectionMatrix(); controls.target.copy(t.savedTarget);
    transition = null; state.transitioning = false; app.classList.remove('transitioning');
    updateClipRange();
    controls.enabled = state.mode === 'overview';
    if (state.mode === 'overview') controls.update(); else orientPlayer();
  }
}

const landmarks = [
  { id: 'market', name: '灯火长街', point: new THREE.Vector3(0, 12, 80) },
  { id: 'palace', name: '宫阙庭院', point: new THREE.Vector3(0, 12, -73) },
  { id: 'interior', name: '步入大殿', point: new THREE.Vector3(PALACE_WORLD[0], PALACE_LAYOUT.body.totalHeight + 3, PALACE_WORLD[2]) },
  { id: 'garden', name: '曲池亭廊', point: new THREE.Vector3(GARDEN_LAYOUT.center[0], 8, GARDEN_LAYOUT.center[1]) },
];
for (const l of landmarks) {
  const el = document.createElement('button');
  el.className = 'landmark'; el.dataset.destination = l.id; el.setAttribute('aria-label', `前往${l.name}`);
  el.innerHTML = `<span class="landmark-label">${l.name}<i>↗</i></span><span class="landmark-stem"></span>`;
  $('#landmarks').append(el); l.element = el; l.visible = false;
}
const project = new THREE.Vector3();
function updateLandmarks() {
  for (const l of landmarks) {
    project.copy(l.point).project(camera);
    const x = (project.x * 0.5 + 0.5) * innerWidth;
    const y = (-project.y * 0.5 + 0.5) * innerHeight;
    const visible = state.mode === 'overview' && !state.transitioning && project.z > -1 && project.z < 1 && x > (mobile ? 140 : 340) && x < innerWidth - 35 && y > 140 && y < innerHeight - 175;
    if (visible !== l.visible) {
      l.visible = visible;
      l.element.classList.toggle('visible', visible);
      l.element.style.pointerEvents = visible ? 'auto' : 'none';
    }
    l.element.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) translate(-50%, -100%)`;
  }
  camera.getWorldDirection(forward);
  $('#compass-needle').style.transform = `rotate(${Math.atan2(forward.x, -forward.z)}rad)`;
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-destination]');
  if (button) goTo(button.dataset.destination);
});
$('#brand-home').addEventListener('click', (event) => { event.preventDefault(); goTo('overview'); });
$('#walk-toggle').addEventListener('click', () => goTo(state.mode === 'walk' ? 'overview' : 'market'));
$('#illusion-btn').addEventListener('click', startIllusion);
$('#interact-btn').addEventListener('click', () => interactWithDoor());
$('#time-slider').addEventListener('input', (event) => setTime(event.target.value));
$('#help-btn').addEventListener('click', () => $('#help-dialog').showModal());
$('#close-help').addEventListener('click', () => $('#help-dialog').close());
$('#begin-explore').addEventListener('click', () => $('#help-dialog').close());
$('#help-dialog').addEventListener('click', (event) => { if (event.target === $('#help-dialog')) $('#help-dialog').close(); });
$('#fullscreen-btn').addEventListener('click', async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await app.requestFullscreen(); }
  catch { toast('当前浏览器未允许全屏，可使用浏览器的全屏功能'); }
});

const keyMap = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'backward', ArrowDown: 'backward', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right' };
window.addEventListener('keydown', (event) => {
  if ($('#help-dialog').open || event.target instanceof HTMLInputElement) return;
  if (event.code === 'Escape') { if (state.ready && !state.transitioning) goTo('overview'); return; }
  if (event.code === 'KeyE' && !event.repeat && state.mode === 'walk') { event.preventDefault(); interactWithDoor(); return; }
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') state.shift = true;
  if (keyMap[event.code] && state.mode === 'walk') { state.move[keyMap[event.code]] = true; event.preventDefault(); }
});
window.addEventListener('keyup', (event) => {
  if (keyMap[event.code]) state.move[keyMap[event.code]] = false;
  if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') state.shift = false;
});
window.addEventListener('blur', () => { Object.keys(state.move).forEach((k) => { state.move[k] = false; }); state.shift = false; state.dragging = false; });

let pointer = null;
canvas.addEventListener('pointerdown', (event) => {
  if (state.mode !== 'walk' || state.transitioning || event.button > 0) return;
  pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  state.dragging = true; canvas.setPointerCapture(event.pointerId); canvas.style.cursor = 'grabbing';
});
canvas.addEventListener('pointermove', (event) => {
  if (!pointer || pointer.id !== event.pointerId || state.mode !== 'walk' || state.transitioning) return;
  state.yaw -= (event.clientX - pointer.x) * 0.0033;
  state.pitch = clamp(state.pitch - (event.clientY - pointer.y) * 0.003, -1.15, 1.15);
  pointer.x = event.clientX; pointer.y = event.clientY;
  orientPlayer();
});
function releasePointer() { pointer = null; state.dragging = false; if (state.mode === 'walk') canvas.style.cursor = 'grab'; }
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('wheel', (event) => {
  if (state.mode !== 'walk' || state.transitioning) return;
  event.preventDefault();
  camera.fov = clamp(camera.fov + event.deltaY * 0.025, 38, 80); camera.updateProjectionMatrix();
}, { passive: false });
for (const button of document.querySelectorAll('[data-move]')) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault(); button.setPointerCapture(event.pointerId); state.move[button.dataset.move] = true;
  });
  const stop = () => { state.move[button.dataset.move] = false; };
  button.addEventListener('pointerup', stop); button.addEventListener('pointercancel', stop); button.addEventListener('lostpointercapture', stop);
}

let audio = null;
async function toggleSound() {
  try {
    if (!audio) {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const volume = context.createGain(); volume.gain.value = 0; volume.connect(context.destination);
      const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
      const data = buffer.getChannelData(0); let last = 0;
      for (let i = 0; i < data.length; i++) { last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02; data[i] = last * 2.2; }
      const noise = context.createBufferSource(); noise.buffer = buffer; noise.loop = true;
      const filter = context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 620;
      noise.connect(filter).connect(volume); noise.start();
      const windBell = () => {
        if (!state.sound) return;
        const freq = [523.25, 659.25, 783.99, 1046.5][Math.floor(Math.random() * 4)];
        const osc = context.createOscillator(); const bell = context.createGain();
        osc.type = 'sine'; osc.frequency.value = freq; bell.gain.setValueAtTime(0, context.currentTime);
        bell.gain.linearRampToValueAtTime(0.022, context.currentTime + 0.01);
        bell.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 3.5);
        osc.connect(bell).connect(volume); osc.start(); osc.stop(context.currentTime + 3.6);
      };
      audio = { context, volume, timer: setInterval(windBell, 5800) };
    }
    await audio.context.resume(); state.sound = !state.sound;
    audio.volume.gain.setTargetAtTime(state.sound ? 0.5 : 0, audio.context.currentTime, 0.35);
    $('#sound-btn').classList.toggle('sound-on', state.sound);
    $('#sound-btn').setAttribute('aria-pressed', String(state.sound));
    $('#sound-btn').setAttribute('aria-label', state.sound ? '关闭环境声' : '开启环境声');
    toast(state.sound ? '风过长街，檐铃轻响' : '已关闭环境声', 2200);
  } catch { toast('当前浏览器暂不支持环境声'); }
}
$('#sound-btn').addEventListener('click', toggleSound);

window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => queueViewportResize(Math.min(renderer.getPixelRatio(), idealPixelRatio())), 80);
});
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault(); graphicsSuspended = true;
  toast('图形设备正在恢复，稍候即可继续游历', 10000);
});
canvas.addEventListener('webglcontextrestored', () => {
  graphicsSuspended = false;
  renderer.shadowMap.needsUpdate = true;
  queueViewportResize(Math.min(renderer.getPixelRatio(), idealPixelRatio()), true);
  toast('场景已恢复，可以继续游历', 2400);
});

let performanceClock = 0;
let performanceFrames = 0;
let slowWindows = 0;
let fastWindows = 0;
function animate() {
  const rawDelta = clock.getDelta();
  if (graphicsSuspended) return;
  const delta = Math.min(rawDelta, 0.055);
  elapsed += Math.min(rawDelta, 0.25); performanceClock += rawDelta; performanceFrames++; state.frames++;
  applyViewportResize();
  if (transition) updateTransition(); else if (state.mode === 'walk') movePlayer(delta); else controls.update();
  camera.updateMatrixWorld();
  sky.position.copy(camera.position);
  city?.update?.(elapsed, delta, camera.position, { animate: sceneAnimationEnabled, camera });
  interactionClock += delta;
  if (interactionClock >= .09) { updateInteractions(); interactionClock = 0; }
  updateLandmarks();
  renderer.info.reset();
  composer.render(delta);
  state.drawCalls = renderer.info.render.calls;
  state.triangles = renderer.info.render.triangles;
  if (performanceClock > 1.5) {
    state.fps = Math.round(performanceFrames / performanceClock);
    $('#performance').textContent = `${state.fps} FPS  ·  长安 · 入境`;
    // Recover resolution gradually when the GPU has spare time, with hysteresis
    // so momentary loading or a single dropped frame cannot oscillate quality.
    if (!isTest && state.frames > 100) {
      if (state.fps < 46) { slowWindows++; fastWindows = 0; }
      else if (state.fps > 58) { fastWindows++; slowWindows = 0; }
      else { slowWindows = 0; fastWindows = 0; }
      const current = renderer.getPixelRatio(), ideal = idealPixelRatio();
      const minimum = Math.min(.85, ideal);
      const next = slowWindows >= 2 ? Math.max(minimum, current - .1) : fastWindows >= 8 ? Math.min(ideal, current + .05) : current;
      if (next !== current) {
        queueViewportResize(next);
        slowWindows = 0; fastWindows = 0;
      }
    }
    performanceClock = 0; performanceFrames = 0;
  }
}

window.__CHANGAN__ = {
  snapshot: () => ({ ready: state.ready, mode: state.mode, location: state.location, transitioning: state.transitioning,
    position: camera.position.toArray(), target: state.mode === 'overview' ? controls.target.toArray() : camera.getWorldDirection(new THREE.Vector3()).add(camera.position).toArray(),
    renderer: { calls: state.drawCalls, triangles: state.triangles, frame: state.frames }, fps: state.fps, time: state.time,
    pixelRatio: renderer.getPixelRatio(), asset: city?.stats ?? null, nearbyDoor: serializeDoor(state.nearbyDoor),
    insideBuilding: state.insideBuilding ? { id: state.insideBuilding.id, label: state.insideBuilding.label, type: state.insideBuilding.type, doorId: state.insideBuilding.doorId } : null }),
  goTo, illusion: startIllusion, setTime,
  palace: { layout: PALACE_LAYOUT, world: PALACE_WORLD, floor: PALACE_FLOOR, cameras: PALACE_CAMERAS },
  garden: { layout: GARDEN_LAYOUT, cameras: GARDEN_CAMERAS },
  setPlayerPosition(x, z, yaw = state.yaw) {
    if (state.transitioning) return false;
    state.player.set(x, getGround(x, z) + playerEye, z); state.yaw = yaw;
    applyMode('walk'); camera.position.copy(state.player); orientPlayer(); updateWalkLocation(); updateInteractions(true); return true;
  },
  facePlayer(x, z) { state.yaw = Math.atan2(state.player.x - x, state.player.z - z); orientPlayer(); },
  get colliders() { return city?.colliders ?? []; },
  get doors() { return city?.doors ?? []; },
  get buildings() { return city?.buildings ?? []; },
  interactDoor: interactWithDoor,
  getInteriorAt: (x, z) => city?.getInteriorAt?.(x, z) ?? null,
  setAnimationEnabled(value) { sceneAnimationEnabled = Boolean(value); },
  requestViewportResize: queueViewportResize,
  camera, renderer, scene, controls, sky, landmarks,
};

async function init() {
  setTime(state.time);
  renderer.setAnimationLoop(animate);
  try {
    city = await createCity(scene, { onProgress: ({ label, progress }) => {
      $('#loading-detail').textContent = label || '营造宫阙与街巷';
      $('#loading-progress').style.width = `${Math.max(10, Math.min(92, (progress ?? 0.5) * 100))}%`;
    } });
    setTime(state.time);
    if (city.palaceReady) await city.palaceReady;
    optimizeScenePointLights(scene);
    $('#loading-detail').textContent = '预备室内陈设与材质';
    await city.prewarmInteriors?.(renderer, camera);
    // compileAsync traverses hidden meshes as well, so LOD and crowd variants
    // are prepared without briefly drawing them over the active model.
    await renderer.compileAsync(scene, camera);
    renderer.shadowMap.needsUpdate = true;
    state.ready = true;
    $('#loading-progress').style.width = '100%';
    $('#loading-detail').textContent = '长安已就绪';
    setTimeout(() => $('#loading').classList.add('done'), isTest ? 0 : 650);
    if (!isTest) setTimeout(() => toast('拖动看全城，走入街巷后可推门参观', 3800), 1800);
  } catch (error) {
    console.error(error);
    $('#loading-detail').textContent = `场景加载失败：${error.message}。刷新页面可重试。`;
  }
}
init();
