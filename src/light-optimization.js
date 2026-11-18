import { ShaderChunk } from 'three';

const optimizedMaterials = new WeakSet();
const lightChunkInclude = '#include <lights_fragment_begin>';
const cacheSuffix = '|zero-point-light-direct-v1';

function pointLightChunk(source) {
  if (typeof source !== 'string') return null;
  const start = source.indexOf('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )');
  const end = source.indexOf('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )', start);
  if (start < 0 || end <= start) return null;

  const section = source.slice(start, end);
  const directCall = /(^[\t ]*)RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);/gm;
  // Assert the expected Three.js structure before touching the shader. A future
  // chunk revision keeps its original lighting instead of breaking the page.
  if ([...section.matchAll(directCall)].length !== 1 || !section.includes('getPointLightInfo( pointLight, geometryPosition, directLight );')) return null;
  const patched = section.replace(directCall,
    '$1if ( directLight.visible ) {\n$1\tRE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );\n$1}');
  return source.slice(0, start) + patched + source.slice(end);
}

const optimizedLightChunk = pointLightChunk(ShaderChunk.lights_fragment_begin);

/** Add a zero-contribution point-light fast path once, retaining material hooks. */
export function optimizePointLightMaterial(material) {
  if (!material || !(material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) || !optimizedLightChunk || optimizedMaterials.has(material)) return false;
  const originalCompile = material.onBeforeCompile;
  // The default key reads onBeforeCompile.toString(). Capture it before wrapping
  // the hook so custom keys, including the water ripple, remain stable.
  const originalKey = material.customProgramCacheKey.call(material);
  material.onBeforeCompile = function (shader, renderer) {
    originalCompile.call(this, shader, renderer);
    if (typeof shader.fragmentShader !== 'string' || !shader.fragmentShader.includes(lightChunkInclude)) return;
    shader.fragmentShader = shader.fragmentShader.replace(lightChunkInclude, optimizedLightChunk);
  };
  material.customProgramCacheKey = () => `${originalKey}${cacheSuffix}`;
  material.needsUpdate = true;
  optimizedMaterials.add(material);
  return true;
}

/** Optimize unique eligible scene materials; return the number newly wrapped. */
export function optimizeScenePointLights(scene) {
  let count = 0;
  scene?.traverse?.(object => {
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (optimizePointLightMaterial(material)) count++;
    }
  });
  return count;
}
