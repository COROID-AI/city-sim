import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BloomPass } from 'three/examples/jsm/postprocessing/BloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { AssetCatalog, Era } from './asset-catalog';
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
let currentEra: Era = Era.Era2005;

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

// 1985 era: heavy neon bloom, synth-wave aesthetic, high contrast
// 1980s neon aesthetic: heavy glow, magenta/cyan contrast, high bloom strength
const bloomPass1985 = new BloomPass({
  strength: 1.2,      // heavy neon bloom for synth-wave aesthetic
  threshold: 0.3,     // low threshold for maximum bloom
  radius: 0.8,        // large radius for wide neon glow
  kernelSize: BloomPass.KernelSize.Fourteen,
});
composer.addPass(bloomPass1985);

// 1965 era: mid-century modern with subtle neon accents, warm amber tint
// Subtle bloom for gentle neon glow, warm color grading
const bloomPass1965 = new BloomPass({
  strength: 0.3,      // subtle bloom for gentle neon glow
  threshold: 0.7,     // higher threshold for selective bloom
  radius: 0.4,        // moderate radius
  kernelSize: BloomPass.KernelSize.Fourteen,
});
composer.addPass(bloomPass1965);

// 1945 era: vintage film bloom, warm sepia tone + light film grain
// Light bloom for warm glow, sepia color grading for film aesthetic
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
  bias: { value: 0.05 },  // warm amber offset
  gain: { value: 1.05 },   // slight power boost for warmth
  offset: { value: 0.0 },
  power: { value: 1.05 },
};

const colorPass1965 = new ShaderPass({
  uniforms: { ...colorCorrectionUniforms1965 },
  vertexShader: /* glsl */ `\n    varying vec2 vUv;\n    void main() {\n      vUv = uv;\n      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n    }\n  `,
  fragmentShader: /* glsl */ `\n    uniform sampler2D tDiffuse;\n    uniform float exposure;\n    uniform float bias;\n    uniform float gain;\n    uniform float offset;\n    uniform float power;\n    varying vec2 vUv;\n    void main() {\n      vec4 color = texture2D(tDiffuse, vUv);\n      // 1965 mid-century modern color grading\n      // Warm amber tint with subtle desaturation\n      color.rgb = mix(\n        vec3(0.8, 0.7, 0.6),  // warm neutral base\n        color.rgb,\n        0.3\n      );
      // Enhance warm channels\n      color.r = color.r * 1.1 + 0.02;
      color.g = color.g * 1.05;
      color.b = color.b * 0.95;
      // Final output\n      gl_FragColor = color;
    }\n  `,
});

// 1945 color grading: warm sepia tone, film aesthetic
const colorCorrectionUniforms1945 = {
  tDiffuse: { value: null },
  exposure: { value: 1.0 },
  bias: { value: 0.0 },
  gain: { value: 1.0 },
  offset: { value: 0.15 },  // sepia offset for warm tone
  power: { value: 1.05 },   // slight power boost for warmth
};

const colorPass1945 = new ShaderPass({
  uniforms: { ...colorCorrectionUniforms1945 },
  vertexShader: /* glsl */ `\n    varying vec2 vUv;\n    void main() {\n      vUv = uv;\n      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n    }\n  `,
  fragmentShader: /* glsl */ `\n    uniform sampler2D tDiffuse;\n    uniform float exposure;\n    uniform float bias;\n    uniform float gain;\n    uniform float offset;\n    uniform float power;\n    varying vec2 vUv;\n    void main() {\n      vec4 color = texture2D(tDiffuse, vUv);\n      // 1945 sepia color grading\n      // Warm sepia tone: enhance red and green channels, reduce blue\n      float sepia = dot(color.rgb, vec3(0.393, 0.769, 0.189));\n      color.rgb = vec3(sepia);
      // Final output\n      gl_FragColor = color;
    }\n  `,
});

// --- Audio: 2000s pop/ambient sounds ---

// --- Renderer ---