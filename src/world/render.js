/**
 * src/world/render.js
 * Cross-era render-quality policy — the single source of truth for the parts
 * of the render pipeline that must be tuned ONCE for all five eras.
 *
 * Owned by the render-quality audit task. It deliberately avoids
 * src/world/animation/ (owned concurrently) and src/audio/.
 *
 * Responsibilities:
 *   1. Tonemapping + exposure — one ACESFilmic policy so no era looks washed
 *      out or crushed.
 *   2. Shadow map — map size + camera bounds tuned once to eliminate shadow
 *      acne (undersized map / over-tight frustum) and peter-panning (shadow
 *      detaching from its caster).
 *   3. Z-fighting standoff — a standard wall-hang offset so coplanar
 *      posters / menus / decals / floor dressings never fight.
 *   4. Performance budget — renderer.info sampling + per-era budget report
 *      (~150 draw calls, ~500k triangles, 60fps target / 45fps floor).
 */
import * as THREE from '../../public/js/three/build/three.module.js';

export const RENDER_POLICY = Object.freeze({
  // --- ACESFilmic tonemapping + exposure (one policy for all eras) --------
  toneMapping: 'ACESFilmic',
  exposure: 1.0,
  whitePoint: 4.0,
  outputColorSpace: 'SRGB',

  // --- Shared shadow map (tuned once) --------------------------------------
  // 2048² is a compact map that still resolves the ~5 m room; the camera
  // frustum frames the whole interior so shadows neither clip into acne nor
  // detach (peter-panning).
  shadowMap: {
    mapSize: [2048, 2048],
    camera: { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 20 },
  },

  // --- Performance budget ---------------------------------------------------
  budget: {
    drawCalls: 150,
    triangles: 500000,
    fpsTarget: 60,
    fpsFloor: 45,
  },

  // --- Z-fighting standoff --------------------------------------------------
  // Distance a wall-hung surface sits off its wall face (m). 0.04 keeps
  // coplanar faces clear without a visible hover gap.
  wallStandoff: 0.04,
});

/**
 * Apply the shared ACESFilmic tonemapping + exposure policy to the WebGL
 * renderer. Call once at boot before the first frame.
 */
export function applyRenderPipeline(renderer) {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = RENDER_POLICY.exposure;
  renderer.toneMappingWhitePoint = RENDER_POLICY.whitePoint;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
}

/**
 * Apply the shared shadow-map policy to a shadow-casting light
 * (DirectionalLight / SpotLight expose a `shadow` ShadowMap).
 */
export function applyShadowPolicy(light) {
  const map = light.shadow;
  if (!map) return light;
  const [w, h] = RENDER_POLICY.shadowMap.mapSize;
  map.mapSize.set(w, h);
  const c = RENDER_POLICY.shadowMap.camera;
  map.camera.left = c.left;
  map.camera.right = c.right;
  map.camera.top = c.top;
  map.camera.bottom = c.bottom;
  map.camera.near = c.near;
  map.camera.far = c.far;
  return light;
}

/**
 * Sample the renderer's last-frame statistics via renderer.info
 * (updated by three.js each render). Returns plain numbers so callers can
 * log or compare them without touching renderer internals.
 */
export function sampleRendererStats(renderer) {
  const info = renderer.info;
  return {
    drawCalls: info?.drawCalls ?? 0,
    triangles: info?.triangles ?? 0,
    renderTimeMs: info?.renderTime ?? 0,
  };
}

/**
 * Return the world-space position for a wall-hunged surface so it sits off
 * the fixed wall face by the standard standoff. `wall` is one of
 * 'back' | 'front' | 'left' | 'right' (the fixed shell wall faces).
 */
export function wallStandoffPosition(wall, x, y, z) {
  const s = RENDER_POLICY.wallStandoff;
  if (wall === 'back') return new THREE.Vector3(x, y, -2.5 + s);
  if (wall === 'front') return new THREE.Vector3(x, y, 2.5 - s);
  if (wall === 'left') return new THREE.Vector3(-3.5 + s, y, z);
  if (wall === 'right') return new THREE.Vector3(3.5 - s, y, z);
  return new THREE.Vector3(x, y, z);
}

/**
 * Log a per-era performance budget report from renderer.info + a measured
 * fps. Returns the sampled stats and which budget lines were exceeded so the
 * frame loop can warn on violations.
 */
export function reportPerformanceBudget(renderer, era, fps) {
  const stats = sampleRendererStats(renderer);
  const b = RENDER_POLICY.budget;
  const overDraw = stats.drawCalls > b.drawCalls;
  const overTri = stats.triangles > b.triangles;
  const underFps = fps < b.fpsFloor;
  console.log(
    `[render] era ${era} | draw ${stats.drawCalls}/${b.drawCalls} | ` +
      `tri ${Math.round(stats.triangles / 1000)}k/${Math.round(b.triangles / 1000)}k | ` +
      `fps ${fps.toFixed(1)}/${b.fpsTarget} | ` +
      `${overDraw ? 'OVER-DRAW' : 'draw-ok'} ${overTri ? 'OVER-TRI' : 'tri-ok'} ${underFps ? 'UNDER-FPS' : 'fps-ok'}`
  );
  return { stats, overDraw, overTri, underFps };
}