/**
 * Per-frame ambience animation registry.
 *
 * Each item is a tiny `update(dt, elapsed)` closure over scene objects that
 * already exist: steam off the manholes, awning/banner flutter, neon sign
 * flicker, scrolling LED tickers, traffic-light lens colours, circling birds,
 * the banner plane and a gentle camera drift while the user is idle.
 *
 * The registry itself is era-agnostic; the era blend simply changes which
 * items exist because each era layer builds its own set.
 */

import * as THREE from 'three';
import type { IntersectionSignals } from './traffic';

export interface AmbientItem {
  name: string;
  update(dt: number, elapsed: number): void;
}

/** Manhole steam: billboarded puffs that rise, expand and fade. */
export function steamPuffs(
  parent: THREE.Object3D,
  origins: THREE.Vector3[],
  options: { color?: string; puffsPerOrigin?: number; spread?: number; rise?: number; opacity?: number } = {},
): AmbientItem {
  const { color = '#cfc9bd', puffsPerOrigin = 5, spread = 0.5, rise = 9, opacity = 0.3 } = options;
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const puffGeometry = new THREE.PlaneGeometry(1.6, 1.6);
  interface Puff {
    mesh: THREE.Mesh;
    life: number;
    duration: number;
    origin: THREE.Vector3;
    driftX: number;
    driftZ: number;
  }
  const puffs: Puff[] = [];

  for (const origin of origins) {
    for (let i = 0; i < puffsPerOrigin; i += 1) {
      const mesh = new THREE.Mesh(puffGeometry, material.clone());
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      parent.add(mesh);
      puffs.push({
        mesh,
        life: (i / puffsPerOrigin) * 5,
        duration: 4.5 + (i % 3) * 0.9,
        origin: origin.clone(),
        driftX: (i % 2 === 0 ? 1 : -1) * spread * (0.4 + (i % 3) * 0.2),
        driftZ: ((i + 1) % 2 === 0 ? 1 : -1) * spread * 0.5,
      });
    }
  }

  const cameraTarget = new THREE.Vector3();
  return {
    name: 'steam',
    update(dt, elapsed) {
      for (const puff of puffs) {
        puff.life += dt;
        if (puff.life > puff.duration) puff.life -= puff.duration;
        const t = puff.life / puff.duration;
        puff.mesh.position.set(
          puff.origin.x + puff.driftX * t * 2 + Math.sin(elapsed * 0.6 + puff.origin.x) * 0.3,
          puff.origin.y + 0.4 + t * rise,
          puff.origin.z + puff.driftZ * t * 2,
        );
        const scale = 0.5 + t * 2.6;
        puff.mesh.scale.setScalar(scale);
        const material2 = puff.mesh.material as THREE.MeshBasicMaterial;
        material2.opacity = opacity * Math.sin(Math.PI * Math.min(1, t)) * 1.05;
        // Billboard toward the origin so the plume always reads as volume.
        cameraTarget.copy(puff.mesh.position).multiplyScalar(2);
        puff.mesh.lookAt(cameraTarget.x, puff.mesh.position.y, cameraTarget.z);
      }
    },
  };
}

/** Awning / banner flutter driven by a travelling sine wave. */
export function flutterCloth(
  targets: { object: THREE.Object3D; axis?: 'x' | 'y' | 'z'; amplitude?: number; speed?: number; phase?: number }[],
): AmbientItem {
  return {
    name: 'flutter',
    update(dt, elapsed) {
      for (const target of targets) {
        const amplitude = target.amplitude ?? 0.16;
        const speed = target.speed ?? 2.4;
        const phase = target.phase ?? 0;
        const wave = Math.sin(elapsed * speed + phase) * amplitude;
        const axis = target.axis ?? 'y';
        target.object.rotation[axis] = wave;
        const stretch = 1 + Math.abs(wave) * 0.12;
        target.object.scale.set(stretch, 1, 1);
      }
      void dt;
    },
  };
}

/** Scrolling LED ticker / media-facade copy. */
export function scrollTickers(targets: { rows: THREE.Object3D[]; speed?: number; span?: number }[]): AmbientItem {
  return {
    name: 'ticker',
    update(dt) {
      for (const target of targets) {
        const speed = target.speed ?? 2.2;
        const span = target.span ?? 1.6;
        target.rows.forEach((row, index) => {
          row.position.x += speed * dt * (index % 2 === 0 ? 1 : -1);
          if (row.position.x > span) row.position.x -= span * 2;
          if (row.position.x < -span) row.position.x += span * 2;
        });
      }
    },
  };
}

