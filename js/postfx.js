/* Post-processing: bright-pass → separable blur → composite.
 *
 * Addresses two handoff findings at once:
 *  - three.js version drift (examples/jsm import paths): NO example modules
 *    are imported anywhere in the game — every pass is a self-contained
 *    fullscreen-triangle ShaderMaterial built on js/glsl.js FS_VERT.
 *  - perf on weak GPUs: bloom is tier-gated (LOW skips bright/blur entirely),
 *    runs at half resolution, and iteration count comes from the tier.
 *
 * The composite pass ALWAYS runs (even on LOW, with bloom strength 0) so the
 * tonemap/gamma path is identical across tiers and materials stay authored in
 * linear light.
 */

import * as THREE from 'three';
import { FS_VERT } from './glsl.js';

function passMaterial(fragment) {
  return new THREE.ShaderMaterial({
    vertexShader: FS_VERT,
    fragmentShader: fragment,
    depthTest: false,
    depthWrite: false
  });
}

const BRIGHT_FRAG = /* glsl */`
uniform sampler2D uTex;
uniform float uThreshold;
uniform float uSoft;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(uThreshold - uSoft, uThreshold + uSoft, l);
  gl_FragColor = vec4(c * w, 1.0);
}
`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D uTex;
uniform vec2 uDir;       // texel-space direction * radius
varying vec2 vUv;
void main() {
  vec3 sum = texture2D(uTex, vUv).rgb * 0.227027;
  vec2 o1 = uDir * 1.3846153846;
  vec2 o2 = uDir * 3.2307692308;
  sum += texture2D(uTex, vUv + o1).rgb * 0.3162162162;
  sum += texture2D(uTex, vUv - o1).rgb * 0.3162162162;
  sum += texture2D(uTex, vUv + o2).rgb * 0.0702702703;
  sum += texture2D(uTex, vUv - o2).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}
`;

const COMPOSITE_FRAG = /* glsl */`
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uStrength;
varying vec2 vUv;
vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}
void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
  c += texture2D(uBloom, vUv).rgb * uStrength;
  c = aces(c * 1.12);
  c = pow(c, vec3(1.0 / 2.2));
  gl_FragColor = vec4(c, 1.0);
}
`;

function fsTriangle() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    -1, -1, 0, 3, -1, 0, -1, 3, 0
  ]), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([
    0, 0, 2, 0, 0, 2
  ]), 2));
  return geo;
}

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(fsTriangle());
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    this.brightMat = passMaterial(BRIGHT_FRAG);
    this.blurMat = passMaterial(BLUR_FRAG);
    this.compositeMat = passMaterial(COMPOSITE_FRAG);

    this.brightMat.uniforms.uThreshold = { value: 0.72 };
    this.brightMat.uniforms.uSoft = { value: 0.5 };

    this.tier = null;
    this.rtScene = null;
    this.rtA = null;
    this.rtB = null;
    this.w = 2; this.h = 2;

    this.floatOK = !!renderer.extensions.get('EXT_color_buffer_float');
  }

  configure(tier) {
    this.tier = tier;
    this.compositeMat.uniforms.uStrength = { value: tier.bloomStrength };
    this.setSize(this.w, this.h, true);
  }

  _makeRT(w, h, samples) {
    return new THREE.WebGLRenderTarget(Math.max(2, w), Math.max(2, h), {
      type: this.floatOK ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: samples | 0,
      depthBuffer: true,
      stencilBuffer: false
    });
  }

  setSize(w, h, force = false) {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (!force && w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    const tier = this.tier;
    const samples = tier ? (tier.samples || 0) : 0;

    this.rtScene?.dispose();
    this.rtA?.dispose();
    this.rtB?.dispose();

    this.rtScene = this._makeRT(w, h, samples);
    const bw = Math.max(2, w >> 1), bh = Math.max(2, h >> 1);
    this.rtA = this._makeRT(bw, bh, 0);
    this.rtB = this._makeRT(bw, bh, 0);

    this.compositeMat.uniforms.uScene = { value: this.rtScene.texture };
    this.compositeMat.uniforms.uBloom = { value: this.rtA.texture };
  }

  render(scene, camera, time) {
    void time;
    const r = this.renderer;
    r.setRenderTarget(this.rtScene);
    r.clear();
    r.render(scene, camera);

    const bloomOn = this.tier && this.tier.bloom;
    if (bloomOn) {
      this.quad.material = this.brightMat;
      this.brightMat.uniforms.uTex = { value: this.rtScene.texture };
      r.setRenderTarget(this.rtA);
      r.render(this.scene, this.camera);

      const iters = this.tier.bloomIters || 1;
      const bw = this.rtA.width, bh = this.rtA.height;
      for (let i = 0; i < iters; i++) {
        const radius = 1 + i * 1.6;
        this.quad.material = this.blurMat;
        this.blurMat.uniforms.uTex = { value: this.rtA.texture };
        this.blurMat.uniforms.uDir = { value: new THREE.Vector2(radius / bw, 0) };
        r.setRenderTarget(this.rtB);
        r.render(this.scene, this.camera);
        this.blurMat.uniforms.uTex = { value: this.rtB.texture };
        this.blurMat.uniforms.uDir = { value: new THREE.Vector2(0, radius / bh) };
        r.setRenderTarget(this.rtA);
        r.render(this.scene, this.camera);
      }
    } else {
      // keep rtA black so the composite adds nothing
      r.setRenderTarget(this.rtA);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.setClearColor(0x04060d, 1);
    }

    this.quad.material = this.compositeMat;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }
}
