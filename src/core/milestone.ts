/**
 * Milestone room — a deliberately plain, lit café shell.
 *
 * This is the phase-1 milestone: an empty room (floor, four walls, ceiling and
 * a ceiling lamp) so the page loads and renders something real before any
 * period domain exists. The real room shell, including period-specific
 * surfaces, windows and fixtures, is owned by the environment-shell domain in
 * phase 2; this placeholder is a milestone artifact, not a final invariant.
 *
 * Colours and lights are driven by a {@link PeriodDefinition}, so the module
 * already reacts to `applyPeriod` the way the permanent domains will.
 */

import * as THREE from 'three';
import {
  DEFAULT_ROOM_BOUNDS,
  type PeriodDefinition,
  type RoomBounds,
} from '../contracts/period';
import { disposeObject3D } from './kernel';

/**
 * Neutral era used by the milestone boot. The period registry (phase 2) will
 * replace it with the researched 1945 definition; until then the placeholder
 * keeps the room warm and readable.
 */
export const MILESTONE_PERIOD: PeriodDefinition = Object.freeze({
  year: '1945',
  label: '1945',
  name: 'Milestone room',
  summary:
    'Placeholder era definition used by the milestone boot: a bare, lamp-lit café shell rendered before the period registry exists.',
  palette: {
    background: '#16110d',
    floor: '#6f5138',
    wall: '#c9b79b',
    ceiling: '#e4dccb',
    accent: '#8c6a4a',
    lamp: '#ffe3b0',
  },
  lighting: {
    ambientColor: '#cfe0ff',
    ambientIntensity: 0.55,
    keyColor: '#fff0d2',
    keyIntensity: 1.6,
    fillColor: '#94a9c8',
    fillIntensity: 0.35,
    lampColor: '#ffd9a3',
    lampIntensity: 24,
    fogDensity: 0,
  },
  details: ['bare floorboards', 'plaster walls', 'single ceiling lamp'],
});

export interface MilestoneRoomOptions {
  /** Room dimensions; defaults to {@link DEFAULT_ROOM_BOUNDS}. */
  readonly bounds?: RoomBounds;
  /** Era applied on build; defaults to {@link MILESTONE_PERIOD}. */
  readonly period?: PeriodDefinition;
}

/** The placeholder room, as driven by the kernel's frame loop. */
export interface MilestoneRoom {
  /** Node holding every surface, fixture and light of the placeholder room. */
  readonly root: THREE.Group;
  readonly bounds: RoomBounds;
  /** Era currently applied. */
  readonly period: PeriodDefinition;
  /** Recolour surfaces, lights, backdrop and fog for a new era. */
  applyPeriod(period: PeriodDefinition): void;
  /** Advance time based behaviour (the placeholder room is static). */
  update(deltaSeconds: number): void;
  /** Release geometries, materials, textures and detach the room. */
  dispose(): void;
}

/**
 * Builds the placeholder room inside `scene` (usually `kernel.scene`).
 * The returned room owns its own `root` group and must be disposed by the
 * caller when the app tears down.
 */
