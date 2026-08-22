import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer, FilmPass, RenderPass, UnrealBloomPass } from 'three/examples/jsm/postprocessing/EffectComposer.js';

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

// --- Scene ---
const scene = new THREE.Scene();
scene.fog = null; // Fog disabled for clean era transitions

// --- Perspective Camera ---
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

// --- Ambient Light ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

// --- Post-Composer & Era Post-Processing ---
const composer = new THREE.EffectComposer(renderer);
composer.addPass(new THREE.RenderPass(scene, camera));

// Add bloom pass for heavy neon effect (will be configured per-era in scripts.js)
// We set up a default bloom with moderate settings; applyEraPostProcessing in scripts.js will adjust
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.5,    // strength (will be overridden per-era)
  0.4,    // radius
  0.85    // threshold
);
composer.addPass(bloomPass);

// --- Animation Loop ---
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  composer.render();
}

animate();