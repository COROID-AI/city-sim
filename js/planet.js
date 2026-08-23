/* The living planet: procedural surface painted once into the decal painter's
 * canvases, custom shader (day/night terminator, lava glow from the scar
 * texture, fresnel atmosphere), animated cloud layer, and the molten core
 * revealed by the destruction sequence. */

import * as THREE from 'three';
import { PLANET_RADIUS as R } from './config.js';
import { NOISE_GLSL } from './glsl.js';

const VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vUv = uv;
  vN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const PLANET_FRAG = /* glsl */`
uniform sampler2D dayMap;
uniform sampler2D lavaMap;
uniform vec3 sunDir;
uniform float time;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 viewDir = normalize(cameraPosition - vW);
  float ndl = dot(n, normalize(sunDir));
  float day = smoothstep(-0.14, 0.28, ndl);

  vec3 albedo = texture2D(dayMap, vUv).rgb;
  vec4 lava = texture2D(lavaMap, vUv);

  vec3 col = albedo * (0.07 + 1.02 * day);

  // warm scattering at the terminator
  float term = pow(max(1.0 - abs(ndl) * 2.4, 0.0), 3.0);
  col += vec3(0.85, 0.34, 0.10) * term * 0.16;

  // molten scars glow harder on the night side
  float flicker = 0.82 + 0.30 * sin(time * 2.7 + vUv.x * 47.0 + vUv.y * 31.0);
  col += lava.rgb * lava.a * flicker * (0.55 + 0.55 * (1.0 - day));

  // in-atmosphere fresnel rim
  float fres = pow(1.0 - max(dot(viewDir, n), 0.0), 2.6);
  col += vec3(0.24, 0.5, 1.0) * fres * (0.22 + 0.6 * day);

  gl_FragColor = vec4(col, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */`
