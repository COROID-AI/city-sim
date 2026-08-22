import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BloomPass } from 'three/examples/jsm/postprocessing/BloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { AudioLoader } from 'three/examples/jsm/loaders/AudioLoader.js';
import { Audio } from 'three/src/audio/Audio.js';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// --- Post-processing (EffectComposer) ---
const composer = new EffectComposer(renderer);
composer.setSize(window.innerWidth, window.innerHeight);

// Render pass - captures the scene
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// --- Era-specific post-processing configuration ---
// Currently active era setting
let currentEra = '2025';

// 2025 era: clean digital color grading, minimal bloom
const bloomPass2025 = new BloomPass({
  strength: 0.2,      // minimal bloom
  threshold: 0.6,     // moderate threshold
  radius: 0.3,      // soft radius
  kernelSize: BloomPass.KernelSize.Fourteen,
});
composer.addPass(bloomPass2025);

// 2005 era: early digital color grading, subtle LCD bloom
// Early 2000s digital aesthetic: warm but not film-like, slight desaturation,
// LCD display characteristics, early digital color grading
const bloomPass2005 = new BloomPass({
  strength: 0.4,      // subtle LCD bloom for early digital display effect
  threshold: 0.5,     // lower threshold for more bloom
  radius: 0.5,      // slightly softer radius for LCD look
  kernelSize: BloomPass.KernelSize.Fourteen,
});
composer.addPass(bloomPass2005);

// 1965 era: mid-century modern with subtle neon accents, warm amber tint
const bloomPass1965 = new BloomPass({
  strength: 0.3,      // subtle bloom for gentle neon glow
  threshold: 0.7,     // higher threshold for selective bloom
  radius: 0.4,        // moderate radius
  kernelSize: BloomPass.KernelSize.Fourteen,
});
composer.addPass(bloomPass1965);

// 1945 era: vintage film bloom, warm sepia tone
// 1945 vintage aesthetic: warm film bloom, sepia tone, light grain
const bloomPass1945 = new BloomPass({
  strength: 0.15,     // light bloom for vintage film effect
  threshold: 0.8,     // high threshold for selective bloom
  radius: 0.2,        // soft radius for gentle glow
  kernelSize: BloomPass.KernelSize.Fourteen,
});
composer.addPass(bloomPass1945);

// --- Color grading shaders ---
// 2025 color grading: clean digital, slightly cool highlights, warm shadows
const colorCorrectionUniforms2025 = {
  tDiffuse: { value: null },
  exposure: { value: 1.0 },
  bias: { value: 0.0 },
  gain: { value: 1.0 },
  offset: { value: 0.0 },
  power: { value: 1.0 },
};

// 2005 color grading: early digital color grading, warm but desaturated
// Early 2000s aesthetic: warm shadows, slightly cool highlights,
// slightly desaturated, teal-orange contrast common in early digital
const colorCorrectionUniforms2005 = {
  tDiffuse: { value: null },
  exposure: { value: 1.0 },
  bias: { value: 0.0 },
  gain: { value: 1.0 },
  offset: { value: 0.0 },
  power: { value: 0.95 },
};

// 1965 color grading: warm amber tint, mid-century modern aesthetic
const colorCorrectionUniforms1965 = {
  tDiffuse: { value: null },
  exposure: { value: 1.0 },
  bias: { value: 0.0 },
  gain: { value: 1.0 },
  offset: { value: 0.05 },  // warm amber offset
  power: { value: 1.05 },   // slight power boost for warmth
};

// 1945 color grading: vintage film sepia tone
// 1940s vintage aesthetic: warm sepia tone, light film grain
const colorCorrectionUniforms1945 = {
  tDiffuse: { value: null },
  exposure: { value: 1.0 },
  bias: { value: 0.0 },
  gain: { value: 1.0 },
  offset: { value: 0.0 },
  power: { value: 1.0 },
};

