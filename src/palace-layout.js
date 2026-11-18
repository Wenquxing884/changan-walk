import layout from '../public/assets/palace-layout.json' with { type: 'json' };

// Single shared contract for the Blender generator, scene collisions, ground
// heights and camera destinations. All world positions are metres, +Y is up.
export const PALACE_LAYOUT = Object.freeze(layout);
export const PALACE_WORLD = Object.freeze([...layout.worldPosition]);
export const PALACE_FLOOR = layout.floorHeight;
export const PALACE_CAMERAS = Object.freeze(layout.camera);

export function getPalaceHeight(x, z) {
  const localX = x - PALACE_WORLD[0], localZ = z - PALACE_WORLD[2];
  for (const flight of layout.stairFlights) {
    if (Math.abs(localX) <= flight.width / 2 && z <= flight.startZ && z >= flight.endZ) {
      if (Math.abs(localX) > layout.ceremonialRampWidth / 2) {
        const step = Math.min(flight.steps - 1, Math.floor((flight.startZ - z) / (flight.startZ - flight.endZ) * flight.steps));
        return flight.startHeight + (flight.endHeight - flight.startHeight) * (step + 1) / flight.steps;
      }
      const t = (flight.startZ - z) / (flight.startZ - flight.endZ);
      return flight.startHeight + (flight.endHeight - flight.startHeight) * t;
    }
  }
  for (const landing of layout.landings) {
    if (Math.abs(localX) <= landing.width / 2 && z <= landing.startZ && z >= landing.endZ) return landing.height;
  }
  for (let i = layout.terraces.length - 1; i >= 0; i--) {
    const tier = layout.terraces[i];
    if (Math.abs(localX) <= tier.width / 2 && localZ >= tier.minZ && localZ <= tier.maxZ) return tier.height;
  }
  return null;
}

export function isPalaceInterior(x, z) {
  const lx = x - PALACE_WORLD[0], lz = z - PALACE_WORLD[2];
  return Math.abs(lx) < layout.interior.halfWidth && lz > layout.interior.minZ && lz < layout.interior.maxZ;
}