export function buildMilestoneRoom(
  scene: THREE.Object3D,
  options: MilestoneRoomOptions = {},
): MilestoneRoom {
  const bounds = options.bounds ?? DEFAULT_ROOM_BOUNDS;
  const root = new THREE.Group();
  root.name = 'milestone-room';
  scene.add(root);

  const scene3d = scene instanceof THREE.Scene ? scene : null;
  const { width, depth, height } = bounds;
  const halfWidth = width / 2;
  const halfDepth = depth / 2;

  /* -- surfaces ------------------------------------------------------------ */

  const floorMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(MILESTONE_PERIOD.palette.floor),
    roughness: 0.78,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(MILESTONE_PERIOD.palette.wall),
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(MILESTONE_PERIOD.palette.ceiling),
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const lampMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(MILESTONE_PERIOD.palette.lamp),
    emissive: new THREE.Color(MILESTONE_PERIOD.palette.lamp),
    emissiveIntensity: 1.35,
    roughness: 0.35,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), floorMaterial);
  floor.name = 'milestone-floor';
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), ceilingMaterial);
  ceiling.name = 'milestone-ceiling';
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = height;
  ceiling.receiveShadow = true;
  root.add(ceiling);

  const wallGeometryX = new THREE.PlaneGeometry(width, height);
  const wallGeometryZ = new THREE.PlaneGeometry(depth, height);

  const backWall = new THREE.Mesh(wallGeometryX, wallMaterial);
  backWall.name = 'milestone-wall-back';
  backWall.position.set(0, height / 2, -halfDepth);
  backWall.receiveShadow = true;
  root.add(backWall);

  const frontWall = new THREE.Mesh(wallGeometryX, wallMaterial);
  frontWall.name = 'milestone-wall-front';
  frontWall.position.set(0, height / 2, halfDepth);
  frontWall.rotation.y = Math.PI;
  frontWall.receiveShadow = true;
  root.add(frontWall);

  const leftWall = new THREE.Mesh(wallGeometryZ, wallMaterial);
  leftWall.name = 'milestone-wall-left';
  leftWall.position.set(-halfWidth, height / 2, 0);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.receiveShadow = true;
  root.add(leftWall);

  const rightWall = new THREE.Mesh(wallGeometryZ, wallMaterial);
  rightWall.name = 'milestone-wall-right';
  rightWall.position.set(halfWidth, height / 2, 0);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.receiveShadow = true;
  root.add(rightWall);

  /* -- ceiling lamp fixture ------------------------------------------------- */

  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.36, 0.24, 28, 1, true),
    lampMaterial,
  );
  shade.name = 'milestone-lamp-shade';
  shade.position.set(0, height - 0.3, 0);
  root.add(shade);

  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), lampMaterial);
  bulb.name = 'milestone-lamp-bulb';
  bulb.position.set(0, height - 0.36, 0);
  root.add(bulb);

  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8),
    new THREE.MeshStandardMaterial({ color: 0x2b2620, roughness: 0.9 }),
  );
  cord.name = 'milestone-lamp-cord';
  cord.position.set(0, height - 0.09, 0);
  root.add(cord);

  /* -- lighting ------------------------------------------------------------- */

  const hemisphere = new THREE.HemisphereLight(
    new THREE.Color(MILESTONE_PERIOD.lighting.ambientColor),
    new THREE.Color(MILESTONE_PERIOD.palette.floor),
    MILESTONE_PERIOD.lighting.ambientIntensity,
  );
  hemisphere.name = 'milestone-ambient';
  root.add(hemisphere);

  const fill = new THREE.AmbientLight(
    new THREE.Color(MILESTONE_PERIOD.lighting.fillColor),
    MILESTONE_PERIOD.lighting.fillIntensity,
  );
  fill.name = 'milestone-fill';
  root.add(fill);

  const keyLight = new THREE.DirectionalLight(
    new THREE.Color(MILESTONE_PERIOD.lighting.keyColor),
    MILESTONE_PERIOD.lighting.keyIntensity,
  );
  keyLight.name = 'milestone-key';
  keyLight.position.set(-halfWidth * 0.7, height * 0.85, halfDepth * 0.6);
  root.add(keyLight);

  const lamp = new THREE.SpotLight(
    new THREE.Color(MILESTONE_PERIOD.lighting.lampColor),
    MILESTONE_PERIOD.lighting.lampIntensity,
    0,
    Math.PI / 3,
    0.72,
    2,
  );
  lamp.name = 'milestone-lamp-light';
  lamp.position.set(0, height - 0.42, 0);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0009;
  lamp.shadow.camera.near = 0.1;
  lamp.shadow.camera.far = Math.max(height * 3, 12);
  lamp.target.position.set(0, 0, 0);
  root.add(lamp);
  root.add(lamp.target);

  /* -- era application ------------------------------------------------------ */

  let period = options.period ?? MILESTONE_PERIOD;

  const applyPeriod = (next: PeriodDefinition): void => {
    period = next;
    floorMaterial.color.set(next.palette.floor);
    wallMaterial.color.set(next.palette.wall);
    ceilingMaterial.color.set(next.palette.ceiling);
    lampMaterial.color.set(next.palette.lamp);
    lampMaterial.emissive.set(next.palette.lamp);

    hemisphere.color.set(next.lighting.ambientColor);
    hemisphere.groundColor.set(next.palette.floor);
    hemisphere.intensity = next.lighting.ambientIntensity;
    fill.color.set(next.lighting.fillColor);
    fill.intensity = next.lighting.fillIntensity;
    keyLight.color.set(next.lighting.keyColor);
    keyLight.intensity = next.lighting.keyIntensity;
    lamp.color.set(next.lighting.lampColor);
    lamp.intensity = next.lighting.lampIntensity;

    if (scene3d) {
      scene3d.background = new THREE.Color(next.palette.background);
      scene3d.fog = next.lighting.fogDensity > 0
        ? new THREE.FogExp2(new THREE.Color(next.palette.background), next.lighting.fogDensity)
        : null;
    }
  };

  applyPeriod(period);

  return {
    root,
    bounds,
    get period() {
      return period;
    },
    applyPeriod,
    update(): void {
      // The placeholder room is static; the environment domain owns animated detail.
    },
    dispose(): void {
      disposeObject3D(root);
    },
  };
}