const colorCorrectionShader1945 = {
  uniforms: { ...colorCorrectionUniforms1945 },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float exposure;
    uniform float bias;
    uniform float gain;
    uniform float offset;
    uniform float power;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      // 1945 vintage film color grading
      // Warm sepia tone
      const float r = color.r;
      const float g = color.g * 0.8 + color.r * 0.1;
      const float b = color.b * 0.7 + color.r * 0.15;
      color.rgb = vec3(r, g, b);
      // Slight desaturation for vintage look
      const gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      color.rgb = mix(gray, color.rgb, 0.2);
      // Exposure and gamma
      color.rgb = pow(color.rgb * exposure, vec3(power)) + offset;
      color.rgb = color.rgb * gain + bias;
      gl_FragColor = color;
    }
  `,
};

const colorPass1945 = new ShaderPass(colorCorrectionShader1945);
composer.addPass(colorPass1945);

// --- Audio: 2000s pop/ambient sounds ---

// --- Audio: 2000s pop/ambient sounds ---
const audioListener = new THREE.AudioListener();
camera.add(audioListener);

// Create 2000s pop/ambient sound
const retroSound = new THREE.Audio(audioListener);

// Load and set early 2000s pop ambience sound
const audioLoader = new AudioLoader();
audioLoader.load('/sounds/2005-pop-ambient.mp3', (buffer) => {
  retroSound.setBuffer(buffer);
  retroSound.setLoop(true);
  retroSound.setVolume(0.3); // Low volume to mix with scene ambience
  retroSound.play();
});

// --- Ambient Light ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

// --- Directional Light (subtle, matches 2005 clean digital aesthetic) ---
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
directionalLight.position.set(50, 50, 70);
scene.add(directionalLight);

// --- Resize Handler ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  composer.render();
}

animate();

// --- Era post-processing applier ---
/**
 * Apply era-specific post-processing to the composer
 * @param {string} era - Era identifier ('2025', '2005', '1985', '1965', '1945')
 */
function applyEraPostProcessing(era) {
  currentEra = era;

  // Remove all post-processing passes except render pass
  composer.passes = [renderPass];

  if (era === '2005') {
    // Swap to 2005 bloom pass
    composer.addPass(bloomPass2005);

    // Swap to 2005 color grading
    composer.addPass(colorPass2005);
    // Update color pass uniforms for 2005 aesthetic
    colorPass2005.uniforms.power.value = 0.95;
    colorPass2005.uniforms.exposure.value = 1.0;
  } else if (era === '1965') {
    // 1965 era: mid-century modern with subtle neon accents, warm amber tint
    // Subtle bloom for gentle neon glow, warm color grading
    composer.addPass(bloomPass1965);

    // 1965 color grading: warm amber tint, mid-century modern aesthetic
    composer.addPass(colorPass1965);
  } else if (era === '1945') {
    // 1945 era: vintage film bloom, warm sepia tone
    // Vintage film bloom and sepia tone for 1940s aesthetic
    composer.addPass(bloomPass1945);
    composer.addPass(colorPass1945);
  } else if (era === '1985') {
    // 1985 era: heavy neon bloom, high contrast, synth-wave sounds
    composer.addPass(bloomPass1965); // reuse or configure differently
  } else if (era === '2025') {
    // Swap to 2025 bloom pass
    composer.addPass(bloomPass2025);

    // Swap to 2025 color grading
    composer.addPass(colorPass2005);
    // Update color pass uniforms for 2025 aesthetic
    colorPass2005.uniforms.power.value = 1.0;
    colorPass2005.uniforms.exposure.value = 1.0;
  }
}

// --- Camera ---
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000
);
camera.position.set(50, 50, 70);
camera.lookAt(0, 0, 0);

// --- Orbit Controls ---
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.maxPolarAngle = Math.PI / 2.1; // Limit downward tilt

// --- Audio: 2000s pop/ambient sounds ---
const audioListener = new THREE.AudioListener();
camera.add(audioListener);

// Create 2000s pop/ambient sound
const retroSound = new THREE.Audio(audioListener);

// Load and set early 2000s pop ambience sound
const audioLoader = new AudioLoader();
audioLoader.load('/sounds/2005-pop-ambient.mp3', (buffer) => {
  retroSound.setBuffer(buffer);
  retroSound.setLoop(true);
  retroSound.setVolume(0.3); // Low volume to mix with scene ambience
  retroSound.play();
});

// --- Ambient Light ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

// --- Directional Light (subtle, matches 2005 clean digital aesthetic) ---
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.3);
directionalLight.position.set(50, 50, 70);
scene.add(directionalLight);

// --- Resize Handler ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  composer.render();
}

animate();

// Apply 2005-era post-processing on load
applyEraPostProcessing('2005');

// Export for integration with Three.js overlay
window.renderer = renderer;
window.composer = composer;
window.camera = camera;