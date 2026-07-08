import * as THREE from 'three';

export interface CameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  private target = new THREE.Vector3(0, 0, 0);
  private azimuth = Math.PI * 0.25;
  private polar = Math.PI * 0.32;
  private distance = 70;
  private targetDistance = 70;
  private readonly minDistance = 25;
  private readonly maxDistance = 140;
  private readonly minPolar = 0.12;
  private readonly maxPolar = Math.PI * 0.48;
  private bounds: CameraBounds;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private readonly domElement: HTMLElement;
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onWheel: (e: WheelEvent) => void;

  constructor(aspect: number, domElement: HTMLElement, bounds: CameraBounds) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this.domElement = domElement;
    this.bounds = bounds;

    this.onPointerDown = (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      domElement.setPointerCapture(e.pointerId);
    };
    this.onPointerMove = (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.azimuth -= dx * 0.005;
      this.polar = Math.max(this.minPolar, Math.min(this.maxPolar, this.polar - dy * 0.005));
    };
    this.onPointerUp = (e) => {
      this.dragging = false;
      try { domElement.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };
    this.onWheel = (e) => {
      e.preventDefault();
      this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, this.targetDistance + e.deltaY * 0.05));
    };

    domElement.addEventListener('pointerdown', this.onPointerDown);
    domElement.addEventListener('pointermove', this.onPointerMove);
    domElement.addEventListener('pointerup', this.onPointerUp);
    domElement.addEventListener('pointercancel', this.onPointerUp);
    domElement.addEventListener('wheel', this.onWheel, { passive: false });

    this.update(0);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  pan(dx: number, dz: number): void {
    this.target.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, this.target.x + dx));
    this.target.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, this.target.z + dz));
  }

  setTarget(x: number, z: number): void {
    this.target.x = Math.max(this.bounds.minX, Math.min(this.bounds.maxX, x));
    this.target.z = Math.max(this.bounds.minZ, Math.min(this.bounds.maxZ, z));
  }

  frameBounds(b: CameraBounds): void {
    const cx = (b.minX + b.maxX) * 0.5;
    const cz = (b.minZ + b.maxZ) * 0.5;
    const w = b.maxX - b.minX;
    const d = b.maxZ - b.minZ;
    const diag = Math.sqrt(w * w + d * d);
    this.target.set(cx, 0, cz);
    this.targetDistance = Math.max(this.minDistance, Math.min(this.maxDistance, diag * 1.1));
  }

  update(deltaTime: number): void {
    this.distance += (this.targetDistance - this.distance) * Math.min(1, deltaTime * 6);
    const sp = Math.sin(this.polar);
    const cp = Math.cos(this.polar);
    const x = this.target.x + this.distance * sp * Math.sin(this.azimuth);
    const y = this.target.y + this.distance * cp;
    const z = this.target.z + this.distance * sp * Math.cos(this.azimuth);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  getTarget(): THREE.Vector3 {
    return this.target.clone();
  }

  dispose(): void {
    this.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.domElement.removeEventListener('pointercancel', this.onPointerUp);
    this.domElement.removeEventListener('wheel', this.onWheel);
  }
}
