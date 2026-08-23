/* Orbit camera rig: drag to rotate (content follows the pointer), wheel /
 * pinch to zoom, inertial smoothing, and trauma-based shake. Pointer events
 * are self-contained so main.js can listen to the same canvas for firing. */

import * as THREE from 'three';

const TAU = Math.PI * 2;

export class OrbitCam {
  constructor(camera, dom, { minR, maxR }) {
    this.camera = camera;
    this.dom = dom;
    this.minR = minR;
    this.maxR = maxR;

    this.theta = 0.0;
    this.phi = Math.PI * 0.52;
    this.radius = maxR * 0.92;
    this.tTheta = this.theta;
    this.tPhi = this.phi;
    this.tRadius = this.radius;

    this.trauma = 0;
    this.time = 0;

    this.pointers = new Map();
    this.pinchDist = 0;

    dom.addEventListener('pointerdown', (e) => this._down(e));
    dom.addEventListener('pointermove', (e) => this._move(e));
    const up = (e) => this._up(e);
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(e.deltaY);
    }, { passive: false });
  }

  _down(e) {
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }

  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;

    if (this.pointers.size === 1) {
      this.tTheta -= dx * 0.0042;
      this.tPhi = Math.max(0.12, Math.min(Math.PI - 0.12, this.tPhi - dy * 0.0042));
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0 && d > 0) this.zoom((this.pinchDist - d) * 1.6);
      this.pinchDist = d;
    }
  }

  _up(e) {
    this.pointers.delete(e.pointerId);
    this.pinchDist = 0;
  }

  zoom(delta) {
    this.tRadius = Math.max(this.minR, Math.min(this.maxR, this.tRadius * Math.exp(delta * 0.0011)));
  }

  setRadius(r) { this.tRadius = Math.max(this.minR, Math.min(this.maxR, r)); }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }

  update(dt, autoRotateSpeed = 0) {
    this.time += dt;
    if (autoRotateSpeed && this.pointers.size === 0) this.tTheta += dt * autoRotateSpeed;

    const k = 1 - Math.exp(-dt * 7.5);
    this.theta += (this.tTheta - this.theta) * k;
    this.phi += (this.tPhi - this.phi) * k;
    this.radius += (this.tRadius - this.radius) * k;

    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    const t2 = this.trauma * this.trauma;
    const sx = Math.sin(this.time * 47.3) * 0.6 + Math.sin(this.time * 23.1) * 0.4;
    const sy = Math.cos(this.time * 39.7) * 0.6 + Math.sin(this.time * 17.9) * 0.4;

    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    this.camera.position.set(
      this.radius * sp * Math.sin(this.theta) + sx * t2 * 1.4,
      this.radius * cp + sy * t2 * 1.4,
      this.radius * sp * Math.cos(this.theta)
    );
    this.camera.lookAt(sx * t2 * 0.8, sy * t2 * 0.8, 0);
    this.camera.rotation.z += Math.sin(this.time * 29.3) * t2 * 0.05;
  }

  /* Unit vector from origin toward the camera (used by weapon emitters). */
  dirOut(target) {
    return target.copy(this.camera.position).normalize();
  }
}

/* Starfield backdrop. Capacity is allocated once for the highest tier;
 * setDrawRange adapts the visible count per quality tier (no realloc). */
export function makeStars(count) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const r = 320 + Math.random() * 620;
    const u = Math.random() * TAU;
    const v = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(v) * Math.cos(u);
    pos[i * 3 + 1] = r * Math.cos(v);
    pos[i * 3 + 2] = r * Math.sin(v) * Math.sin(u);
    const warm = Math.random();
    c.setHSL(warm < 0.12 ? 0.09 : 0.58 + Math.random() * 0.06, warm < 0.12 ? 0.6 : 0.25, 0.62 + Math.random() * 0.35);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 1.9, sizeAttenuation: true, vertexColors: true,
    transparent: true, opacity: 0.95, depthWrite: false
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return {
    object: pts,
    setCount(n) { geo.setDrawRange(0, n); },
    dispose() { geo.dispose(); mat.dispose(); }
  };
}