/** Neon buzz: small emissive jitter, with occasional drop-outs. */
export function neonFlicker(targets: { object: THREE.Object3D; material: THREE.MeshStandardMaterial; base: number; speed?: number; phase?: number }[]): AmbientItem {
  return {
    name: 'neon-flicker',
    update(dt, elapsed) {
      for (const target of targets) {
        const speed = target.speed ?? 12;
        const phase = target.phase ?? 0;
        const noise = Math.sin(elapsed * speed + phase) * 0.5 + Math.sin(elapsed * speed * 2.7 + phase) * 0.5;
        const dropout = Math.sin(elapsed * 1.7 + phase * 3) > 0.985 ? 0.2 : 1;
        target.material.emissiveIntensity = target.base * (0.86 + noise * 0.14) * dropout;
      }
      void dt;
    },
  };
}

/** Traffic-light lens colours driven by the intersection signal state. */
export function trafficLightAnimator(
  lights: { group: THREE.Object3D; axis: 'x' | 'z'; lenses: Record<'red' | 'amber' | 'green', THREE.Mesh> }[],
  getSignals: () => IntersectionSignals,
): AmbientItem {
  const setLens = (mesh: THREE.Mesh, on: boolean): void => {
    const material = mesh.material as THREE.MeshStandardMaterial;
    if (material && 'emissiveIntensity' in material) material.emissiveIntensity = on ? 2.6 : 0.12;
  };
  return {
    name: 'traffic-lights',
    update() {
      const signals = getSignals();
      for (const light of lights) {
        const phase = light.axis === 'x' ? signals.x : signals.z;
        setLens(light.lenses.red, phase === 'red');
        setLens(light.lenses.amber, phase === 'amber');
        setLens(light.lenses.green, phase === 'green');
      }
    },
  };
}

/** Birds circling the block, wings flapping. */
export function birdFlock(birds: THREE.Object3D[]): AmbientItem {
  return {
    name: 'birds',
    update(dt, elapsed) {
      for (const bird of birds) {
        const radius = (bird.userData.orbit as number) ?? 90;
        const speed = (bird.userData.speed as number) ?? 0.2;
        const phase = (bird.userData.phase as number) ?? 0;
        const height = (bird.userData.height as number) ?? 50;
        const angle = phase + elapsed * speed;
        bird.position.set(Math.cos(angle) * radius, height + Math.sin(elapsed * 0.7 + phase) * 2.4, Math.sin(angle) * radius);
        bird.rotation.y = -angle + Math.PI / 2;
        const flap = Math.sin(elapsed * 7 + phase) * 0.7;
        for (const child of bird.children) child.rotation.z = flap;
      }
      void dt;
    },
  };
}

/** Banner plane on a slow, wide circuit. */
export function bannerPlane(plane: THREE.Object3D | null): AmbientItem | null {
  if (!plane) return null;
  return {
    name: 'banner-plane',
    update(dt, elapsed) {
      const radius = (plane.userData.radius as number) ?? 210;
      const height = (plane.userData.height as number) ?? 96;
      const speed = (plane.userData.speed as number) ?? 0.055;
      const angle = elapsed * speed * Math.PI;
      plane.position.set(Math.cos(angle) * radius, height + Math.sin(angle * 1.7) * 5, Math.sin(angle) * radius);
      plane.rotation.y = -angle + Math.PI / 2;
      plane.rotation.z = Math.sin(angle * 1.7) * 0.08;
      plane.rotation.x = 0.03;
      void dt;
    },
  };
}

/** Subtle camera drift while the user has not touched the controls. */
export function cameraDrift(options: {
  isIdle: () => boolean;
  apply: (dx: number, dy: number) => void;
  amplitude?: number;
  speed?: number;
}): AmbientItem {
  const amplitude = options.amplitude ?? 0.22;
  const speed = options.speed ?? 0.13;
  let last = 0;
  return {
    name: 'camera-drift',
    update(_dt, elapsed) {
      if (!options.isIdle()) {
        last = elapsed;
        return;
      }
      const wobble = Math.sin(elapsed * speed) * amplitude + Math.sin(elapsed * speed * 2.3) * amplitude * 0.35;
      const delta = wobble - last;
      last = wobble;
      options.apply(delta, Math.sin(elapsed * speed * 0.7) * amplitude * 0.06);
    },
  };
}

/** Registry of ambience items for one era layer. */
export class AmbienceAnimator {
  private readonly items: AmbientItem[] = [];
  private elapsed = 0;

  add(item: AmbientItem | null): void {
    if (item) this.items.push(item);
  }

  get count(): number {
    return this.items.length;
  }

  get names(): string[] {
    return this.items.map((item) => item.name);
  }

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.1);
    this.elapsed += step;
    for (const item of this.items) item.update(step, this.elapsed);
  }

  reset(): void {
    this.items.length = 0;
    this.elapsed = 0;
  }
}