uniform vec3 sunDir;
uniform float time;
${NOISE_GLSL}
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 p = normalize(vW);
  float n = ssFbm(p * 2.6 + vec3(time * 0.010, 0.0, time * 0.006));
  n += 0.45 * ssNoise(p * 7.0 - vec3(0.0, time * 0.014, 0.0));
  float a = smoothstep(0.62, 1.08, n);
  if (a < 0.01) discard;
  float light = clamp(dot(normalize(vN), normalize(sunDir)) * 0.9 + 0.28, 0.06, 1.0);
  gl_FragColor = vec4(vec3(0.96, 0.98, 1.0) * light, a * 0.82);
}
`;

const ATMO_FRAG = /* glsl */`
uniform vec3 sunDir;
varying vec3 vN;
varying vec3 vW;
void main() {
  vec3 n = normalize(vN);
  vec3 viewDir = normalize(cameraPosition - vW);
  float f = pow(1.0 - abs(dot(n, viewDir)), 3.4);
  float lit = clamp(dot(n, normalize(sunDir)) * 0.8 + 0.45, 0.12, 1.0);
  gl_FragColor = vec4(vec3(0.35, 0.6, 1.0) * f * lit * 1.25, f * lit);
}
`;

/* ---------- CPU surface painting (runs once per rebuild) ---------- */

function mulberry(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeValueNoise(rng) {
  const SIZE = 256;
  const table = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < table.length; i++) table[i] = rng();
  const at = (x, y) => table[((y & 255) << 8) | (x & 255)];
  const smooth = (t) => t * t * (3 - 2 * t);
  function noise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = smooth(xf), v = smooth(yf);
    return at(xi, yi) * (1 - u) * (1 - v) + at(xi + 1, yi) * u * (1 - v) +
           at(xi, yi + 1) * (1 - u) * v + at(xi + 1, yi + 1) * u * v;
  }
  return function fbm(x, y, octaves) {
    let s = 0, a = 0.5, f = 1, norm = 0;
    for (let i = 0; i < octaves; i++) {
      s += a * noise(x * f, y * f);
      norm += a;
      f *= 2.03; a *= 0.5;
    }
    return s / norm;
  };
}

/* Paints an earthlike world at low resolution then upscales — keeps load time
 * snappy while the 2048-wide canvas stays crisp under zoom. */
function paintWorld(actx, W, H) {
  const rng = mulberry(0xC0FFEE);
  const fbm = makeValueNoise(rng);
  const LW = 1024, LH = 512;
  const tmp = document.createElement('canvas');
  tmp.width = LW; tmp.height = LH;
  const tctx = tmp.getContext('2d');
  const img = tctx.createImageData(LW, LH);
  const d = img.data;

  for (let y = 0; y < LH; y++) {
    const lat = (y / LH) * 2 - 1;              // -1..1
    const latAbs = Math.abs(lat);
    for (let x = 0; x < LW; x++) {
      const nx = x / LW * 7.3, ny = y / LH * 3.9;
      let e = fbm(nx, ny, 5);
      e += 0.22 * (fbm(nx * 3.1 + 13.7, ny * 3.1 + 91.2, 4) - 0.5);
      e -= latAbs * latAbs * 0.18;             // polar basin
      const moist = fbm(nx * 1.7 + 41.3, ny * 1.7 + 7.7, 4);

      let r, g, b;
      const SEA = 0.485;
      if (e < SEA) {
        const depth = Math.min(1, (SEA - e) * 9);
        r = 20 - depth * 10; g = 74 - depth * 40; b = 138 - depth * 58;
        if (latAbs > 0.88 && e > SEA - 0.03) { r = 210; g = 226; b = 234; } // sea ice
      } else {
        const h = Math.min(1, (e - SEA) * 7);
        const desert = Math.max(0, 1 - latAbs * 3.2) * (1 - moist) ;
        r = 46 + h * 110 + desert * 120;
        g = 108 + h * 40 - desert * 60;
        b = 56 + h * 26 - desert * 40;
        if (h > 0.72) { const k = (h - 0.72) / 0.28; r += k * 130; g += k * 130; b += k * 128; }
        if (latAbs > 0.78 || h > 0.93) {
          const k = Math.min(1, (latAbs - 0.78) / 0.12);
          r = r * (1 - k) + 232 * k; g = g * (1 - k) + 240 * k; b = b * (1 - k) + 246 * k;
        }
      }
      const i = (y * LW + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  tctx.putImageData(img, 0, 0);

  actx.imageSmoothingEnabled = true;
  actx.drawImage(tmp, 0, 0, W, H);

  /* city lights — civilization waiting to be deleted */
  const cities = Math.round(W / 2.2);
  actx.fillStyle = 'rgba(255,214,140,0.85)';
  for (let i = 0; i < cities; i++) {
    const x = rng() * W;
    const y = H * (0.5 + (rng() - 0.5) * 0.86);   // avoid poles
    const px = ((x % W) + W) % W | 0, py = y | 0;
    const s = actx.getImageData(px, py, 1, 1).data;
    const greenish = s[1] > s[2];                  // land pixels are green/brown
    if (!greenish || s[0] > 200) continue;         // skip ocean & ice sheets
    const size = rng() < 0.08 ? 2 : 1;
    actx.globalAlpha = 0.35 + rng() * 0.55;
    actx.fillRect(px, py, size, size);
  }
  actx.globalAlpha = 1;
}

export class Planet {
  constructor(painter, { segments = 96 } = {}) {
    this.group = new THREE.Group();
    this.painter = painter;
    this.spin = 0.021;

    const maxAniso = painter.albedoTex.anisotropy || 1;

    this.uniforms = {
      dayMap: { value: painter.albedoTex },
      lavaMap: { value: painter.lavaTex },
      sunDir: { value: new THREE.Vector3(0.42, 0.38, 0.83).normalize() },
      time: { value: 0 }
    };

    const geo = new THREE.SphereGeometry(R, segments, Math.round(segments * 0.66));
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: PLANET_FRAG
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.rotation.order = 'YXZ';
    this.group.add(this.mesh);

    const cgeo = new THREE.SphereGeometry(R * 1.03, Math.round(segments * 0.66), Math.round(segments * 0.44));
    this.cloudUniforms = { sunDir: this.uniforms.sunDir, time: this.uniforms.time };
    this.cloudMaterial = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      vertexShader: VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      defines: { OCTAVES: 4 }
    });
    this.cloudMesh = new THREE.Mesh(cgeo, this.cloudMaterial);
    this.cloudMesh.renderOrder = 1;
    this.group.add(this.cloudMesh);

    const ageo = new THREE.SphereGeometry(R * 1.15, 48, 32);
    this.atmoMaterial = new THREE.ShaderMaterial({
      uniforms: { sunDir: this.uniforms.sunDir },
      vertexShader: VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.FrontSide
    });
    this.atmoMesh = new THREE.Mesh(ageo, this.atmoMaterial);
    this.atmoMesh.renderOrder = 2;
    this.group.add(this.atmoMesh);

    /* molten core, hidden until the finale */
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(R * 0.42, 40, 26),
      new THREE.MeshBasicMaterial({ color: 0xff7a22 })
    );
    this.core.visible = false;
    this.group.add(this.core);

    this.rebuild();
  }

  rebuild() {
    this.painter.paintBase(paintWorld);
    this.spin = 0.021;
    this.setAlive(true);
  }

  setAlive(alive) {
    this.mesh.visible = alive;
    this.cloudMesh.visible = alive && this.cloudsOn !== false;
    this.atmoMesh.visible = alive;
    this.core.visible = !alive;
  }

  setClouds(on, octaves) {
    this.cloudsOn = on;
    this.cloudMesh.visible = on && this.mesh.visible;
    if (this.cloudMaterial.defines.OCTAVES !== octaves) {
      this.cloudMaterial.defines.OCTAVES = octaves;
      this.cloudMaterial.needsUpdate = true;
    }
  }

  update(dt, time) {
    this.group.rotation.y += dt * this.spin;
    this.cloudMesh.rotation.y += dt * this.spin * 0.42;
    this.uniforms.time.value = time;
    if (this.core.visible) {
      const p = 1 + Math.sin(time * 5.2) * 0.06 + Math.sin(time * 13.7) * 0.03;
      this.core.scale.setScalar(p);
    }
  }

  /* World-space surface point -> unit direction in the LOCAL frame, so scars
   * stay glued to the ground while the planet rotates. */
  localDir(worldPoint, target) {
    this.group.worldToLocal(target.copy(worldPoint));
    return target.normalize();
  }

  queueDamage(worldPoint, radiusDeg, char, lava) {
    const dir = this.localDir(worldPoint, Planet._tmp);
    this.painter.addImpact(dir, radiusDeg, char, lava);
  }

  /* Random big lava burst — used by the core-breach crescendo. */
  queueLavaStorm(count) {
    for (let i = 0; i < count; i++) {
      const v = Planet._tmp2.randomDirection();
      this.painter.addImpact(v, 6 + Math.random() * 16, 0.25, 0.95);
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.cloudMesh.geometry.dispose();
    this.cloudMaterial.dispose();
    this.atmoMesh.geometry.dispose();
    this.atmoMaterial.dispose();
    this.core.geometry.dispose();
    this.core.material.dispose();
  }
}

Planet._tmp = new THREE.Vector3();
Planet._tmp2 = new THREE.Vector3();
