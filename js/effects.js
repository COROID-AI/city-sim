/* Particle / shockwave / flash effects.
 *
 * Addresses the perf finding: ONE packed BufferGeometry of points is
 * allocated ONCE at the maximum tier capacity — quality tiers never realloc,
 * they only change the spawn multiplier and the active cap (setDrawRange).
 * Additive blending means fading to black == fading out, so no alpha channel
 * is needed. Black holes register attractors that bend spark velocities.
 */

import * as THREE from 'three';
import { PLANET_RADIUS as R } from './config.js';

const VERT = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (170.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */`
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c) * 2.0;
  float a = smoothstep(1.0, 0.15, d);
  gl_FragColor = vec4(vColor * a, 1.0);
}
`;

function glowTexture(inner = '255,255,255', outer = '255,140,40') {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  g.addColorStop(0, `rgba(${inner},1)`);
  g.addColorStop(0.25, `rgba(${outer},0.85)`);
  g.addColorStop(1, `rgba(${outer},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SPARK_COLORS = [
  [1.0, 0.72, 0.35], [1.0, 0.5, 0.18], [1.0, 0.9, 0.62],
  [1.0, 0.32, 0.10], [0.95, 0.95, 1.0]
];

export class Effects {
  constructor(scene, capacity = 6000) {
    this.scene = scene;
    this.cap = capacity;
    this.alive = 0;
    this.mul = 1;
    this.activeCap = capacity;

    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.baseCol = new Float32Array(capacity * 3);
    this.colAttr = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);

    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colA = new THREE.BufferAttribute(this.colAttr, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aColor', this.colA);
    this.geo.setAttribute('aSize', this.sizeAttr);
    this.geo.setDrawRange(0, 0);

    this.points = new THREE.Points(this.geo, new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    /* pooled shockwave rings */
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.94, 1.0, 56);
    for (let i = 0; i < 10; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
      });
      const m = new THREE.Mesh(ringGeo, mat);
      m.visible = false;
      scene.add(m);
      this.rings.push({ mesh: m, t: 0, dur: 1, target: 6 });
    }

    /* pooled glow flashes */
    const tex = glowTexture();
    this.flashes = [];
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: 0,
        depthWrite: false, blending: THREE.AdditiveBlending
      });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.flashes.push({ sprite: s, t: 0, dur: 0.4, from: 2, to: 12 });
    }
    this.glowTex = tex;

    this.attractors = [];

    this._v = new THREE.Vector3();
  }

  setBudget(tier) {
    this.mul = tier.particleMul;
    this.activeCap = Math.min(tier.maxSparks, this.cap);
    if (this.alive > this.activeCap) {
      // hard-trim: move excess particles out by collapsing draw range
      this.killOldest(this.alive - this.activeCap);
    }
  }

  killOldest(n) { this.alive = Math.max(0, this.alive - n); }

  _spawnOne(x, y, z, vx, vy, vz, col, life, size, dragK) {
    let i;
    if (this.alive < this.activeCap) i = this.alive++;
    else i = (Math.random() * this.alive) | 0;   // recycle when saturated
    const p3 = i * 3;
    this.pos[p3] = x; this.pos[p3 + 1] = y; this.pos[p3 + 2] = z;
    this.vel[p3] = vx; this.vel[p3 + 1] = vy; this.vel[p3 + 2] = vz;
    this.baseCol[p3] = col[0]; this.baseCol[p3 + 1] = col[1]; this.baseCol[p3 + 2] = col[2];
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
    this.drag[i] = dragK;
  }

  burst(point, normal, scale = 1) {
    const count = Math.round((30 + 80 * scale) * this.mul);
    for (let i = 0; i < count; i++) {
      const c = SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0];
      // hemisphere around the surface normal
      const rx = normal.x + (Math.random() - 0.5) * 1.7;
      const ry = normal.y + (Math.random() - 0.5) * 1.7;
      const rz = normal.z + (Math.random() - 0.5) * 1.7;
      const inv = 1 / (Math.hypot(rx, ry, rz) || 1);
      const sp = (2.4 + Math.random() * 7) * (0.6 + scale * 0.5);
      this._spawnOne(
        point.x + normal.x * 0.08, point.y + normal.y * 0.08, point.z + normal.z * 0.08,
        rx * inv * sp, ry * inv * sp, rz * inv * sp,
        c, 0.45 + Math.random() * (0.5 + scale * 0.45),
        (0.9 + Math.random() * 1.8) * (0.8 + scale * 0.35),
        1.4
      );
    }
  }

  jet(point, normal, strength = 1) {
    const count = Math.round(6 * this.mul * strength);
    for (let i = 0; i < count; i++) {
      const c = SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0];
      const jx = normal.x + (Math.random() - 0.5) * 0.9;
      const jy = normal.y + (Math.random() - 0.5) * 0.9;
      const jz = normal.z + (Math.random() - 0.5) * 0.9;
      const inv = 1 / (Math.hypot(jx, jy, jz) || 1);
      const sp = 4 + Math.random() * 6 * strength;
      this._spawnOne(point.x, point.y, point.z, jx * inv * sp, jy * inv * sp, jz * inv * sp,
        c, 0.25 + Math.random() * 0.35, 0.7 + Math.random(), 1.8);
    }
  }

  trail(point, vel, hotness = 1) {
    if (Math.random() > this.mul) return;
    const c = SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0];
    this._spawnOne(
      point.x, point.y, point.z,
      -vel.x * 0.14 + (Math.random() - 0.5), -vel.y * 0.14 + (Math.random() - 0.5), -vel.z * 0.14 + (Math.random() - 0.5),
      c, 0.28 + Math.random() * 0.3, (0.6 + Math.random()) * hotness, 2.2
    );
  }

  shockwave(point, normal, scale = 1) {
    const slot = this.rings.find((r) => !r.mesh.visible) ||
                 this.rings.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    slot.t = 0;
    slot.dur = 0.55 + 0.22 * scale;
    slot.target = 5 + 9 * scale;
    slot.mesh.visible = true;
    slot.mesh.position.copy(point).addScaledVector(normal, R * 0.02 + 0.05);
    slot.mesh.lookAt(this._v.copy(point).add(normal));
    slot.mesh.scale.setScalar(0.4);
  }

  flash(point, from, to, dur = 0.42, color = 0xffffff) {
    const slot = this.flashes.find((f) => !f.sprite.visible) || this.flashes[0];
    slot.t = 0;
    slot.dur = dur;
    slot.from = from;
    slot.to = to;
    slot.sprite.visible = true;
    slot.sprite.position.copy(point);
    slot.sprite.material.color.set(color);
  }

  addAttractor(pos, strength) {
    this.attractors.push({ pos: pos.clone(), strength });
    return this.attractors[this.attractors.length - 1];
  }

  removeAttractor(a) {
    const i = this.attractors.indexOf(a);
    if (i >= 0) this.attractors.splice(i, 1);
  }

  update(dt) {
    const pos = this.pos, vel = this.vel, col = this.colAttr, base = this.baseCol;
    const grav = 7.5;
    for (let i = 0; i < this.alive; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        const last = --this.alive;
        if (i !== last) {
          const a = i * 3, b = last * 3;
          for (let k = 0; k < 3; k++) {
            pos[a + k] = pos[b + k]; vel[a + k] = vel[b + k];
            base[a + k] = base[b + k];
          }
          this.life[i] = this.life[last];
          this.maxLife[i] = this.maxLife[last];
          this.size[i] = this.size[last];
          this.drag[i] = this.drag[last];
        }
        i--;
        continue;
      }
      const p3 = i * 3;
      const x = pos[p3], y = pos[p3 + 1], z = pos[p3 + 2];

      // gravity toward planet center (debris rains back down)
      const r2 = x * x + y * y + z * z;
      const r = Math.sqrt(r2) || 1;
      const g = (grav / r2) * r;

      let ax = (-x / r) * g, ay = (-y / r) * g, az = (-z / r) * g;

      for (const att of this.attractors) {
        const dx = att.pos.x - x, dy = att.pos.y - y, dz = att.pos.z - z;
        const d2 = dx * dx + dy * dy + dz * dz + 3;
        const f = att.strength / d2;
        const d = Math.sqrt(d2);
        ax += (dx / d) * f * 60;
        ay += (dy / d) * f * 60;
        az += (dz / d) * f * 60;
      }

      const damp = 1 - Math.min(0.9, this.drag[i] * dt);
      vel[p3] = (vel[p3] + ax * dt) * damp;
      vel[p3 + 1] = (vel[p3 + 1] + ay * dt) * damp;
      vel[p3 + 2] = (vel[p3 + 2] + az * dt) * damp;
      pos[p3] = x + vel[p3] * dt;
      pos[p3 + 1] = y + vel[p3 + 1] * dt;
      pos[p3 + 2] = z + vel[p3 + 2] * dt;

      // burn up anything that re-enters the crust
      if (r < R * 0.985 && this.attractors.length === 0) { this.life[i] = 0; }

      const fade = this.life[i] / this.maxLife[i];
      const f = fade * fade;
      col[p3] = base[p3] * f;
      col[p3 + 1] = base[p3 + 1] * f;
      col[p3 + 2] = base[p3 + 2] * f;
    }

    this.geo.setDrawRange(0, this.alive);
    if (this.alive > 0 || this._wasAlive) {
      this.posAttr.needsUpdate = true;
      this.colA.needsUpdate = true;
      this.sizeAttr.needsUpdate = true;
    }
    this._wasAlive = this.alive > 0;

    for (const ring of this.rings) {
      if (!ring.mesh.visible) continue;
      ring.t += dt;
      const u = ring.t / ring.dur;
      if (u >= 1) { ring.mesh.visible = false; continue; }
      const e = 1 - (1 - u) * (1 - u);           // ease-out
      ring.mesh.scale.setScalar(0.4 + e * ring.target);
      ring.mesh.material.opacity = 0.85 * (1 - u);
    }

    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      f.t += dt;
      const u = f.t / f.dur;
      if (u >= 1) { f.sprite.visible = false; continue; }
      f.sprite.scale.setScalar(f.from + (f.to - f.from) * (1 - (1 - u) * (1 - u)));
      f.sprite.material.opacity = 0.95 * (1 - u);
    }
  }

  reset() {
    this.alive = 0;
    this.geo.setDrawRange(0, 0);
    this.attractors.length = 0;
    for (const ring of this.rings) ring.mesh.visible = false;
    for (const f of this.flashes) f.sprite.visible = false;
  }
}
