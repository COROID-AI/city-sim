/**
 * src/main.js — application entrypoint.
 *
 * Boots the WebGL renderer, camera, scene lights and OrbitControls (vendored
 * ES module build from public/js/three), builds the permanent café shell, and
 * wires the fixed timeline slider → era registry → scene group swap.
 *
 * Runtime verification: asserts THREE.REVISION === '160' in the console so the
 * vendored r160 module build is proven good.
 */
import * as THREE from 'three';
import { OrbitControls } from '../public/js/three/examples/jsm/controls/OrbitControls.js';
import { buildShell } from './world/shell.js';
import { ERA_YEARS, registerEra, switchTo, getActiveEra, getActiveYear } from './eras/registry.js';
import { registerAllPlaceholderEras } from './eras/placeholder.js';
import { setAudioMuted, setAudioVolume, isAudioMuted, getAudioVolume } from './world/animation/audio.js';
import { audioEngine } from './audio/engine.js';
import { applyRenderPipeline, reportPerformanceBudget } from './world/render.js';
import { setupUI, updateUI, rebuildPresets, showWebGLFallback, applyReducedMotion } from './ui.js';

// ---------------------------------------------------------------------------
// r160 bundle verification
// ---------------------------------------------------------------------------
console.assert(
  typeof THREE.REVISION === 'string' && THREE.REVISION === '160',
  `[cafe] expected THREE.REVISION === '160', got`,
  THREE.REVISION
);
if (typeof THREE.REVISION !== 'string' || THREE.REVISION !== '160') {
  throw new Error(`[cafe] invalid three.js revision "${THREE.REVISION}"; expected r160 module build`);
}
console.info(
  `%c[three] r${THREE.REVISION} verified — ES module build public/js/three/build/three.module.js`,
  'color:#7fb069;font-weight:bold'
);

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------
const app = document.getElementById('app');
const slider = document.getElementById('timeline-slider');
const yearButtons = Array.from(document.querySelectorAll('#timeline-years .year-btn'));
const chipYear = document.querySelector('#era-chip .year');
const versionEl = document.getElementById('version');
const audioMute = document.getElementById('audio-mute');
const audioVolume = document.getElementById('audio-volume');

// ---------------------------------------------------------------------------
// Renderer / scene / camera / controls / lights
// ---------------------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true });
} catch (err) {
  console.warn('[cafe] WebGL renderer could not be created:', err);
  showWebGLFallback();
  throw err;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

// Apply the single cross-era ACESFilmic tonemapping + exposure policy and the
// shared shadow-map configuration (tuned once for all five eras).
applyRenderPipeline(renderer);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d141b);

// Base lights — the shell rig adds warm pendant + key lights inside the room.
scene.add(new THREE.AmbientLight(0xffffff, 0.35));
const hemisphere = new THREE.HemisphereLight(0xfff2dd, 0x3a2f24, 0.55);
scene.add(hemisphere);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.05,
  60
);
camera.position.set(3.1, 1.9, 3.7);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.05, -0.3);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 0.7;
controls.maxDistance = 12;
controls.maxPolarAngle = Math.PI * 0.49; // keep the view above the floor plane
controls.minPolarAngle = Math.PI * 0.05;
controls.update();

// ---------------------------------------------------------------------------
// World shell + era registry wiring
// ---------------------------------------------------------------------------
const shellMeta = buildShell(scene);
audioEngine.attach({ scene, camera });
const unlockAudio = () => audioEngine.resume();
document.addEventListener('pointerdown', unlockAudio, { once: true, passive: true });
document.addEventListener('keydown', unlockAudio, { once: true });
// NOTE: mute/volume are wired once below (muteBtn/volumeSlider) so the two
// handlers never fight over the same engine state.

const ctx = {
  THREE,
  scene,
  renderer,
  camera,
  controls,
  clock: new THREE.Clock(),
  shell: shellMeta.group,
  shellMeta,
};

for (const era of registerAllPlaceholderEras()) {
  registerEra(era.id, era);
}

// ---------------------------------------------------------------------------
// UI wiring — fixed top timeline slider (exactly 1945/1965/1985/2005/2025)
// ---------------------------------------------------------------------------
const statusEl = document.getElementById('era-status');

