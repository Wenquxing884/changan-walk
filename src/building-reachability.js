// Deterministic, radius-aware flood fill of the walkable XZ plane. Doors are
// treated as openable connections; permanent walls and furniture remain solid.
// The same verifier is used at construction and by scripts/check-reachability.
export function auditBuildingReachability(colliders, doors, buildings, { resolution = .4, radius = .48 } = {}) {
  const minX = -205, maxX = 205, minZ = -222, maxZ = 173;
  const width = Math.ceil((maxX - minX) / resolution) + 1;
  const height = Math.ceil((maxZ - minZ) / resolution) + 1;
  const blocked = new Uint8Array(width * height), visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height), doorColliders = new Set(doors.map(d => d.collider));
  for (const box of colliders) {
    if (doorColliders.has(box) || box.isEmpty?.()) continue;
    const x0 = Math.max(0, Math.ceil((box.min.x - radius - minX) / resolution));
    const x1 = Math.min(width - 1, Math.floor((box.max.x + radius - minX) / resolution));
    const z0 = Math.max(0, Math.ceil((box.min.z - radius - minZ) / resolution));
    const z1 = Math.min(height - 1, Math.floor((box.max.z + radius - minZ) / resolution));
    for (let z = z0; z <= z1; z++) blocked.fill(1, z * width + x0, z * width + x1 + 1);
  }
  const gridKey = (x, z) => Math.round((z - minZ) / resolution) * width + Math.round((x - minX) / resolution);
  const start = gridKey(0, 100);
  let first = 0, end = 0;
  queue[end++] = start; visited[start] = 1;
  while (first < end) {
    const key = queue[first++], x = key % width, z = Math.floor(key / width);
    for (const next of [x ? key - 1 : -1, x < width - 1 ? key + 1 : -1, z ? key - width : -1, z < height - 1 ? key + width : -1]) {
      if (next >= 0 && !visited[next] && !blocked[next]) { visited[next] = 1; queue[end++] = next; }
    }
  }
  const results = buildings.map(building => {
    const p = building.entry?.clone?.().addScaledVector(building.normal, -1.4);
    if (!p) return { id: building.id, reachable: false, label: building.label };
    const reachable = Boolean(visited[gridKey(p.x, p.z)]);
    return { id: building.id, label: building.label, reachable, position: building.position, entry: p.toArray() };
  });
  return { reachable: results.filter(b => b.reachable).length, total: results.length, resolution, radius,
    visitedCells: end, results, unreachable: results.filter(b => !b.reachable) };
}
