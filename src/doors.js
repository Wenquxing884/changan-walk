import * as THREE from 'three';

const OPEN_ANGLE = Math.PI * .49;
const HINGE_INSET = .10;

// A door is a real, two-leaf hinged object. Collision uses a separate closed
// doorway envelope, never a hidden static wall. All leaves share GPU batches.
export function createDoorSystem(root, colliders, materials) {
  const doors = [];
  const byId = new Map(), movingDoors = new Set();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4(), scale = new THREE.Vector3();
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), local = new THREE.Matrix4();
  const hinge = new THREE.Matrix4(), rotation = new THREE.Matrix4(), safetyPoint = new THREE.Vector3();
  let leafMesh, handleMesh, braceMesh, initialized = false;
  const box = new THREE.BoxGeometry(1, 1, 1);
  const handleGeometry = new THREE.TorusGeometry(.075, .018, 5, 12);

  function add({ id, label, buildingId = null, kind = 'building', matrix: transform = new THREE.Matrix4(), width = 2.8, height = 2.7, base = .38, open = false }) {
    const doorFrame = transform.clone();
    const position = new THREE.Vector3(0, base + Math.min(height * .5, 1.5), 0).applyMatrix4(doorFrame);
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(doorFrame);
    const closedCollider = new THREE.Box3(new THREE.Vector3(-width / 2, base, -.12), new THREE.Vector3(width / 2, base + height, .12)).applyMatrix4(doorFrame);
    const collider = closedCollider.clone();
    const door = { id, label, buildingId, kind, type: kind, position, normal, width, height, base, open, angle: open ? OPEN_ANGLE : 0,
      targetAngle: open ? OPEN_ANGLE : 0, swing: 1, collider, closedCollider, transform: doorFrame, inverse: doorFrame.clone().invert(), index: doors.length };
    if (open) collider.makeEmpty();
    colliders.push(collider); doors.push(door); byId.set(id, door); return door;
  }
  function finish() {
    const n = doors.length * 2;
    leafMesh = new THREE.InstancedMesh(box, materials.red, n);
    braceMesh = new THREE.InstancedMesh(box, materials.timber, n * 3);
    handleMesh = new THREE.InstancedMesh(handleGeometry, materials.gold, n);
    for (const mesh of [leafMesh, braceMesh, handleMesh]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.frustumCulled = false;
      mesh.castShadow = false; mesh.receiveShadow = true; root.add(mesh);
    }
    leafMesh.name = '双扇木门 · hinged leaves'; braceMesh.name = '门扉横枨'; handleMesh.name = '铜制门环';
    initialized = true;
    for (const door of doors) { drawDoor(door, true); movingDoors.add(door); }
    markUpdated();
    movingDoors.clear();
  }
  function drawDoor(door, force = false) {
    if (!initialized) return;
    for (let side = 0; side < 2; side++) {
      const sign = side ? 1 : -1, half = door.width / 2 - HINGE_INSET, index = door.index * 2 + side;
      const angle = sign * door.angle * door.swing;
      // A thick leaf (and its braces) needs clearance from the solid jamb.
      // Keep its pivot inside the opening and stop short of 90 degrees, rather
      // than sweeping the painted door into the adjacent wall/trim surface.
      hinge.makeTranslation(sign * half, door.base, 0);
      hinge.multiply(rotation.makeRotationY(angle));
      const set = (mesh, i, x, y, z, sx, sy, sz, rot = null) => {
        q.identity(); if (rot) q.setFromAxisAngle(yAxis, rot);
        local.compose(p.set(x, y, z), q, scale.set(sx, sy, sz));
        matrix.copy(door.transform).multiply(hinge).multiply(local); mesh.setMatrixAt(i, matrix);
      };
      set(leafMesh, index, -sign * half / 2, door.height / 2, 0, half - .045, door.height, .10);
      for (let j = 0; j < 3; j++) set(braceMesh, index * 3 + j, -sign * half / 2, door.height * (.18 + j * .31), .065, half - .12, .065, .035);
      // Door rings are visible from both sides because TorusGeometry is closed.
      set(handleMesh, index, -sign * (half - .18), door.height * .48, .095, 1, 1, 1);
      if (!force) {
        leafMesh.instanceMatrix.addUpdateRange(index * 16, 16);
        handleMesh.instanceMatrix.addUpdateRange(index * 16, 16);
        braceMesh.instanceMatrix.addUpdateRange(index * 3 * 16, 3 * 16);
      }
    }
  }
  function markUpdated() {
    leafMesh.instanceMatrix.needsUpdate = braceMesh.instanceMatrix.needsUpdate = handleMesh.instanceMatrix.needsUpdate = true;
  }
  function getNearbyDoor(player, direction = null) {
    if (!player) return null;
    let best = null, bestScore = Infinity;
    for (const door of doors) {
      const dx = player.x - door.position.x, dz = player.z - door.position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 3.5) continue;
      // Facing direction breaks a tie; looking away never makes a nearby door
      // impossible to operate on a touch screen or from inside the room.
      const facing = direction && distance > .01 ? -(dx * direction.x + dz * direction.z) / distance : 0;
      const score = distance - .12 * facing;
      if (score < bestScore) { best = door; bestScore = score; }
    }
    return best;
  }
  function safeToClose(door, player) {
    if (!player) return true;
    const point = safetyPoint.set(player.x, door.base, player.z).applyMatrix4(door.inverse);
    // Refuse to sweep the leaves through someone standing in either half of
    // the doorway. A player a little farther into the room may close it safely.
    return !(Math.abs(point.x) < door.width / 2 + .6 && Math.abs(point.z) < Math.min(1.45, door.width / 2 + .2));
  }
  function interactDoor(id, player = null) {
    const door = byId.get(id);
    if (!door) return { ok: false, reason: '未找到这扇门' };
    if (player && Math.hypot(player.x - door.position.x, player.z - door.position.z) > 4.5) return { ok: false, reason: '请走近门扉，再按 E 开门' };
    if (door.open && !safeToClose(door, player)) return { ok: false, reason: '请离开门的转动范围，再轻掩门扉' };
    if (!door.open && player) {
      const side = (player.x - door.position.x) * door.normal.x + (player.z - door.position.z) * door.normal.z;
      door.swing = side >= 0 ? -1 : 1;
    }
    door.open = !door.open; door.targetAngle = door.open ? OPEN_ANGLE : 0;
    movingDoors.add(door);
    return { ok: true, open: door.open, label: door.label, id: door.id };
  }
  function update(delta = .016, player = null) {
    if (initialized) {
      const nearView = !player || player.y < 23;
      braceMesh.visible = handleMesh.visible = nearView;
    }
    let changed = false;
    for (const door of movingDoors) {
      if (!door.open && door.angle > .02 && !safeToClose(door, player)) { door.open = true; door.targetAngle = OPEN_ANGLE; }
      const next = THREE.MathUtils.damp(door.angle, door.targetAngle, 9, Math.min(delta, .1));
      if (Math.abs(next - door.targetAngle) > .00025) door.angle = next;
      else { door.angle = door.targetAngle; movingDoors.delete(door); }
      drawDoor(door); changed = true;
      if (door.angle > Math.PI / 3) door.collider.makeEmpty();
      else door.collider.copy(door.closedCollider);
    }
    if (changed) markUpdated();
  }
  return { doors, add, finish, update, getNearbyDoor, interactDoor, dispose() {
    for (const mesh of [leafMesh, braceMesh, handleMesh]) if (mesh) root.remove(mesh);
    box.dispose(); handleGeometry.dispose();
  } };
}
