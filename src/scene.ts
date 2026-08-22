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

// --- Post-processing (EffectComposer) for clean digital color grading & minimal bloom ---
const composer = new EffectComposer(renderer);
composer.setSize(window.innerWidth, window.innerHeight);

// Render pass - captures the scene
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Bloom pass - minimal intensity for 2025 clean digital look
const bloomPass = new BloomPass({
  strength: 0.2,      // minimal bloom
  threshold: 0.6,     // moderate threshold
  radius: 0.3,      // soft radius
  kernelSize: BloomPass.KernelSize.Fourteen,
});
composer.addPass(bloomPass);

// --- Color grading for 2020s aesthetic ---
// 2025 color grading: clean digital, slightly cool highlights, warm shadows
const colorCorrectionUniforms = {
  tDiffuse: { value: null },
  exposure: { value: 1.0 },
  bias: { value: 0.0 },
  gain: { value: 1.0 },
  offset: { value: 0.0 },
  power: { value: 1.0 },
};

const colorCorrectionShader = {
  uniforms: colorCorrectionUniforms,
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
      
      // Clean digital color grading - 2020s aesthetic
      // Slightly cool highlights, warm shadows for cinematic look
      color.rgb = mix(
        vec3(color.r * 0.95, color.g * 0.98, color.b),  // cool highlight shift
        color.rgb,
        0.8
      );
      
      // Warm shadow lift
      color.rgb = mix(
        vec3(color.r * 0.9, color.g * 0.95, color.b * 1.05),
        color.rgb,
        0.3
      );
      
      // Exposure and gamma
      color.rgb = pow(color.rgb * exposure, vec3(power)) + offset;
      color.rgb = color.rgb * gain + bias;
      
      gl_FragColor = color;
    }
  `,
};

const colorPass = new ShaderPass(colorCorrectionShader);
composer.addPass(colorPass);

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

// --- Audio: Contemporary electronic sounds ---
const audioListener = new THREE.AudioListener();
camera.add(audioListener);

// Create a 2025-era electronic ambient sound
const electronicSound = new THREE.Audio(audioListener);

// Load and set contemporary electronic ambient sound
const audioLoader = new AudioLoader();
audioLoader.load('/sounds/2025-electronic-ambient.mp3', (buffer) => {
  electronicSound.setBuffer(buffer);
  electronicSound.setLoop(true);
  electronicSound.setVolume(0.5);
  electronicSound.play();
});

// --- Ambient Light ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

// --- Directional Light (subtle, matches 2025 clean digital aesthetic) ---
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