// --- Audio controls (mute + volume) ---------------------------------------
const muteBtn = document.getElementById('audio-mute');
const volumeSlider = document.getElementById('audio-volume');

setAudioMuted(isAudioMuted());
if (muteBtn) muteBtn.setAttribute('aria-pressed', isAudioMuted() ? 'true' : 'false');
if (volumeSlider) volumeSlider.value = String(getAudioVolume());

muteBtn?.addEventListener('click', () => {
  const muted = setAudioMuted(!isAudioMuted());
  muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  muteBtn.textContent = muted ? '🔇' : '🔊';
});
volumeSlider?.addEventListener('input', () => {
  setAudioVolume(Number(volumeSlider.value));
});

function applyYear(year) {
  if (!ERA_YEARS.includes(year)) return;
  switchTo(year, ctx);
  // The timelapse controller already drove the era audio via the adapter
  // (transitionTo → audio.setEra). Only drive it here at boot / when the
  // engine has not yet seen this year, so the crossfade is never restarted.
  if (audioEngine.currentEra !== year) audioEngine.switchEra(year);
  const idx = ERA_YEARS.indexOf(year);
  slider.value = String(idx);
  slider.setAttribute('aria-valuetext', String(year));
  for (const btn of yearButtons) {
    const active = Number(btn.dataset.year) === year;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  chipYear.textContent = String(year);
  const era = getActiveEra();
  if (statusEl && era) {
    statusEl.textContent = era.hudText || era.label || String(year);
  }
  document.title = `Café — ${year}`;
  rebuildPresets(ctx);
  console.info(`[cafe] era switched to ${year} (${getActiveYear()})`);
}

slider.addEventListener('input', () => {
  applyYear(ERA_YEARS[Number(slider.value)]);
});
yearButtons.forEach((btn) => {
  btn.addEventListener('click', () => applyYear(Number(btn.dataset.year)));
});

// ---------------------------------------------------------------------------
// Frame loop + camera constraints (stay inside / above the room interior)
// ---------------------------------------------------------------------------
const LIMITS = {
  x: 3.35,
  yMin: 0.12,
  yMax: 3.3,
  z: 2.3,
  targetX: 2.7,
  targetYMin: 0.4,
  targetYMax: 2.1,
  targetZ: 1.9,
};

function constrainView() {
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -LIMITS.x, LIMITS.x);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, LIMITS.yMin, LIMITS.yMax);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -LIMITS.z, LIMITS.z);
  controls.target.x = THREE.MathUtils.clamp(controls.target.x, -LIMITS.targetX, LIMITS.targetX);
  controls.target.y = THREE.MathUtils.clamp(controls.target.y, LIMITS.targetYMin, LIMITS.targetYMax);
  controls.target.z = THREE.MathUtils.clamp(controls.target.z, -LIMITS.targetZ, LIMITS.targetZ);
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  if (frame._last !== undefined) {
    if (!frame._fpsSamples) frame._fpsSamples = [];
    frame._fpsSamples.push(1000 / Math.max(0.1, now - frame._last));
  }
  frame._last = now;
  const delta = Math.min(0.1, (now - (frame._prevNow || now)) / 1000);
  frame._prevNow = now;
  controls.update();
  constrainView();
  updateUI(ctx, delta);
  audioEngine.update();
  renderer.render(scene, camera);

  // Per-era performance budget — sample renderer.info + measured fps and warn
  // when a budget line is exceeded (~150 draw calls, ~500k triangles, 45fps
  // floor). This drives the QA render audit without changing era art direction.
  if (frame._budgetTick === undefined) frame._budgetTick = 0;
  frame._budgetTick = (frame._budgetTick + 1) % 60;
  if (frame._budgetTick === 0) {
    const fps = frame._fpsSamples && frame._fpsSamples.length
      ? frame._fpsSamples.reduce((a, b) => a + b, 0) / frame._fpsSamples.length
      : 0;
    const era = getActiveYear() || '?';
    reportPerformanceBudget(renderer, era, fps);
    frame._fpsSamples = [];
  }
}
frame();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// Boot-time HUD
// ---------------------------------------------------------------------------
versionEl.textContent = `three.js r${THREE.REVISION} · ES module build`;
applyReducedMotion();
setupUI(ctx);
applyYear(2025);