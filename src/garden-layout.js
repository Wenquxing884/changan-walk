// Shared metre-scale contract for the pool, the bridge and the covered walk.
// The garden occupies the existing empty eastern ward, between existing roads.
export const GARDEN_LAYOUT = Object.freeze({
  center: [128, -116],
  bounds: { minX: 102.5, maxX: 153, minZ: -165, maxZ: -84 },
  waterHeight: .11,
  pond: { radiusX: 17, radiusZ: 23, segments: 64 },
  bridge: { x: 128, southZ: -88, northZ: -150, width: 6.2, baseHeight: .34, rise: 2.6, approach: 2.8 },
  gallery: { width: 4.6, floorHeight: .4, eaveHeight: 4.55, bayLength: 4.8,
    segments: [[105.5, -91, 105.5, -158], [105.5, -158, 147, -158], [147, -158, 147, -147.5]] },
  pavilions: [
    { id: 'north', name: '听荷亭', x: 128, z: -158, width: 12, depth: 10, floorHeight: .4, eaveHeight: 5.25 },
    { id: 'east', name: '涵碧水榭', x: 147, z: -143, width: 9, depth: 9, floorHeight: .4, eaveHeight: 4.8 },
  ],
  entryPath: { minX: 98, maxX: 128, minZ: -88.8, maxZ: -85.2 },
});

export const GARDEN_CAMERAS = Object.freeze({
  entry: { position: [117, 1.9, -85.5], target: [128, 4.2, -116], fov: 62 },
  bridge: { position: [128, 4.62, -116], target: [128, 4.4, -158], fov: 64 },
  gallery: { position: [105.5, 2.08, -117], target: [128, 3.4, -116], fov: 64 },
});

export function isGardenArea(x, z) {
  const b = GARDEN_LAYOUT.bounds;
  return x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ;
}

export function gardenPondPoint(t, expansion = 1) {
  const a = t * Math.PI * 2;
  const r = (1 + .1 * Math.sin(a * 3) + .045 * Math.cos(a * 5)) * expansion;
  return [GARDEN_LAYOUT.center[0] + Math.cos(a) * GARDEN_LAYOUT.pond.radiusX * r,
    GARDEN_LAYOUT.center[1] - Math.sin(a) * GARDEN_LAYOUT.pond.radiusZ * r];
}

export function getGardenBridgeHeight(z) {
  const b = GARDEN_LAYOUT.bridge;
  if (z >= b.southZ && z <= b.southZ + b.approach) return .08 + (b.baseHeight - .08) * (b.southZ + b.approach - z) / b.approach;
  if (z <= b.southZ && z >= b.northZ) {
    const t = (b.southZ - z) / (b.southZ - b.northZ);
    return b.baseHeight + b.rise * 4 * t * (1 - t);
  }
  // The northern abutment joins the raised floor of the lakeside pavilion.
  if (z < b.northZ && z >= -153) return b.baseHeight + (.4 - b.baseHeight) * (b.northZ - z) / 3;
  return null;
}

export function getGardenHeight(x, z) {
  const b = GARDEN_LAYOUT.bridge;
  if (Math.abs(x - b.x) <= b.width / 2) {
    const bridgeHeight = getGardenBridgeHeight(z);
    if (bridgeHeight !== null) return bridgeHeight;
  }
  for (const p of GARDEN_LAYOUT.pavilions) {
    if (Math.abs(x - p.x) <= p.width / 2 && Math.abs(z - p.z) <= p.depth / 2) return p.floorHeight;
  }
  const g = GARDEN_LAYOUT.gallery;
  // The outer elbow tiles close the full-width right-angle corners.
  if (Math.abs(z + 158) <= g.width / 2 && (Math.abs(x - 105.5) <= g.width / 2 || Math.abs(x - 147) <= g.width / 2)) return g.floorHeight;
  for (const [x0, z0, x1, z1] of g.segments) {
    if (x0 === x1 && Math.abs(x - x0) <= g.width / 2 && z >= Math.min(z0, z1) && z <= Math.max(z0, z1)) return g.floorHeight;
    if (z0 === z1 && Math.abs(z - z0) <= g.width / 2 && x >= Math.min(x0, x1) && x <= Math.max(x0, x1)) return g.floorHeight;
  }
  // A broad, low entry apron takes the floor gently down to the public path.
  if (x >= 103.2 && x <= 107.8 && z >= -91 && z <= -87) return .08 + (g.floorHeight - .08) * (-87 - z) / 4;
  return null;
}
