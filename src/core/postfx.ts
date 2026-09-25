/**
 * Post-processing stack.
 *
 * RenderPass → UnrealBloomPass (emissive neon / LED signage) → custom grade
 * pass (lift, saturation, temperature, gamma, film grain, vignette) → OutputPass
 * (tone mapping + colour-space conversion). The grade uniforms are driven by the
 * transition controller, so the whole frame visibly re-grades during an era
 * change: warm and grainy for 1945, clean and cool for 2025.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { GradeSpec } from '../config/types';
import type { QualityTier } from '../state/store';

/** Grade + grain + vignette shader. */
const GradeShader = {
  name: 'ChronoCityGrade',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uLift: { value: 0.03 },
    uSaturation: { value: 1 },
    uGamma: { value: 1 },
    uTemperature: { value: 0 },
    uGrain: { value: 0.25 },
    uVignette: { value: 0.4 },
    uTime: { value: 0 },
    uFlash: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uLift;
    uniform float uSaturation;
    uniform float uGamma;
    uniform float uTemperature;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uTime;
    uniform float uFlash;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec3 color = texel.rgb;

      // White balance: positive = warmer (amber), negative = cooler (cyan).
      color.r += uTemperature * 0.075;
      color.b -= uTemperature * 0.075;
      color.g += uTemperature * 0.012;

      // Black lift (faded, low-contrast archival look).
      color = color * (1.0 - uLift) + uLift;

      // Saturation around the Rec.709 luma axis.
      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);

      // Display gamma.
      color = pow(max(color, vec3(0.0)), vec3(1.0 / max(uGamma, 0.05)));

      // Vignette.
      vec2 centred = vUv - 0.5;
      float radius = length(centred) * 1.45;
      color *= 1.0 - uVignette * smoothstep(0.35, 0.95, radius);

      // Animated film grain (finer and weaker for the modern eras).
      float grain = hash(vUv * 850.0 + fract(uTime * 0.7) * 37.0) - 0.5;
      color += grain * uGrain * 0.16;

      // Transition flash: a brief warm bloom-out while an era change resolves.
      color += uFlash * vec3(0.12, 0.1, 0.07);

      gl_FragColor = vec4(color, texel.a);
    }
  `,
};

interface GradeUniforms {
  uLift: { value: number };
  uSaturation: { value: number };
  uGamma: { value: number };
  uTemperature: { value: number };
  uGrain: { value: number };
  uVignette: { value: number };
  uTime: { value: number };
  uFlash: { value: number };
}

export interface PostFX {
  composer: EffectComposer;
  renderPass: RenderPass;
  bloomPass: UnrealBloomPass;
  gradePass: ShaderPass;
  outputPass: OutputPass;
  setSize(width: number, height: number, pixelRatio: number): void;
  setGrade(grade: GradeSpec): void;
  setFlash(amount: number): void;
  setQuality(tier: QualityTier): void;
  update(dt: number): void;
  render(dt: number): void;
  dispose(): void;
}

export function createPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  size: { width: number; height: number; pixelRatio: number },
): PostFX {
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(size.pixelRatio);
  composer.setSize(size.width, size.height);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new UnrealBloomPass(new THREE.Vector2(size.width, size.height), 0.75, 0.75, 0.72);
  composer.addPass(bloomPass);

  const gradePass = new ShaderPass(GradeShader);
  gradePass.renderToScreen = false;
  composer.addPass(gradePass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const uniforms = gradePass.uniforms as unknown as GradeUniforms;
  let elapsed = 0;
  let quality: QualityTier = 'high';

  return {
    composer,
    renderPass,
    bloomPass,
    gradePass,
    outputPass,
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
    },
    setGrade(grade) {
      uniforms.uLift.value = grade.lift;
      uniforms.uSaturation.value = grade.saturation;
      uniforms.uGamma.value = grade.gamma;
      uniforms.uTemperature.value = grade.temperature;
      uniforms.uGrain.value = grade.grain;
      uniforms.uVignette.value = grade.vignette;
      bloomPass.strength = grade.bloom * (quality === 'low' ? 0.5 : 1);
    },
    setFlash(amount) {
      uniforms.uFlash.value = Math.max(0, Math.min(1, amount));
    },
    setQuality(tier) {
      quality = tier;
      bloomPass.enabled = tier !== 'low';
      if (tier === 'low') {
        bloomPass.strength *= 0.5;
        gradePass.enabled = true;
      }
    },
    update(dt) {
      elapsed += dt;
      uniforms.uTime.value = elapsed;
    },
    render(dt) {
      composer.render(dt);
    },
    dispose() {
      composer.dispose();
      gradePass.material.dispose();
      bloomPass.dispose();
    },
  };
}
