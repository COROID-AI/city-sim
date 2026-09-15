/**
 * Music playback devices — geometry, materials, animation and placement.
 *
 * This module turns one era's {@link MusicDeviceSpec} into a built, textured,
 * animated device: cabinet joinery, dial glass or display, knobs and selectors,
 * grille cloth with real speaker cones, model plates, indicator glow, cable
 * routing with a plug, dust and wear, plus the support it stands on (a wall
 * shelf, the counter top, a storefront ledge) and the companion props the era
 * carries (a gramophone, tape stacks, an iPod cradle, cable clutter, a phone).
 *
 * Design rules:
 *
 *  - **One device per era.** {@link buildMusicDevice} raises exactly one group,
 *    named `music:<year>:<device>`; the module attaches that single group, so the
 *    other four variants are never in the scene graph at all.
 *  - **Everything procedural.** Each material pulls its map from
 *    `./textures` (canvas or data backend); nothing is fetched.
 *  - **Placement from the room.** {@link musicDevicePlacement} derives the anchor
 *    from the shared `RoomBounds` and the environment's `StructuralLayout`
 *    (counter zone, walls), so the device sits on the shelf, against the wall or
 *    on the counter the era calls for.
 *  - **Animatable.** Moving parts (dial needles, tape reels, turntables, LED
 *    glow, cone excursion) are returned as {@link MusicAnimation} records that
 *    {@link advanceMusicAnimations} drives with delta time — and freezes when
 *    `prefers-reduced-motion` asks for it.
 *  - **Disposable.** Every geometry, material and texture the device created is
 *    tracked, so {@link disposeMusicDevice} releases all of it and detaches the
 *    group.
 */

import * as THREE from 'three';
import { createSeededRandom } from '../../core/kernel';
import type { YearId } from '../../contracts/period';
import type { StructuralLayout } from '../environment/roomBounds';
import {
  createMusicTexture,
  hashString,
  type CanvasFactory,
  type MusicTextureKind,
} from './textures';

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                 */
/* -------------------------------------------------------------------------- */

/** The five playback devices, one per era. */
export const MUSIC_DEVICE_KINDS = [
  'wireless-set',
  'jukebox',
  'boombox',
  'ipod-dock',
  'smart-speaker',
] as const;

export type MusicDeviceKind = (typeof MUSIC_DEVICE_KINDS)[number];

/** How a device is carried by the room. */
export type MusicPlacementKind = 'wall-shelf' | 'wall-floor' | 'counter-top' | 'storefront-ledge';

/** Where in the room a device lives. */
export type MusicPlacementZone =
  | 'left-wall'
  | 'right-wall'
  | 'counter-left'
  | 'counter-right'
  | 'storefront-right';

/** Cabinet substrate, which picks the procedural finish painter. */
export type MusicCabinetMaterial =
  | 'veneer'
  | 'bakelite'
  | 'rexine'
  | 'plastic'
  | 'aluminium'
  | 'painted-steel';

/** Primary control type of the device. */
export type MusicControlKind = 'knob' | 'rocker' | 'slider' | 'keypad' | 'touch' | 'click-wheel';

/** Register presentation. */
export type MusicDialKind = 'dial-glass' | 'dial-led' | 'display';

/** Grille construction. */
export type MusicGrilleKind = 'grille-cloth' | 'slots' | 'perforated' | 'fabric-wrap' | 'horn';

/** Cable material. */
export type MusicCableKind = 'braid' | 'rubber' | 'coiled' | 'usb-c' | 'wireless';

/** Where the flex runs to. */
export type MusicCableRoute = 'wall-socket' | 'counter-edge' | 'floor-run' | 'coiled' | 'none';

/** Emissive features a device carries. */
export type MusicGlowPart = 'dial' | 'lamps' | 'tubes' | 'leds' | 'ring' | 'meters' | 'screen';

/** Companion props a device sits with. */
export type MusicAccessoryKind =
  | 'gramophone'
  | 'record-stack'
  | 'tape-stack'
  | 'cable-clutter'
  | 'phone-stand'
  | 'charging-pad'
  | 'speaker-cube';

/** Node namespace of the domain: every part is `music:<year>:<device>/<path>`. */
export const MUSIC_NODE_PREFIX = 'music:';

/** Part families every device must provide, used by the detail assertions. */
export const MUSIC_PART_FAMILIES = [
  'cabinet',
  'controls',
  'dial',
  'grille',
  'badge',
  'cable',
  'glow',
  'wear',
  'support',
] as const;

export type MusicPartFamily = (typeof MUSIC_PART_FAMILIES)[number];

/** Node name of a built device group. */
export function musicDeviceNodeName(year: YearId, deviceId: string): string {
  return `${MUSIC_NODE_PREFIX}${year}:${deviceId}`;
}

/** Node name of the module's single group. */
export const MUSIC_GROUP_NAME = 'music';

/* -------------------------------------------------------------------------- */
/* Era data shapes                                                            */
/* -------------------------------------------------------------------------- */

/** Colours one era's device is painted in. */
export interface MusicDevicePalette {
  /** Cabinet body. */
  readonly body: string;
  /** Darker body tone: plinths, seams, recesses. */
  readonly bodyDark: string;
  /** Trim metal or lacquer colour. */
  readonly trim: string;
  /** Accent (badges, keypad legends, indicator colour). */
  readonly accent: string;
  /** Grille cloth base. */
  readonly cloth: string;
  /** Grille cloth pattern / perforation colour. */
  readonly grille: string;
  /** Dial face or screen background. */
  readonly dial: string;
  /** Emissive glow colour. */
  readonly glow: string;
  /** Model plate substrate. */
  readonly badgePlate: string;
  /** Model plate ink. */
  readonly badgeInk: string;
  /** Cable jacket colour. */
  readonly cable: string;
}

export interface MusicCabinetSpec {
  readonly material: MusicCabinetMaterial;
  /** Prose description of the joinery, surfaced by the hotspot. */
  readonly joinery: string;
  /** How the finish wears after decades of use. */
  readonly finish: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly plinthHeight: number;
  /** Visible corner blocks (dovetail / screwed batten detail). */
  readonly cornerBlocks: number;
  /** 0 = plinth base, otherwise the number of separate feet. */
  readonly feet: number;
}

export interface MusicControlSpec {
  readonly kind: MusicControlKind;
  readonly count: number;
  /** Legends stamped on the controls, front to back. */
  readonly labels: readonly string[];
  /** How the controls are worn (polished edges, cracked knurling). */
  readonly wear: string;
}

export interface MusicDialSpec {
  readonly kind: MusicDialKind;
  /** Scale ticks or screen lines, top to bottom. */
  readonly scale: readonly string[];
  readonly glowColor: string;
  readonly glowIntensity: number;
  /** Fraction of the scale the needle sits at when the set is playing. */
  readonly needlePosition: number;
}

export interface MusicGrilleSpec {
  readonly kind: MusicGrilleKind;
  readonly columns: number;
  readonly rows: number;
  /** Weave description (surfaced by the hotspot). */
  readonly weave: string;
  readonly cloth: string;
  /** Speaker cones visible through or in front of the grille. */
  readonly coneCount: number;
}

export interface MusicSpeakerSpec {
  readonly coneDiameter: number;
  readonly coneCount: number;
  /** Cone and dust-cap condition. */
  readonly dust: string;
}

export interface MusicCableSpec {
  readonly kind: MusicCableKind;
  readonly route: MusicCableRoute;
  /** Cable gauge in millimetres, for the geometry radius. */
  readonly gauge: number;
  readonly plug: string;
  /** Extra coils drawn into the run (cable clutter). */
  readonly coils: number;
}

export interface MusicGlowSpec {
  readonly color: string;
  readonly intensity: number;
  /** Pulse depth 0..1; 0 leaves the glow steady. */
  readonly pulse: number;
  readonly parts: readonly MusicGlowPart[];
}

export interface MusicAccessorySpec {
  readonly kind: MusicAccessoryKind;
  readonly label: string;
  readonly count: number;
  /** Layout hint: where the prop sits relative to the device. */
  readonly side: 'left' | 'right' | 'top' | 'front' | 'floor';
  readonly detail: string;
}

export interface MusicPlacementSpec {
  readonly kind: MusicPlacementKind;
  readonly zone: MusicPlacementZone;
  /** Height of the surface the device rests on (shelf, counter or ledge top). */
  readonly surfaceHeight: number;
  /** Length of shelf / ledge the device and its companions need, in metres. */
  readonly supportLength: number;
  /** Nudge along the wall or counter, in metres. */
  readonly alongOffset?: number;
  readonly description: string;
}

/**
 * One era's playback device. Device data is the only thing that changes per
 * year; the geometry builder and programme routing are shared.
 */
export interface MusicDeviceSpec {
  readonly year: YearId;
  readonly deviceId: string;
  readonly kind: MusicDeviceKind;
  readonly name: string;
  readonly maker: string;
  readonly model: string;
  /** Lines stamped on the model plate: brand, then model / year. */
  readonly nameplate: readonly string[];
  readonly caption: string;
  readonly palette: MusicDevicePalette;
  readonly cabinet: MusicCabinetSpec;
  readonly controls: MusicControlSpec;
  readonly dial: MusicDialSpec;
  readonly grille: MusicGrilleSpec;
  readonly speaker: MusicSpeakerSpec;
  readonly cable: MusicCableSpec;
  readonly glow: MusicGlowSpec;
  readonly accessories: readonly MusicAccessorySpec[];
  readonly placement: MusicPlacementSpec;
  /** Id of the music programme this device plays (`./programs`). */
  readonly programId: string;
  /** Physical wear the inspector should be able to see up close. */
  readonly wear: readonly string[];
  readonly label?: string;
  readonly tags?: readonly string[];
  readonly notes?: readonly string[];
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                  */
/* -------------------------------------------------------------------------- */

export interface MusicPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MusicPlacementSupport {
  readonly kind: 'shelf' | 'ledge' | 'counter' | 'floor';
  /** Extent along the wall / counter. */
  readonly length: number;
  readonly depth: number;
  readonly height: number;
}

export interface MusicDevicePlacement {
  readonly kind: MusicPlacementKind;
  readonly zone: MusicPlacementZone;
  /** Base centre of the device group, world space. */
  readonly position: MusicPoint;
  /** Rotation about Y applied to the device group (its front faces the room). */
  readonly rotationY: number;
  /** Height of the surface the device stands on. */
  readonly surfaceHeight: number;
  /** Support the module builds under the device, or `null` for a floor stand. */
  readonly support: MusicPlacementSupport | null;
  /** Wall socket the flex runs to. */
  readonly socket: MusicPoint;
  /** Inward normal of the wall behind the device. */
  readonly wallNormal: { readonly x: number; readonly z: number };
  readonly description: string;
}

/**
 * Derives where the era's device stands from the room bounds and the shared
 * structural layout (counter zone and walls). Devices face the room, so a shelf
 * on the left wall faces +X, a floor cabinet on the right wall faces -X, and
 * something parked on a counter end faces back along the counter toward the
 * tables.
 */
export function musicDevicePlacement(
  spec: MusicDeviceSpec,
  bounds: { readonly width: number; readonly depth: number; readonly height: number },
  layout: StructuralLayout,
): MusicDevicePlacement {
  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  const { cabinet, placement } = spec;
  const along = placement.alongOffset ?? 0;
  const supportDepth = Math.max(cabinet.depth + 0.08, 0.26);
  const supportLength = Math.max(placement.supportLength, cabinet.width + 0.2);

  switch (placement.zone) {
    case 'left-wall': {
      const x = -halfWidth + supportDepth / 2 + 0.02;
      const z = halfDepth - 1.05 + along;
      return {
        kind: 'wall-shelf',
        zone: placement.zone,
        position: { x, y: placement.surfaceHeight, z },
        rotationY: Math.PI / 2,
        surfaceHeight: placement.surfaceHeight,
        support: {
          kind: 'shelf',
          length: supportLength,
          depth: supportDepth,
          height: 0.035,
        },
        socket: { x: -halfWidth + 0.03, y: 0.3, z: z + 0.42 },
        wallNormal: { x: 1, z: 0 },
        description: placement.description,
      };
    }
    case 'right-wall': {
      const x = halfWidth - supportDepth / 2 - 0.04;
      const z = 0.9 + along;
      return {
        kind: 'wall-floor',
        zone: placement.zone,
        position: { x, y: 0, z },
        rotationY: -Math.PI / 2,
        surfaceHeight: 0,
        support: null,
        socket: { x: halfWidth - 0.03, y: 0.3, z: z + 0.62 },
        wallNormal: { x: -1, z: 0 },
        description: placement.description,
      };
    }
    case 'counter-left':
    case 'counter-right': {
      const counter = layout.counter;
      const sign = placement.zone === 'counter-left' ? -1 : 1;
      const x = sign * (counter.width / 2 - 0.06 - cabinet.depth / 2);
      const z = counter.center.z + along;
      return {
        kind: 'counter-top',
        zone: placement.zone,
        position: { x, y: counter.surfaceHeight, z },
        rotationY: sign < 0 ? Math.PI / 2 : -Math.PI / 2,
        surfaceHeight: counter.surfaceHeight,
        support: {
          kind: 'counter',
          length: supportLength,
          depth: supportDepth,
          height: counter.surfaceHeight,
        },
        socket: { x: x * 0.78, y: 0.32, z: counter.backFaceZ + 0.06 },
        wallNormal: { x: 0, z: 1 },
        description: placement.description,
      };
    }
    case 'storefront-right': {
      const x = halfWidth - supportDepth / 2 - 0.02;
      const z = halfDepth - 1.0 + along;
      return {
        kind: 'storefront-ledge',
        zone: placement.zone,
        position: { x, y: placement.surfaceHeight, z },
        rotationY: -Math.PI / 2,
        surfaceHeight: placement.surfaceHeight,
        support: {
          kind: 'ledge',
          length: supportLength,
          depth: supportDepth,
          height: 0.04,
        },
        socket: { x: halfWidth - 0.03, y: 0.3, z: z - 0.5 },
        wallNormal: { x: -1, z: 0 },
        description: placement.description,
      };
    }
  }
}

/** Transforms a world point into the device group's local frame. */
export function toDeviceLocal(placement: MusicDevicePlacement, point: MusicPoint): [number, number, number] {
  const dx = point.x - placement.position.x;
  const dz = point.z - placement.position.z;
  const cos = Math.cos(placement.rotationY);
  const sin = Math.sin(placement.rotationY);
  return [dx * cos - dz * sin, point.y - placement.position.y, dx * sin + dz * cos];
}

/**
 * World-space control points of the era's cable run: out of the back of the
 * cabinet, over the shelf / counter edge, down the wall to the socket.
 */
export function musicCableRoute(
  spec: MusicDeviceSpec,
  placement: MusicDevicePlacement,
  bounds: { readonly width: number; readonly depth: number; readonly height: number },
  layout: StructuralLayout,
): readonly MusicPoint[] {
  if (spec.cable.route === 'none') return [];
  const halfDepth = bounds.depth / 2;
  const backX = -Math.sin(placement.rotationY);
  const backZ = -Math.cos(placement.rotationY);
  const startY = placement.position.y + spec.cabinet.height * 0.55;
  const start: MusicPoint = {
    x: placement.position.x + backX * (spec.cabinet.depth / 2 - 0.02),
    y: startY,
    z: placement.position.z + backZ * (spec.cabinet.depth / 2 - 0.02),
  };
  const points: MusicPoint[] = [start];

  switch (spec.cable.route) {
    case 'wall-socket': {
      // Down the *room* face of the wall: the run never crosses into the wall.
      const faceX = placement.socket.x + placement.wallNormal.x * 0.03;
      points.push({ x: faceX, y: start.y - 0.18, z: start.z });
      points.push({ x: faceX, y: 0.82, z: placement.socket.z });
      points.push({ x: placement.socket.x, y: 0.42, z: placement.socket.z });
      points.push(placement.socket);
      break;
    }
    case 'counter-edge': {
      const counter = layout.counter;
      points.push({ x: start.x, y: start.y, z: start.z + backZ * 0.08 });
      points.push({ x: start.x, y: counter.surfaceHeight + 0.02, z: counter.backFaceZ + 0.16 });
      points.push({ x: start.x, y: 0.7, z: -halfDepth + 0.1 });
      points.push(placement.socket);
      break;
    }
    case 'floor-run': {
      const skirtingZ = start.z + backZ * 0.12;
      // The flex lies along the skirting; the control points stay clear of the
      // floor so the spline's own dip never clips through it.
      points.push({ x: start.x + backX * 0.06, y: 0.3, z: skirtingZ });
      points.push({ x: start.x + backX * 0.04, y: 0.1, z: skirtingZ });
      points.push({ x: placement.socket.x + placement.wallNormal.x * 0.12, y: 0.1, z: placement.socket.z });
      points.push(placement.socket);
      break;
    }
    case 'coiled': {
      // The coil sits on whatever the device stands on (counter or ledge), then
      // the lead drops to the socket.
      const centre: MusicPoint = {
        x: placement.position.x,
        y: placement.position.y + 0.012,
        z: placement.position.z - backZ * 0.16,
      };
      const loops = Math.max(spec.cable.coils, 1);
      for (let index = 0; index < loops; index += 1) {
        const angle = (index / loops) * Math.PI * 2;
        points.push({
          x: centre.x + Math.cos(angle) * 0.075,
          y: centre.y + 0.012,
          z: centre.z + Math.sin(angle) * 0.075,
        });
      }
      points.push({ x: start.x, y: placement.surfaceHeight + 0.01, z: start.z });
      points.push({ x: placement.socket.x + placement.wallNormal.x * 0.06, y: 0.78, z: placement.socket.z });
      points.push(placement.socket);
      break;
    }
  }
  return points;
}

/* -------------------------------------------------------------------------- */
/* Animation                                                                  */
/* -------------------------------------------------------------------------- */

export type MusicAnimationKind = 'needle' | 'reel' | 'turntable' | 'glow' | 'cone' | 'meter';

export interface MusicAnimation {
  readonly name: string;
  readonly kind: MusicAnimationKind;
  readonly node: THREE.Object3D;
  readonly axis: 'x' | 'y' | 'z';
  /** Rest pose the part holds at phase 0. */
  readonly base: number;
  readonly amplitude: number;
  /** Cycles per second (or radians per second for rotation kinds). */
  readonly rate: number;
  readonly material?: THREE.MeshStandardMaterial;
  /** Emissive intensity the glow part rests at. */
  readonly intensity?: number;
}

function writeAxis(node: THREE.Object3D, axis: 'x' | 'y' | 'z', value: number): void {
  if (axis === 'x') node.rotation.x = value;
  else if (axis === 'y') node.rotation.y = value;
  else node.rotation.z = value;
}

/**
 * Advances every animated part of a device.
 *
 * `phase` accumulates seconds while the device is live; `deltaSeconds` drives the
 * continuous rotations (reels, turntables). When `reducedMotion` is set the parts
 * are parked at their rest pose and nothing moves — the scene still reads as
 * "playing", it just never pulses at the viewer.
 */
export function advanceMusicAnimations(
  animations: readonly MusicAnimation[],
  phase: number,
  deltaSeconds: number,
  reducedMotion: boolean,
): void {
  const delta = Number.isFinite(deltaSeconds) ? Math.max(deltaSeconds, 0) : 0;
  for (const animation of animations) {
    switch (animation.kind) {
      case 'needle':
      case 'meter': {
        const swing = reducedMotion
          ? 0
          : Math.sin(phase * Math.PI * 2 * animation.rate) * animation.amplitude;
        writeAxis(animation.node, animation.axis, animation.base + swing);
        break;
      }
      case 'reel':
      case 'turntable': {
        const spin = reducedMotion ? 0 : (phase + delta) * animation.rate;
        writeAxis(animation.node, animation.axis, animation.base + spin);
        break;
      }
      case 'cone': {
        const excursion = reducedMotion
          ? 0
          : Math.sin(phase * Math.PI * 2 * animation.rate) * animation.amplitude;
        if (animation.axis === 'x') animation.node.position.x = animation.base + excursion;
        else if (animation.axis === 'y') animation.node.position.y = animation.base + excursion;
        else animation.node.position.z = animation.base + excursion;
        break;
      }
      case 'glow': {
        const material = animation.material;
        if (!material) break;
        const intensity = animation.intensity ?? material.emissiveIntensity;
        const depth = animation.amplitude;
        const pulse = reducedMotion
          ? 1
          : 1 - depth * 0.5 + Math.sin(phase * Math.PI * 2 * animation.rate) * depth * 0.5;
        material.emissiveIntensity = Math.max(intensity * pulse, 0);
        break;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Materials                                                                  */
/* -------------------------------------------------------------------------- */

export type MusicMaterialKey =
  | 'cabinet'
  | 'cabinet-dark'
  | 'trim'
  | 'chrome'
  | 'brass'
  | 'dial'
  | 'display'
  | 'grille'
  | 'cone'
  | 'vinyl'
  | 'tape'
  | 'cable'
  | 'rubber'
  | 'glass'
  | 'badge'
  | 'keypad'
  | 'wrap'
  | 'wear'
  | 'emissive'
  | 'meter';

export interface MusicDeviceBuildOptions {
  readonly bounds: { readonly width: number; readonly depth: number; readonly height: number };
  readonly layout: StructuralLayout;
  readonly canvasFactory?: CanvasFactory;
  readonly textureSize?: number;
  readonly seed?: number;
}

export interface BuiltMusicDevice {
  readonly spec: MusicDeviceSpec;
  readonly placement: MusicDevicePlacement;
  readonly nodeName: string;
  readonly group: THREE.Group;
  readonly parts: ReadonlyMap<string, THREE.Object3D>;
  readonly animations: readonly MusicAnimation[];
  readonly geometries: readonly THREE.BufferGeometry[];
  readonly materials: readonly THREE.Material[];
  readonly textures: readonly THREE.Texture[];
  readonly meshCount: number;
  readonly accessoryLabels: readonly string[];
}

interface MeshOptions {
  readonly rotation?: readonly [number, number, number];
  readonly radialSegments?: number;
  readonly openEnded?: boolean;
  readonly thetaStart?: number;
  readonly thetaLength?: number;
}

function cabinetFinishKind(material: MusicCabinetMaterial): MusicTextureKind {
  return material;
}

function textureSizeFor(kind: MusicTextureKind, requested: number | undefined): number {
  const base = requested ?? 96;
  if (kind === 'dial-glass' || kind === 'dial-led' || kind === 'display' || kind === 'badge') {
    return Math.max(base, 128);
  }
  return base;
}

/**
 * Builder handed to each device constructor. It owns the group, the material and
 * texture caches, the registered parts and the disposal lists, and exposes the
 * handful of primitives the devices are assembled from.
 */
export class MusicDeviceBuilder {
  readonly group = new THREE.Group();
  readonly parts = new Map<string, THREE.Object3D>();
  readonly animations: MusicAnimation[] = [];
  readonly geometries: THREE.BufferGeometry[] = [];
  readonly materials: THREE.Material[] = [];
  readonly textures: THREE.Texture[] = [];
  readonly random: () => number;
  private readonly materialCache = new Map<MusicMaterialKey, THREE.MeshStandardMaterial>();

  constructor(
    readonly spec: MusicDeviceSpec,
    readonly placement: MusicDevicePlacement,
    readonly options: MusicDeviceBuildOptions,
  ) {
    this.group.name = musicDeviceNodeName(spec.year, spec.deviceId);
    this.group.userData = {
      music: { year: spec.year, deviceId: spec.deviceId, kind: spec.kind },
    };
    this.random = createSeededRandom(
      options.seed ?? hashString(`${spec.year}:${spec.deviceId}`),
    );
  }

  /* -- materials and textures --------------------------------------------- */

  private paint(
    kind: MusicTextureKind,
    key: string,
    style: {
      base: string;
      accent: string;
      detail?: string;
      highlight?: string;
      text?: string;
      subText?: string;
      lines?: readonly string[];
      scale?: number;
      repeat?: readonly [number, number];
    },
  ): THREE.Texture {
    const size = textureSizeFor(kind, this.options.textureSize);
    const created = createMusicTexture(
      { kind, size, ...style },
      { key, canvasFactory: this.options.canvasFactory },
    );
    this.textures.push(created.texture);
    return created.texture;
  }

  private make(
    key: MusicMaterialKey,
    parameters: THREE.MeshStandardMaterialParameters,
    texture?: THREE.Texture,
  ): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial(parameters);
    if (texture) material.map = texture;
    material.name = `${this.spec.deviceId}:${key}`;
    this.materials.push(material);
    this.materialCache.set(key, material);
    return material;
  }

  /** Material for `key`, created once and shared by every part that wants it. */
  material(key: MusicMaterialKey): THREE.MeshStandardMaterial {
    const cached = this.materialCache.get(key);
    if (cached) return cached;
    const { palette, cabinet, grille, dial, glow, cable } = this.spec;
    const metalTrim = !(
      cabinet.material === 'veneer' ||
      cabinet.material === 'bakelite' ||
      cabinet.material === 'rexine'
    );
    switch (key) {
      case 'cabinet': {
        const texture = this.paint(cabinetFinishKind(cabinet.material), 'cabinet', {
          base: palette.body,
          accent: palette.bodyDark,
          detail: palette.bodyDark,
          highlight: palette.trim,
          scale: cabinet.material === 'veneer' ? 7 : 5,
          repeat: [2, 2],
        });
        return this.make(
          key,
          {
            color: 0xffffff,
            roughness: cabinet.material === 'aluminium' ? 0.42 : 0.62,
            metalness: cabinet.material === 'aluminium' ? 0.8 : 0.06,
          },
          texture,
        );
      }
      case 'cabinet-dark':
        return this.make(key, { color: palette.bodyDark, roughness: 0.72, metalness: 0.08 });
      case 'trim':
        return this.make(
          key,
          {
            color: palette.trim,
            roughness: metalTrim ? 0.26 : 0.45,
            metalness: metalTrim ? 0.85 : 0.15,
          },
        );
      case 'chrome':
        return this.make(key, { color: '#e6ebef', roughness: 0.16, metalness: 1 });
      case 'brass':
        return this.make(key, { color: palette.accent, roughness: 0.32, metalness: 0.9 });
      case 'dial': {
        const kind: MusicTextureKind =
          dial.kind === 'display' ? 'display' : dial.kind === 'dial-led' ? 'dial-led' : 'dial-glass';
        const texture = this.paint(kind, 'dial', {
          base: palette.dial,
          accent: palette.glow,
          detail: palette.bodyDark,
          highlight: palette.trim,
          text: palette.badgeInk,
          subText: palette.bodyDark,
          lines: dial.scale,
          scale: 5,
        });
        return this.make(
          key,
          {
            color: 0xffffff,
            roughness: 0.22,
            metalness: 0.06,
            emissive: new THREE.Color(glow.color),
            emissiveIntensity: dial.glowIntensity * 0.55,
            emissiveMap: texture,
          },
          texture,
        );
      }
      case 'display': {
        const texture = this.paint('display', 'display', {
          base: palette.dial,
          accent: palette.glow,
          detail: palette.bodyDark,
          highlight: palette.trim,
          text: palette.trim,
          subText: palette.accent,
          lines: dial.scale,
          scale: 6,
        });
        return this.make(
          key,
          {
            color: 0xffffff,
            roughness: 0.18,
            metalness: 0.05,
            emissive: new THREE.Color(glow.color),
            emissiveIntensity: glow.intensity,
            emissiveMap: texture,
          },
          texture,
        );
      }
      case 'grille': {
        const texture = this.paint('grille-cloth', 'grille', {
          base: grille.cloth,
          accent: palette.grille,
          detail: palette.bodyDark,
          highlight: palette.trim,
          scale: Math.max(Math.round(grille.columns / 2), 4),
          repeat: [2, 2],
        });
        return this.make(key, { color: 0xffffff, roughness: 0.95, metalness: 0.02 }, texture);
      }
      case 'cone': {
        const texture = this.paint('speaker-cone', 'cone', {
          base: palette.bodyDark,
          accent: palette.grille,
          detail: palette.body,
          highlight: palette.trim,
          scale: 5,
        });
        return this.make(key, { color: 0xffffff, roughness: 0.88, metalness: 0.03 }, texture);
      }
      case 'vinyl': {
        const texture = this.paint('record-label', 'vinyl', {
          base: '#191919',
          accent: palette.accent,
          detail: palette.body,
          text: palette.badgeInk,
          scale: 6,
        });
        return this.make(key, { color: 0xffffff, roughness: 0.3, metalness: 0.1 }, texture);
      }
      case 'tape': {
        const texture = this.paint('tape-label', 'tape', {
          base: palette.bodyDark,
          accent: palette.accent,
          detail: palette.body,
          highlight: palette.trim,
          text: palette.badgeInk,
          subText: palette.accent,
          lines: ['MIX TAPE'],
        });
        return this.make(key, { color: 0xffffff, roughness: 0.55, metalness: 0.05 }, texture);
      }
      case 'cable': {
        const kind: MusicTextureKind = cable.kind === 'usb-c' ? 'plastic' : 'cable-braid';
        const texture = this.paint(kind, 'cable', {
          base: palette.cable,
          accent: palette.bodyDark,
          detail: palette.bodyDark,
          highlight: palette.trim,
          scale: 4,
        });
        return this.make(key, { color: 0xffffff, roughness: 0.85, metalness: 0.05 }, texture);
      }
      case 'rubber':
        return this.make(key, { color: palette.bodyDark, roughness: 0.96, metalness: 0 });
      case 'glass':
        return this.make(key, {
          color: '#dfe8ee',
          roughness: 0.06,
          metalness: 0.12,
          transparent: true,
          opacity: 0.32,
        });
      case 'badge': {
        const texture = this.paint('badge', 'badge', {
          base: palette.badgePlate,
          accent: palette.bodyDark,
          detail: palette.bodyDark,
          highlight: palette.trim,
          text: palette.badgeInk,
          subText: palette.badgeInk,
          lines: this.spec.nameplate,
        });
        return this.make(
          key,
          {
            color: 0xffffff,
            roughness: 0.3,
            metalness: 0.72,
            transparent: true,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          },
          texture,
        );
      }
      case 'keypad': {
        const texture = this.paint('keypad', 'keypad', {
          base: palette.bodyDark,
          accent: palette.accent,
          detail: palette.body,
          highlight: palette.trim,
          text: palette.badgeInk,
          scale: 5,
        });
        return this.make(key, { color: 0xffffff, roughness: 0.35, metalness: 0.4 }, texture);
      }
      case 'wrap': {
        const texture = this.paint('fabric-wrap', 'wrap', {
          base: grille.cloth,
          accent: palette.grille,
          detail: palette.bodyDark,
          highlight: palette.trim,
          scale: 4,
          repeat: [2, 2],
        });
        return this.make(key, { color: 0xffffff, roughness: 0.96, metalness: 0.02 }, texture);
      }
      case 'wear': {
        const texture = this.paint('dust-film', 'wear', {
          base: palette.bodyDark,
          accent: palette.body,
          detail: palette.bodyDark,
          highlight: palette.trim,
          scale: 4,
        });
        return this.make(
          key,
          {
            color: 0xffffff,
            roughness: 1,
            metalness: 0,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
          },
          texture,
        );
      }
      case 'emissive':
        return this.make(key, {
          color: glow.color,
          emissive: new THREE.Color(glow.color),
          emissiveIntensity: glow.intensity,
          roughness: 0.35,
          metalness: 0.15,
        });
      case 'meter': {
        const texture = this.paint('dial-led', 'meter', {
          base: '#141414',
          accent: palette.glow,
          detail: palette.bodyDark,
          highlight: palette.trim,
          scale: 5,
        });
        return this.make(
          key,
          {
            color: 0xffffff,
            roughness: 0.3,
            metalness: 0.2,
            emissive: new THREE.Color(palette.glow),
            emissiveIntensity: glow.intensity * 0.8,
            emissiveMap: texture,
          },
          texture,
        );
      }
    }
  }

  /* -- primitives --------------------------------------------------------- */

  private register(path: string, object: THREE.Object3D, geometry?: THREE.BufferGeometry): void {
    if (geometry) this.geometries.push(geometry);
    object.name = path;
    object.userData = { ...object.userData, musicPart: path };
    this.parts.set(path, object);
    this.group.add(object);
  }

  box(
    path: string,
    width: number,
    height: number,
    depth: number,
    position: readonly [number, number, number],
    key: MusicMaterialKey,
    options: MeshOptions = {},
  ): THREE.Mesh {
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geometry, this.material(key));
    const [x = 0, y = 0, z = 0] = position;
    mesh.position.set(x, y, z);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    this.register(path, mesh, geometry);
    return mesh;
  }

  cylinder(
    path: string,
    radii: readonly [number, number],
    height: number,
    position: readonly [number, number, number],
    key: MusicMaterialKey,
    options: MeshOptions = {},
  ): THREE.Mesh {
    const [top = 0.05, bottom = top] = radii;
    const geometry = new THREE.CylinderGeometry(
      top,
      bottom,
      height,
      options.radialSegments ?? 20,
      1,
      options.openEnded ?? false,
      options.thetaStart ?? 0,
      options.thetaLength ?? Math.PI * 2,
    );
    const mesh = new THREE.Mesh(geometry, this.material(key));
    const [x = 0, y = 0, z = 0] = position;
    mesh.position.set(x, y, z);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    this.register(path, mesh, geometry);
    return mesh;
  }

  sphere(
    path: string,
    radius: number,
    position: readonly [number, number, number],
    key: MusicMaterialKey,
    options: MeshOptions = {},
  ): THREE.Mesh {
    const geometry = new THREE.SphereGeometry(radius, options.radialSegments ?? 16, 12);
    const mesh = new THREE.Mesh(geometry, this.material(key));
    const [x = 0, y = 0, z = 0] = position;
    mesh.position.set(x, y, z);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    this.register(path, mesh, geometry);
    return mesh;
  }

  torus(
    path: string,
    radius: number,
    tube: number,
    position: readonly [number, number, number],
    key: MusicMaterialKey,
    options: MeshOptions = {},
  ): THREE.Mesh {
    const geometry = new THREE.TorusGeometry(radius, tube, 10, options.radialSegments ?? 24);
    const mesh = new THREE.Mesh(geometry, this.material(key));
    const [x = 0, y = 0, z = 0] = position;
    mesh.position.set(x, y, z);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    this.register(path, mesh, geometry);
    return mesh;
  }

  plane(
    path: string,
    size: readonly [number, number],
    position: readonly [number, number, number],
    key: MusicMaterialKey,
    options: MeshOptions = {},
  ): THREE.Mesh {
    const [width = 0.1, height = 0.1] = size;
    const geometry = new THREE.PlaneGeometry(width, height);
    const mesh = new THREE.Mesh(geometry, this.material(key));
    const [x = 0, y = 0, z = 0] = position;
    mesh.position.set(x, y, z);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    this.register(path, mesh, geometry);
    return mesh;
  }

  /** Free-form tube: cable runs, carrying handles, tone arms, horns. */
  tube(
    path: string,
    points: readonly (readonly [number, number, number])[],
    radius: number,
    key: MusicMaterialKey,
    options: { readonly tubularSegments?: number; readonly radialSegments?: number } = {},
  ): THREE.Mesh | null {
    if (points.length < 2) return null;
    const curve = new THREE.CatmullRomCurve3(
      points.map((point) => new THREE.Vector3(point[0], point[1], point[2])),
    );
    const geometry = new THREE.TubeGeometry(
      curve,
      options.tubularSegments ?? Math.max(points.length * 6, 12),
      radius,
      options.radialSegments ?? 6,
      false,
    );
    const mesh = new THREE.Mesh(geometry, this.material(key));
    this.register(path, mesh, geometry);
    return mesh;
  }

  /** Registers a bare group as a named, animatable part (needle or reel pivot). */
  pivot(
    path: string,
    position: readonly [number, number, number],
    rotation?: readonly [number, number, number],
  ): THREE.Group {
    const group = new THREE.Group();
    const [x = 0, y = 0, z = 0] = position;
    group.position.set(x, y, z);
    if (rotation) group.rotation.set(...rotation);
    this.register(path, group);
    return group;
  }

  /** Adds a named mesh to an existing group (used with {@link pivot}). */
  child(
    parent: THREE.Object3D,
    path: string,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    key: MusicMaterialKey,
    options: MeshOptions = {},
  ): THREE.Mesh {
    const [width = 0.01, height = 0.01, depth = 0.01] = size;
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const mesh = new THREE.Mesh(geometry, this.material(key));
    const [x = 0, y = 0, z = 0] = position;
    mesh.position.set(x, y, z);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    mesh.name = path;
    mesh.userData = { musicPart: path };
    this.geometries.push(geometry);
    parent.add(mesh);
    this.parts.set(path, mesh);
    return mesh;
  }

  /** Registers a mesh built by a helper outside the primitive set. */
  adopt(path: string, object: THREE.Object3D, geometry?: THREE.BufferGeometry): THREE.Object3D {
    this.register(path, object, geometry);
    return object;
  }
}

/* -------------------------------------------------------------------------- */
/* Shared detail helpers                                                      */
/* -------------------------------------------------------------------------- */

/** Knurled control knob: body, gripping ring, index mark and spindle. */
function addKnob(
  builder: MusicDeviceBuilder,
  path: string,
  position: readonly [number, number, number],
  radius: number,
  key: MusicMaterialKey = 'chrome',
): void {
  const [x = 0, y = 0, z = 0] = position;
  const depth = radius * 1.1;
  builder.cylinder(path, [radius, radius * 0.94], depth, [x, y, z], key, {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 18,
  });
  builder.torus(`${path}-ring`, radius * 0.92, radius * 0.14, [x, y, z + depth * 0.4], 'cabinet-dark', {
    rotation: [Math.PI / 2, 0, 0],
  });
  builder.box(`${path}-index`, 0.003, radius * 0.7, 0.002, [x, y + radius * 0.62, z + depth * 0.55], 'badge');
  builder.cylinder(`${path}-spindle`, [radius * 0.32, radius * 0.32], 0.02, [x, y, z - depth], 'cabinet-dark', {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 10,
  });
}

/** Grille panel: frame, cloth or perforated face, and its drivers. */
function addGrille(
  builder: MusicDeviceBuilder,
  path: string,
  size: readonly [number, number],
  position: readonly [number, number, number],
  options: { readonly cones?: number; readonly coneRadius?: number; readonly rings?: boolean } = {},
): void {
  const [width = 0.2, height = 0.15] = size;
  const [x = 0, y = 0, z = 0] = position;
  const depth = 0.012;
  builder.box(`${path}.frame`, width, height, depth, [x, y, z], 'cabinet-dark');
  builder.plane(`${path}.cloth`, [width * 0.92, height * 0.88], [x, y, z + depth / 2 + 0.002], 'grille');
  // Perforated batten over the cloth, so the weave is caught by the key light.
  const columns = Math.max(Math.round(width / 0.02), 3);
  for (let index = 0; index < columns; index += 1) {
    const offset = (index / (columns - 1) - 0.5) * width * 0.9;
    builder.box(
      `${path}.batten-${index + 1}`,
      0.004,
      height * 0.86,
      0.006,
      [x + offset, y, z + depth / 2 + 0.004],
      'trim',
    );
  }
  const cones = options.cones ?? 1;
  const coneRadius = options.coneRadius ?? Math.min(height * 0.4, 0.09);
  for (let index = 0; index < cones; index += 1) {
    const spread = cones === 1 ? 0 : (index / (cones - 1) - 0.5) * width * 0.62;
    addSpeakerCone(builder, `${path}.cone-${index + 1}`, coneRadius, [x + spread, y, z + depth / 2 + 0.01], {
      rings: options.rings ?? true,
    });
  }
}

/** A speaker driver: cone, dust cap, surround and the animated excursion. */
function addSpeakerCone(
  builder: MusicDeviceBuilder,
  path: string,
  radius: number,
  position: readonly [number, number, number],
  options: { readonly axis?: 'y' | 'z'; readonly rings?: boolean } = {},
): void {
  const axis = options.axis ?? 'z';
  const [x = 0, y = 0, z = 0] = position;
  const rotation: [number, number, number] = axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  const at: [number, number, number] = [x, y, z];
  builder.cylinder(path, [radius, radius * 0.55], radius * 0.4, at, 'cone', {
    rotation,
    radialSegments: 22,
    openEnded: true,
  });
  builder.cylinder(`${path}-dust-cap`, [radius * 0.55, radius * 0.55], 0.006, [x, y, z], 'cone', {
    rotation,
    radialSegments: 18,
  });
  if (options.rings ?? true) {
    builder.torus(`${path}-surround`, radius * 1.02, radius * 0.09, [x, y, z], 'chrome', {
      rotation: axis === 'z' ? [Math.PI / 2, 0, 0] : [Math.PI / 2, 0, 0],
    });
  }
  const cone = builder.parts.get(path);
  if (cone) {
    builder.animations.push({
      name: `${path}-excursion`,
      kind: 'cone',
      node: cone,
      axis,
      base: axis === 'z' ? z : y,
      amplitude: radius * 0.05,
      rate: 2.4,
    });
  }
}

/** Model plate: badge decal plus its two retaining screws. */
function addBadgePlate(
  builder: MusicDeviceBuilder,
  path: string,
  size: readonly [number, number],
  position: readonly [number, number, number],
  options: MeshOptions = {},
): void {
  const [width = 0.14, height = 0.045] = size;
  const [x = 0, y = 0, z = 0] = position;
  builder.plane(`${path}.plate`, [width, height], [x, y, z], 'badge', options);
  builder.sphere(`${path}.screw-1`, 0.0035, [x - width / 2 + 0.006, y, z + 0.001], 'chrome');
  builder.sphere(`${path}.screw-2`, 0.0035, [x + width / 2 - 0.006, y, z + 0.001], 'chrome');
}

/** Dust film and scuff decals, so the inspector sees age at close range. */
function addWearDecals(builder: MusicDeviceBuilder, spec: MusicDeviceSpec): void {
  const { width, height, depth } = spec.cabinet;
  builder.plane('wear.dust', [width * 0.9, depth * 0.8], [0, height + 0.001, 0], 'wear', {
    rotation: [-Math.PI / 2, 0, 0],
  });
  builder.plane('wear.scuff', [width * 0.7, 0.03], [0, spec.cabinet.plinthHeight + 0.012, depth / 2 + 0.002], 'wear');
  builder.box('wear.chip', 0.02, 0.012, 0.004, [width * 0.32, height * 0.72, depth / 2 + 0.001], 'cabinet-dark');
  builder.box('wear.edge-1', 0.006, height * 0.9, 0.006, [width / 2 + 0.002, height * 0.5, depth / 2 - 0.02], 'cabinet-dark');
  builder.box('wear.edge-2', 0.006, height * 0.9, 0.006, [-width / 2 - 0.002, height * 0.5, depth / 2 - 0.02], 'cabinet-dark');
}

/** Plug and socket: body, pins, flex clamp and the socket plate. */
function addPlug(
  builder: MusicDeviceBuilder,
  path: string,
  at: readonly [number, number, number],
  rotationY: number,
): void {
  const [x = 0, y = 0, z = 0] = at;
  builder.box(`${path}.body`, 0.034, 0.028, 0.022, [x, y, z], 'cabinet-dark', {
    rotation: [0, rotationY, 0],
  });
  builder.cylinder(`${path}.pin-1`, [0.003, 0.003], 0.016, [x, y + 0.004, z], 'chrome', {
    rotation: [Math.PI / 2, 0, 0],
  });
  builder.cylinder(`${path}.pin-2`, [0.003, 0.003], 0.016, [x, y - 0.006, z], 'chrome', {
    rotation: [Math.PI / 2, 0, 0],
  });
  builder.box(`${path}.clamp`, 0.012, 0.014, 0.012, [x, y, z - 0.012], 'rubber');
  builder.box(`${path}.socket-plate`, 0.07, 0.07, 0.008, [x, y, z + 0.014], 'cabinet-dark');
}

/** Cable run from the cabinet to the socket, plus a strain-relief grommet. */
function addCableRun(
  builder: MusicDeviceBuilder,
  spec: MusicDeviceSpec,
  placement: MusicDevicePlacement,
  bounds: { readonly width: number; readonly depth: number; readonly height: number },
  layout: StructuralLayout,
): void {
  if (spec.cable.route === 'none') return;
  const world = musicCableRoute(spec, placement, bounds, layout);
  const points = world.map((point) => toDeviceLocal(placement, point));
  const radius = Math.max(spec.cable.gauge / 2000, 0.004);
  builder.tube('cable.run', points, radius, 'cable', { tubularSegments: Math.max(points.length * 8, 24) });
  builder.cylinder('cable.grommet', [radius * 2.1, radius * 2.1], 0.014, points[0] ?? [0, 0, 0], 'rubber', {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 12,
  });
  const last = points[points.length - 1];
  if (last) {
    addPlug(builder, 'cable.plug', last, placement.rotationY);
  }
  // A cable clip holds the run against the wall or the shelf edge.
  const middle = points[Math.floor(points.length / 2)];
  if (middle) {
    builder.box('cable.clip', 0.012, 0.008, 0.016, middle, 'rubber');
  }
}

/* -------------------------------------------------------------------------- */
/* Accessories                                                                */
/* -------------------------------------------------------------------------- */

/** Companion gramophone: turntable, tone arm, horn, crank and record sleeve. */
function addGramophone(builder: MusicDeviceBuilder, x: number): void {
  builder.box('accessory.gramophone.base', 0.4, 0.09, 0.34, [x, 0.045, 0], 'cabinet');
  builder.box('accessory.gramophone.plinth', 0.42, 0.02, 0.36, [x, 0.01, 0], 'cabinet-dark');
  const platter = builder.pivot('accessory.gramophone.platter', [x, 0.1, 0.01]);
  builder.child(platter, 'accessory.gramophone.platter-disc', [0.24, 0.02, 0.24], [0, 0, 0], 'rubber');
  builder.child(platter, 'accessory.gramophone.record', [0.23, 0.006, 0.23], [0, 0.013, 0], 'vinyl');
  builder.animations.push({
    name: 'gramophone-platter',
    kind: 'turntable',
    node: platter,
    axis: 'y',
    base: 0,
    amplitude: 0,
    rate: 0.6,
  });
  // Tone arm: bent tube over the disc.
  builder.tube(
    'accessory.gramophone.tone-arm',
    [
      [x + 0.13, 0.11, -0.1],
      [x + 0.09, 0.14, -0.02],
      [x + 0.02, 0.12, 0.03],
    ],
    0.006,
    'chrome',
  );
  builder.cylinder('accessory.gramophone.arm-base', [0.02, 0.024], 0.03, [x + 0.13, 0.115, -0.1], 'chrome', {
    radialSegments: 14,
  });
  // Horn: a flared tube rising from the back corner.
  builder.tube(
    'accessory.gramophone.horn',
    [
      [x - 0.1, 0.1, -0.12],
      [x - 0.2, 0.34, -0.14],
      [x - 0.3, 0.6, -0.12],
    ],
    0.02,
    'brass',
    { tubularSegments: 24, radialSegments: 12 },
  );
  builder.cylinder('accessory.gramophone.horn-mouth', [0.11, 0.02], 0.12, [x - 0.32, 0.66, -0.11], 'brass', {
    rotation: [0, 0, Math.PI / 2.6],
    radialSegments: 22,
    openEnded: true,
  });
  // Winding crank on the side.
  builder.tube(
    'accessory.gramophone.crank',
    [
      [x - 0.2, 0.05, 0.12],
      [x - 0.26, 0.05, 0.16],
      [x - 0.28, 0.02, 0.2],
    ],
    0.005,
    'chrome',
  );
  // 78s waiting their turn.
  addRecordStack(builder, 'accessory.gramophone.records', [x + 0.16, 0.09, 0.12], 3);
}

/** Leaning stack of shellac or vinyl records in their sleeves. */
function addRecordStack(
  builder: MusicDeviceBuilder,
  path: string,
  position: readonly [number, number, number],
  count: number,
): void {
  const [x = 0, y = 0, z = 0] = position;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 0.012;
    builder.box(`${path}-sleeve-${index + 1}`, 0.26, 0.26, 0.012, [x + offset, y + 0.13, z], 'cabinet', {
      rotation: [0, 0.12, -0.28],
    });
    builder.cylinder(`${path}-disc-${index + 1}`, [0.115, 0.115], 0.004, [x + offset, y + 0.16, z + 0.02], 'vinyl', {
      rotation: [Math.PI / 2, 0, -0.28],
      radialSegments: 26,
    });
  }
}

/** Spindle of cassette cases, spines out. */
function addTapeStack(
  builder: MusicDeviceBuilder,
  path: string,
  position: readonly [number, number, number],
  count: number,
): void {
  const [x = 0, y = 0, z = 0] = position;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 0.017;
    builder.box(`${path}-case-${index + 1}`, 0.11, 0.07, 0.016, [x + offset, y + 0.035, z], 'tape');
    builder.box(`${path}-spine-${index + 1}`, 0.108, 0.068, 0.002, [x + offset, y + 0.035, z + 0.009], 'trim');
  }
}

/** Cable clutter: coiled flexes, a power brick and a spare connector. */
function addCableClutter(
  builder: MusicDeviceBuilder,
  path: string,
  position: readonly [number, number, number],
  count: number,
): void {
  const [x = 0, y = 0, z = 0] = position;
  for (let index = 0; index < count; index += 1) {
    const centreX = x + index * 0.06;
    const points: [number, number, number][] = [];
    const loops = 3;
    for (let step = 0; step <= loops * 8; step += 1) {
      const angle = (step / 8) * Math.PI;
      points.push([
        centreX + Math.cos(angle) * 0.045,
        y + 0.006 + (step / (loops * 8)) * 0.012,
        z + Math.sin(angle) * 0.045,
      ]);
    }
    builder.tube(`${path}-coil-${index + 1}`, points, 0.0035, 'cable', { tubularSegments: 40, radialSegments: 6 });
  }
  builder.box(`${path}-brick`, 0.07, 0.03, 0.05, [x + 0.02, y + 0.015, z - 0.08], 'cabinet-dark');
  builder.tube(
    `${path}-brick-lead`,
    [
      [x + 0.02, y + 0.012, z - 0.055],
      [x + 0.05, y + 0.01, z - 0.02],
      [x + 0.08, y + 0.01, z + 0.02],
    ],
    0.003,
    'cable',
  );
}

/** Phone in a charging stand: body, screen, camera bump, stand and connector. */
function addPhoneStand(
  builder: MusicDeviceBuilder,
  position: readonly [number, number, number],
): void {
  const [x = 0, y = 0, z = 0] = position;
  const tilt = -0.22;
  builder.box('accessory.phone.stand', 0.09, 0.012, 0.07, [x, y + 0.006, z], 'cabinet-dark');
  builder.box('accessory.phone.stand-lip', 0.09, 0.02, 0.012, [x, y + 0.014, z + 0.028], 'cabinet-dark');
  builder.box('accessory.phone.body', 0.072, 0.15, 0.009, [x, y + 0.088, z - 0.004], 'cabinet-dark', {
    rotation: [tilt, 0, 0],
  });
  builder.plane('dial.screen', [0.062, 0.132], [x, y + 0.088, z + 0.002], 'display', {
    rotation: [tilt, 0, 0],
  });
  // Playback progress along the bottom of the screen.
  builder.plane('dial.progress-bar', [0.046, 0.006], [x, y + 0.036, z + 0.004], 'emissive', {
    rotation: [tilt, 0, 0],
  });
  for (let index = 0; index < 2; index += 1) {
    builder.cylinder(
      `accessory.phone.camera-${index + 1}`,
      [0.008, 0.008],
      0.004,
      [x - 0.018 + index * 0.02, y + 0.055, z - 0.01],
      'glass',
      { rotation: [Math.PI / 2, 0, 0], radialSegments: 14 },
    );
  }
  builder.cylinder('accessory.phone.connector', [0.004, 0.004], 0.012, [x, y + 0.02, z - 0.006], 'chrome', {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 10,
  });
  builder.tube(
    'accessory.phone.charge-cable',
    [
      [x, y + 0.02, z - 0.012],
      [x + 0.03, y + 0.012, z - 0.05],
      [x + 0.1, y + 0.01, z - 0.08],
    ],
    0.0028,
    'cable',
  );
}

/** Wireless charging pad: plate, coil ring and a lit indicator. */
function addChargingPad(
  builder: MusicDeviceBuilder,
  position: readonly [number, number, number],
): void {
  const [x = 0, y = 0, z = 0] = position;
  builder.cylinder('accessory.charging-pad.plate', [0.055, 0.06], 0.008, [x, y + 0.004, z], 'rubber', {
    radialSegments: 22,
  });
  builder.torus('accessory.charging-pad.ring', 0.04, 0.003, [x, y + 0.009, z], 'trim', {
    rotation: [Math.PI / 2, 0, 0],
  });
  const material = builder.material('emissive');
  builder.plane('accessory.charging-pad.indicator', [0.008, 0.008], [x, y + 0.009, z + 0.05], 'emissive', {
    rotation: [-Math.PI / 2, 0, 0],
  });
  builder.animations.push({
    name: 'charging-pad-glow',
    kind: 'glow',
    node: builder.group,
    axis: 'y',
    base: 0,
    amplitude: builder.spec.glow.pulse,
    rate: 0.5,
    material,
    intensity: builder.spec.glow.intensity,
  });
}

/** Compact speaker cube: body, wrap, driver and a lit foot. */
function addSpeakerCube(
  builder: MusicDeviceBuilder,
  path: string,
  position: readonly [number, number, number],
  size: number,
): void {
  const [x = 0, y = 0, z = 0] = position;
  builder.box(`${path}.body`, size, size, size * 0.86, [x, y + size / 2, z], 'cabinet');
  builder.plane(`${path}.wrap`, [size * 0.82, size * 0.82], [x, y + size / 2, z + size * 0.44], 'wrap');
  addSpeakerCone(builder, `${path}.cone-1`, size * 0.3, [x, y + size / 2, z + size * 0.5], { rings: true });
  builder.box(`${path}.foot`, size * 0.9, 0.006, size * 0.75, [x, y + 0.003, z], 'rubber');
  builder.sphere(`${path}.led`, 0.005, [x, y + 0.012, z + size * 0.45], 'emissive');
}

/* -------------------------------------------------------------------------- */
/* Devices                                                                    */
/* -------------------------------------------------------------------------- */

/** 1945: a wooden wireless set with its dial, plus the household gramophone. */
function buildWirelessSet(builder: MusicDeviceBuilder): void {
  const { width: w, height: h, depth: d, plinthHeight } = builder.spec.cabinet;
  const plinth = Math.max(plinthHeight, 0.03);
  builder.box('cabinet.plinth', w * 1.04, plinth, d * 1.04, [0, plinth / 2, 0], 'cabinet-dark');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      builder.box(
        `cabinet.corner-${sx < 0 ? 'l' : 'r'}${sz < 0 ? 'b' : 'f'}`,
        0.045,
        0.045,
        0.045,
        [sx * (w / 2 - 0.026), plinth + 0.026, sz * (d / 2 - 0.026)],
        'cabinet-dark',
      );
    }
  }
  builder.box('cabinet.body', w, h, d, [0, plinth + h / 2, 0], 'cabinet');
  builder.box('cabinet.moulding', w * 1.03, 0.026, d * 1.03, [0, plinth + h - 0.013, 0], 'cabinet-dark');
  builder.box('cabinet.rail-left', 0.014, h * 0.86, d * 0.96, [-w / 2 - 0.006, plinth + h * 0.46, 0], 'trim');
  builder.box('cabinet.rail-right', 0.014, h * 0.86, d * 0.96, [w / 2 + 0.006, plinth + h * 0.46, 0], 'trim');
  builder.box('cabinet.back', w * 0.94, h * 0.9, 0.01, [0, plinth + h * 0.47, -d / 2 - 0.004], 'cabinet-dark');

  // Dial glass with its bezel, needle and tuning eye.
  const dialY = plinth + h * 0.72;
  builder.box('dial.bezel', w * 0.78, h * 0.3, 0.02, [0, dialY, d / 2 + 0.008], 'trim');
  builder.plane('dial.glass', [w * 0.72, h * 0.26], [0, dialY, d / 2 + 0.02], 'dial');
  builder.plane('dial.glass-cover', [w * 0.74, h * 0.28], [0, dialY, d / 2 + 0.024], 'glass');
  const needle = builder.pivot('dial.needle', [0, dialY - 0.05, d / 2 + 0.028]);
  builder.child(needle, 'dial.needle-blade', [0.004, 0.11, 0.003], [0, 0.055, 0], 'badge');
  builder.child(needle, 'dial.needle-hub', [0.014, 0.014, 0.006], [0, 0, 0], 'chrome');
  builder.animations.push({
    name: 'dial-needle',
    kind: 'needle',
    node: needle,
    axis: 'z',
    base: (builder.spec.dial.needlePosition - 0.5) * 0.9,
    amplitude: 0.08,
    rate: 0.18,
  });
  builder.sphere('glow.tuning-eye', 0.016, [0, dialY + h * 0.19, d / 2 + 0.014], 'emissive');
  const glowMaterial = builder.material('emissive');
  builder.animations.push({
    name: 'tuning-eye',
    kind: 'glow',
    node: builder.group,
    axis: 'y',
    base: 0,
    amplitude: builder.spec.glow.pulse,
    rate: 0.7,
    material: glowMaterial,
    intensity: builder.spec.glow.intensity,
  });
  builder.box('glow.lamp', w * 0.6, 0.01, 0.01, [0, dialY - h * 0.16, d / 2 + 0.012], 'emissive');

  // Grille: cloth over two drivers.
  addGrille(builder, 'grille', [w * 0.82, h * 0.32], [0, plinth + h * 0.22, d / 2 + 0.006], {
    cones: builder.spec.speaker.coneCount,
    coneRadius: Math.min(builder.spec.speaker.coneDiameter / 2, 0.075),
  });

  // Controls: three knobs, a band switch and a tone/volume legend plate.
  addKnob(builder, 'controls.knob-1', [-0.18, plinth + h * 0.48, d / 2 + 0.012], 0.024, 'cabinet-dark');
  addKnob(builder, 'controls.knob-2', [0, plinth + h * 0.48, d / 2 + 0.012], 0.024, 'cabinet-dark');
  addKnob(builder, 'controls.knob-3', [0.18, plinth + h * 0.48, d / 2 + 0.012], 0.024, 'cabinet-dark');
  builder.box('controls.switch', 0.03, 0.012, 0.012, [-w * 0.3, plinth + h * 0.36, d / 2 + 0.01], 'chrome');
  for (let index = 0; index < builder.spec.controls.labels.length; index += 1) {
    builder.plane(
      `controls.label-${index + 1}`,
      [0.05, 0.012],
      [(index - 1) * 0.11, plinth + h * 0.36, d / 2 + 0.008],
      'badge',
    );
  }
  addBadgePlate(builder, 'badge', [0.17, 0.04], [0, plinth + h * 0.92, d / 2 + 0.01]);
}

/** 1965: a floor-standing jukebox with bubble tubes and a selector keypad. */
function buildJukebox(builder: MusicDeviceBuilder): void {
  const { width: w, height: h, depth: d } = builder.spec.cabinet;
  const archRadius = w / 2;
  const archBase = h - archRadius;
  const bodyBase = 0.14;
  builder.box('cabinet.plinth', w * 1.02, 0.1, d * 1.02, [0, 0.11, 0], 'cabinet-dark');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      builder.cylinder(
        `cabinet.foot-${sx < 0 ? 'l' : 'r'}${sz < 0 ? 'b' : 'f'}`,
        [0.03, 0.034],
        0.12,
        [sx * (w / 2 - 0.08), 0.06, sz * (d / 2 - 0.09)],
        'chrome',
        { radialSegments: 12 },
      );
    }
  }
  builder.box('cabinet.body', w, archBase - bodyBase, d, [0, bodyBase + (archBase - bodyBase) / 2, 0], 'cabinet');
  // Arched top: quarter shells front and back, closed with half discs.
  builder.cylinder(
    'cabinet.arch',
    [archRadius, archRadius],
    d,
    [0, archBase, 0],
    'cabinet',
    {
      rotation: [-Math.PI / 2, 0, 0],
      thetaStart: -Math.PI / 2,
      thetaLength: Math.PI,
      openEnded: true,
      radialSegments: 26,
    },
  );
  builder.cylinder(
    'cabinet.arch-cap-front',
    [archRadius, archRadius],
    0.02,
    [0, archBase, d / 2 - 0.01],
    'cabinet-dark',
    {
      rotation: [-Math.PI / 2, 0, 0],
      thetaStart: -Math.PI / 2,
      thetaLength: Math.PI,
      openEnded: true,
      radialSegments: 26,
    },
  );
  builder.cylinder(
    'cabinet.arch-cap-back',
    [archRadius, archRadius],
    0.02,
    [0, archBase, -d / 2 + 0.01],
    'cabinet-dark',
    {
      rotation: [-Math.PI / 2, 0, 0],
      thetaStart: -Math.PI / 2,
      thetaLength: Math.PI,
      openEnded: true,
      radialSegments: 26,
    },
  );
  builder.box('cabinet.moulding', w * 1.03, 0.02, d * 1.03, [0, archBase - 0.01, 0], 'chrome');
  for (const sx of [-1, 1]) {
    builder.box(`cabinet.rail-${sx < 0 ? 'left' : 'right'}`, 0.018, archBase - bodyBase, d * 0.98, [sx * (w / 2 + 0.004), bodyBase + (archBase - bodyBase) / 2, 0], 'cabinet-dark');
  }

  // Bubble tubes: the light columns either side of the window.
  for (const sx of [-1, 1]) {
    builder.cylinder(
      `glow.tube-${sx < 0 ? 'left' : 'right'}`,
      [0.022, 0.022],
      0.72,
      [sx * (w / 2 - 0.05), 0.62, d / 2 + 0.012],
      'emissive',
      { radialSegments: 14 },
    );
    builder.cylinder(
      `glow.tube-trim-${sx < 0 ? 'left' : 'right'}`,
      [0.026, 0.026],
      0.74,
      [sx * (w / 2 - 0.05), 0.62, d / 2 + 0.006],
      'chrome',
      { radialSegments: 14, openEnded: true },
    );
  }
  const glowMaterial = builder.material('emissive');
  builder.animations.push({
    name: 'bubble-tubes',
    kind: 'glow',
    node: builder.group,
    axis: 'y',
    base: 0,
    amplitude: builder.spec.glow.pulse,
    rate: 0.22,
    material: glowMaterial,
    intensity: builder.spec.glow.intensity,
  });

  // Record window: glass over the revolving record stack.
  builder.box('cabinet.window-frame', w * 0.6, 0.36, 0.02, [0, 1.02, d / 2 + 0.006], 'chrome');
  builder.plane('dial.glass', [w * 0.54, 0.3], [0, 1.02, d / 2 + 0.02], 'glass');
  const drum = builder.pivot('grille.record-drum', [0, 1.02, d / 2 - 0.02], [0, 0, Math.PI / 2]);
  for (let index = 0; index < 5; index += 1) {
    builder.child(
      drum,
      `grille.record-drum-disc-${index + 1}`,
      [0.28, 0.006, 0.28],
      [(index - 2) * 0.012, 0, 0],
      'vinyl',
      { rotation: [Math.PI / 2, 0, 0] },
    );
  }
  builder.animations.push({
    name: 'record-drum',
    kind: 'turntable',
    node: drum,
    axis: 'z',
    base: Math.PI / 2,
    amplitude: 0,
    rate: 0.35,
  });

  // Speaker grille along the base with three chrome-ringed drivers.
  addGrille(builder, 'grille', [w * 0.86, 0.42], [0, 0.42, d / 2 + 0.004], {
    cones: Math.max(builder.spec.speaker.coneCount, 3),
    coneRadius: Math.min(builder.spec.speaker.coneDiameter / 2, 0.095),
  });

  // Selector: keypad, coin slot and title strip.
  builder.box('controls.keypad-frame', 0.16, 0.2, 0.02, [w / 2 + 0.012, 0.92, 0.06], 'chrome', {
    rotation: [0, Math.PI / 2, 0],
  });
  builder.plane('controls.keypad', [0.14, 0.18], [w / 2 + 0.024, 0.92, 0.06], 'keypad', {
    rotation: [0, Math.PI / 2, 0],
  });
  builder.box('controls.coin-slot', 0.05, 0.012, 0.006, [-w * 0.3, 0.9, d / 2 + 0.012], 'chrome');
  builder.plane('dial.title-strip', [w * 0.42, 0.07], [0, 0.86, d / 2 + 0.012], 'display');
  addKnob(builder, 'controls.knob-1', [w * 0.3, 0.9, d / 2 + 0.014], 0.02);
  addBadgePlate(builder, 'badge', [0.2, 0.05], [0, 0.3, d / 2 + 0.014]);
}

/** 1985: a counter boombox, dual decks, equaliser, antenna and tape stacks. */
function buildBoombox(builder: MusicDeviceBuilder): void {
  const { width: w, height: h, depth: d, plinthHeight } = builder.spec.cabinet;
  const plinth = Math.max(plinthHeight, 0.012);
  builder.box('cabinet.plinth', w * 1.01, plinth, d * 1.01, [0, plinth / 2, 0], 'cabinet-dark');
  builder.box('cabinet.body', w, h, d, [0, plinth + h / 2, 0], 'cabinet');
  builder.box('cabinet.moulding', w * 1.02, 0.012, d * 1.02, [0, plinth + h - 0.006, 0], 'trim');
  for (const sx of [-1, 1]) {
    builder.box(`cabinet.corner-${sx < 0 ? 'l' : 'r'}`, 0.02, h * 0.9, 0.02, [sx * (w / 2 - 0.014), plinth + h / 2, d / 2 - 0.014], 'cabinet-dark');
  }
  // Carrying handle: two mounts and a tube grip.
  for (const sx of [-1, 1]) {
    builder.box(`cabinet.handle-mount-${sx < 0 ? 'l' : 'r'}`, 0.03, 0.05, 0.014, [sx * (w * 0.32), plinth + h + 0.025, 0], 'cabinet-dark');
  }
  builder.tube(
    'cabinet.handle-grip',
    [
      [-w * 0.32, plinth + h + 0.06, 0],
      [0, plinth + h + 0.075, 0.01],
      [w * 0.32, plinth + h + 0.06, 0],
    ],
    0.009,
    'trim',
    { tubularSegments: 20, radialSegments: 8 },
  );
  // Antenna: two telescopic sections, angled back.
  builder.cylinder('cabinet.antenna-base', [0.008, 0.01], 0.03, [w * 0.42, plinth + h + 0.012, -d * 0.2], 'chrome', {
    radialSegments: 10,
  });
  builder.cylinder('cabinet.antenna-lower', [0.006, 0.007], 0.24, [w * 0.44, plinth + h + 0.14, -d * 0.24], 'chrome', {
    rotation: [0.25, 0, -0.18],
    radialSegments: 10,
  });
  builder.cylinder('cabinet.antenna-upper', [0.0035, 0.004], 0.22, [w * 0.46, plinth + h + 0.35, -d * 0.3], 'chrome', {
    rotation: [0.25, 0, -0.14],
    radialSegments: 8,
  });

  // Grilles and drivers either side of the deck.
  addGrille(builder, 'grille.left', [w * 0.3, h * 0.55], [-w * 0.32, plinth + h * 0.42, d / 2 + 0.004], {
    cones: 2,
    coneRadius: Math.min(builder.spec.speaker.coneDiameter / 2, 0.045),
    rings: false,
  });
  addGrille(builder, 'grille.right', [w * 0.3, h * 0.55], [w * 0.32, plinth + h * 0.42, d / 2 + 0.004], {
    cones: 2,
    coneRadius: Math.min(builder.spec.speaker.coneDiameter / 2, 0.045),
    rings: false,
  });

  // Two cassette decks with visible reels.
  for (let deck = 0; deck < 2; deck += 1) {
    const deckX = (deck - 0.5) * 0.16;
    builder.box(`controls.deck-${deck + 1}`, 0.15, 0.1, 0.02, [deckX, plinth + h * 0.52, d / 2 - 0.004], 'cabinet-dark');
    builder.plane(`controls.deck-window-${deck + 1}`, [0.1, 0.05], [deckX, plinth + h * 0.52, d / 2 + 0.008], 'tape');
    for (let reel = 0; reel < 2; reel += 1) {
      const reelX = deckX + (reel - 0.5) * 0.05;
      const pivot = builder.pivot(`controls.reel-${deck + 1}-${reel + 1}`, [reelX, plinth + h * 0.52, d / 2 + 0.012]);
      builder.child(pivot, `controls.reel-face-${deck + 1}-${reel + 1}`, [0.03, 0.004, 0.03], [0, 0, 0], 'rubber');
      builder.child(pivot, `controls.reel-hub-${deck + 1}-${reel + 1}`, [0.012, 0.006, 0.012], [0, 0, 0.003], 'chrome');
      builder.animations.push({
        name: `reel-${deck + 1}-${reel + 1}`,
        kind: 'reel',
        node: pivot,
        axis: 'z',
        base: 0,
        amplitude: 0,
        rate: 2.2 + deck * 0.3,
      });
    }
    builder.box(`controls.deck-button-${deck + 1}`, 0.05, 0.01, 0.008, [deckX, plinth + h * 0.4, d / 2 + 0.006], 'chrome');
  }

  // Tuner scale with its sliding needle and VU meters.
  builder.box('dial.bezel', w * 0.5, 0.06, 0.012, [0, plinth + h * 0.82, d / 2 + 0.006], 'cabinet-dark');
  builder.plane('dial.glass', [w * 0.46, 0.045], [0, plinth + h * 0.82, d / 2 + 0.014], 'dial');
  const tunerNeedle = builder.pivot('dial.needle', [-w * 0.2, plinth + h * 0.83, d / 2 + 0.018]);
  builder.child(tunerNeedle, 'dial.needle-blade', [0.004, 0.05, 0.003], [0, 0, 0], 'badge');
  builder.animations.push({
    name: 'tuner-needle',
    // A sliding tuner pointer rather than a swinging one, so it uses the
    // position-excursion kind along the scale's X axis.
    kind: 'cone',
    node: tunerNeedle,
    axis: 'x',
    base: -w * 0.2,
    amplitude: 0.16,
    rate: 0.08,
  });
  for (const sx of [-1, 1]) {
    builder.plane(`dial.meter-${sx < 0 ? 'left' : 'right'}`, [0.06, 0.03], [sx * (w * 0.36), plinth + h * 0.8, d / 2 + 0.012], 'meter');
    const meterNeedle = builder.pivot(`dial.meter-needle-${sx < 0 ? 'left' : 'right'}`, [sx * (w * 0.36) - 0.03, plinth + h * 0.79, d / 2 + 0.016]);
    builder.child(meterNeedle, `dial.meter-blade-${sx < 0 ? 'left' : 'right'}`, [0.002, 0.024, 0.002], [0.012, 0, 0], 'cabinet-dark');
    builder.animations.push({
      name: `vu-${sx < 0 ? 'left' : 'right'}`,
      kind: 'meter',
      node: meterNeedle,
      axis: 'z',
      base: -0.3,
      amplitude: 0.5,
      rate: 1.6,
    });
  }

  // Equaliser sliders and transport buttons.
  for (let index = 0; index < 5; index += 1) {
    const sliderX = (index - 2) * 0.026;
    builder.box(`controls.slider-${index + 1}`, 0.008, 0.05, 0.008, [sliderX, plinth + h * 0.28, d / 2 + 0.008], 'chrome');
    builder.box(`controls.slider-knob-${index + 1}`, 0.014, 0.01, 0.01, [sliderX, plinth + h * 0.28 + (index - 2) * 0.008, d / 2 + 0.016], 'cabinet-dark');
  }
  for (let index = 0; index < 6; index += 1) {
    builder.box(`controls.button-${index + 1}`, 0.018, 0.012, 0.008, [(index - 2.5) * 0.024, plinth + h * 0.14, d / 2 + 0.008], 'chrome');
  }
  builder.box('controls.volume', 0.05, 0.016, 0.014, [w * 0.4, plinth + h * 0.3, d / 2 + 0.01], 'cabinet-dark');

  // Indicator LEDs.
  for (let index = 0; index < 3; index += 1) {
    builder.sphere(`glow.led-${index + 1}`, 0.005, [(index - 1) * 0.02, plinth + h * 0.66, d / 2 + 0.014], 'emissive');
  }
  const ledMaterial = builder.material('emissive');
  builder.animations.push({
    name: 'led-pulse',
    kind: 'glow',
    node: builder.group,
    axis: 'y',
    base: 0,
    amplitude: builder.spec.glow.pulse,
    rate: 1.1,
    material: ledMaterial,
    intensity: builder.spec.glow.intensity,
  });
  addBadgePlate(builder, 'badge', [0.15, 0.038], [0, plinth + h * 0.62, d / 2 + 0.012]);
}

/** 2005: an iPod in a speaker dock, with the cable clutter of the era. */
function buildIpodDock(builder: MusicDeviceBuilder): void {
  const { width: w, height: h, depth: d } = builder.spec.cabinet;
  builder.box('cabinet.plinth', w * 1.04, 0.008, d * 1.04, [0, 0.004, 0], 'rubber');
  builder.box('cabinet.body', w, h, d, [0, 0.008 + h / 2, 0], 'cabinet');
  builder.box('cabinet.moulding', w * 1.02, 0.006, d * 1.02, [0, 0.008 + h - 0.003, 0], 'trim');
  builder.box('cabinet.cradle', w * 0.3, 0.03, d * 0.6, [0, 0.008 + h + 0.012, 0], 'cabinet-dark');
  builder.box('cabinet.cradle-lip', w * 0.32, 0.008, 0.012, [0, 0.008 + h + 0.028, d * 0.22], 'trim');
  builder.cylinder('dial.connector', [0.004, 0.004], 0.012, [0, 0.008 + h + 0.024, -d * 0.05], 'chrome', {
    rotation: [0, 0, 0],
    radialSegments: 10,
  });
  // The iPod itself, leaning back in the cradle.
  builder.box('accessory.ipod.body', 0.062, 0.104, 0.008, [0, 0.008 + h + 0.078, -d * 0.02], 'cabinet-dark', {
    rotation: [-0.18, 0, 0],
  });
  builder.plane('dial.display', [0.05, 0.038], [0, 0.008 + h + 0.112, -d * 0.008], 'display', {
    rotation: [-0.18, 0, 0],
  });
  builder.cylinder('controls.click-wheel', [0.019, 0.019], 0.004, [0, 0.008 + h + 0.058, 0], 'trim', {
    rotation: [-0.18 + Math.PI / 2, 0, 0],
    radialSegments: 22,
  });
  builder.cylinder('controls.click-wheel-centre', [0.008, 0.008], 0.005, [0, 0.008 + h + 0.058, 0.002], 'chrome', {
    rotation: [-0.18 + Math.PI / 2, 0, 0],
    radialSegments: 14,
  });
  const screenMaterial = builder.material('display');
  builder.animations.push({
    name: 'screen-glow',
    kind: 'glow',
    node: builder.group,
    axis: 'y',
    base: 0,
    amplitude: builder.spec.glow.pulse,
    rate: 0.4,
    material: screenMaterial,
    intensity: builder.spec.glow.intensity,
  });
  // Dock indicator.
  builder.sphere('glow.led-1', 0.006, [w * 0.34, 0.008 + h * 0.6, d / 2 + 0.004], 'emissive');
  // Speaker cubes either side, wrap and driver facing the room.
  const cubeSize = Math.max(w * 0.45, 0.09);
  addSpeakerCube(builder, 'grille.cube-left', [-0.2, 0.008, 0], cubeSize);
  addSpeakerCube(builder, 'grille.cube-right', [0.2, 0.008, 0], cubeSize);
  addBadgePlate(builder, 'badge', [0.1, 0.026], [0, 0.008 + h * 0.3, d / 2 + 0.004]);
  addKnob(builder, 'controls.knob-1', [-w * 0.34, 0.008 + h * 0.6, d / 2 + 0.008], 0.014);
}

/** 2025: a phone paired to a smart speaker, on a storefront ledge. */
function buildSmartSpeaker(builder: MusicDeviceBuilder): void {
  const { width: w, height: h } = builder.spec.cabinet;
  const radius = Math.min(w, h);
  // Speaker puck: fabric wrap, rubber base, touch top, LED ring.
  builder.cylinder('cabinet.plinth', [radius * 0.98, radius * 1.02], 0.008, [0, 0.004, 0], 'rubber', {
    radialSegments: 28,
  });
  builder.cylinder('grille.cloth', [radius * 0.94, radius * 0.98], h * 0.72, [0, h * 0.4, 0], 'wrap', {
    radialSegments: 30,
  });
  builder.cylinder('cabinet.body', [radius * 0.96, radius * 0.96], h * 0.06, [0, h * 0.77, 0], 'cabinet', {
    radialSegments: 30,
  });
  // Joinery of the puck: the seam where the wrap meets the base and the collar
  // under the touch cap.
  builder.torus('cabinet.seam-ring', radius * 0.97, 0.002, [0, h * 0.1, 0], 'trim', {
    rotation: [Math.PI / 2, 0, 0],
    radialSegments: 28,
  });
  builder.cylinder('cabinet.collar', [radius * 0.95, radius * 0.95], 0.004, [0, h * 0.74, 0], 'trim', {
    radialSegments: 28,
  });
  builder.cylinder('grille.cone-1', [radius * 0.6, radius * 0.34], radius * 0.3, [0, h * 0.8, 0], 'cone', {
    radialSegments: 26,
    openEnded: true,
  });
  builder.torus('glow.led-ring', radius * 0.72, 0.0035, [0, h * 0.79, 0], 'emissive', {
    rotation: [Math.PI / 2, 0, 0],
  });
  builder.plane('controls.touch-plate', [radius * 1.2, radius * 1.2], [0, h * 0.806, 0], 'glass', {
    rotation: [-Math.PI / 2, 0, 0],
  });
  for (let index = 0; index < 4; index += 1) {
    const angle = (index / 4) * Math.PI * 2;
    builder.sphere(
      `controls.touch-dot-${index + 1}`,
      0.0045,
      [Math.cos(angle) * radius * 0.42, h * 0.812, Math.sin(angle) * radius * 0.42],
      'emissive',
    );
  }
  addBadgePlate(builder, 'badge', [radius * 0.9, radius * 0.22], [0, h * 0.2, radius * 0.95]);
  const ringMaterial = builder.material('emissive');
  builder.animations.push({
    name: 'led-ring',
    kind: 'glow',
    node: builder.group,
    axis: 'y',
    base: 0,
    amplitude: builder.spec.glow.pulse,
    rate: 0.45,
    material: ringMaterial,
    intensity: builder.spec.glow.intensity,
  });
  const cone = builder.parts.get('grille.cone-1');
  if (cone) {
    builder.animations.push({
      name: 'speaker-cone',
      kind: 'cone',
      node: cone,
      axis: 'y',
      base: h * 0.8,
      amplitude: 0.0016,
      rate: 3.1,
    });
  }
}

const DEVICE_BUILDERS: Readonly<Record<MusicDeviceKind, (builder: MusicDeviceBuilder) => void>> = {
  'wireless-set': buildWirelessSet,
  jukebox: buildJukebox,
  boombox: buildBoombox,
  'ipod-dock': buildIpodDock,
  'smart-speaker': buildSmartSpeaker,
};

/* -------------------------------------------------------------------------- */
/* Support and accessories                                                    */
/* -------------------------------------------------------------------------- */

/** The shelf, ledge or mat the device stands on (the counter is the room's). */
function addSupport(builder: MusicDeviceBuilder, placement: MusicDevicePlacement): void {
  const support = placement.support;
  if (!support) return;
  const thickness = Math.max(support.height, 0.02);
  if (support.kind === 'counter') {
    // A non-slip mat sitting *on* the counter surface, not inside its slab.
    builder.box('support.mat', support.length * 0.95, 0.005, support.depth * 0.85, [0, 0.0025, 0], 'rubber');
    return;
  }
  builder.box('support.shelf', support.length, thickness, support.depth, [0, -thickness / 2, 0], 'cabinet');
  builder.box('support.lip', support.length, 0.02, 0.014, [0, -thickness - 0.01, -support.depth / 2 + 0.007], 'trim');
  for (const sx of [-1, 1]) {
    builder.box(
      `support.bracket-${sx < 0 ? 'left' : 'right'}`,
      0.02,
      0.05,
      0.05,
      [sx * support.length * 0.34, -thickness - 0.03, -support.depth / 2 + 0.03],
      'trim',
    );
  }
  builder.box('support.batten', support.length, 0.05, 0.018, [0, -thickness - 0.02, -support.depth / 2 - 0.006], 'cabinet-dark');
}

function addAccessories(builder: MusicDeviceBuilder, spec: MusicDeviceSpec): void {
  for (const accessory of spec.accessories) {
    switch (accessory.kind) {
      case 'gramophone':
        // Beside the wireless set, away from the storefront glazing, so the horn
        // clears the window wall.
        addGramophone(builder, spec.cabinet.width * 0.68);
        break;
      case 'record-stack': {
        // On a floor stand the singles lean against the cabinet base; on a shelf
        // or ledge they sit straight on the surface.
        const base = spec.placement.kind === 'wall-floor' ? 0.08 : 0.02;
        addRecordStack(builder, 'accessory.records', [spec.cabinet.width * 0.85, base, -0.06], accessory.count);
        break;
      }
      case 'tape-stack':
        // On the wall side of the counter end, clear of the counter edge.
        addTapeStack(builder, 'accessory.tapes', [spec.cabinet.width * 0.42, 0.006, 0.02], accessory.count);
        break;
      case 'cable-clutter':
        addCableClutter(builder, 'accessory.clutter', [0.22, 0.006, -0.02], accessory.count);
        break;
      case 'phone-stand':
        addPhoneStand(builder, [0.18, 0.006, 0.02]);
        break;
      case 'charging-pad':
        addChargingPad(builder, [-0.22, 0.006, 0.03]);
        break;
      case 'speaker-cube':
        addSpeakerCube(builder, 'accessory.speaker', [-0.2, 0.006, 0], 0.085);
        break;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Builds one era's device: support, cabinet, dial, controls, grille, badge,
 * glow, cable run, wear and companions. The returned group is positioned and
 * rotated for its placement, and carries every resource the caller must release.
 */
export function buildMusicDevice(
  spec: MusicDeviceSpec,
  options: MusicDeviceBuildOptions,
): BuiltMusicDevice {
  const placement = musicDevicePlacement(spec, options.bounds, options.layout);
  const builder = new MusicDeviceBuilder(spec, placement, options);
  builder.group.position.set(placement.position.x, placement.position.y, placement.position.z);
  builder.group.rotation.y = placement.rotationY;

  addSupport(builder, placement);
  const build = DEVICE_BUILDERS[spec.kind];
  build(builder);
  addCableRun(builder, spec, placement, options.bounds, options.layout);
  addWearDecals(builder, spec);
  addAccessories(builder, spec);

  let meshCount = 0;
  builder.group.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) meshCount += 1;
  });

  return {
    spec,
    placement,
    nodeName: builder.group.name,
    group: builder.group,
    parts: builder.parts,
    animations: builder.animations,
    geometries: builder.geometries,
    materials: builder.materials,
    textures: builder.textures,
    meshCount,
    accessoryLabels: spec.accessories.map((accessory) => accessory.label),
  };
}

/** Releases every resource the built device owns and detaches its group. */
export function disposeMusicDevice(built: BuiltMusicDevice): void {
  for (const geometry of built.geometries) geometry.dispose();
  for (const material of built.materials) material.dispose();
  for (const texture of built.textures) texture.dispose();
  // Animations hold no resources of their own; dropping the reference is enough.
  if (built.group.parent) built.group.parent.remove(built.group);
  built.group.clear();
}

/** True when `year` has a device kind in this module's vocabulary. */
export function isMusicDeviceKind(value: unknown): value is MusicDeviceKind {
  return typeof value === 'string' && (MUSIC_DEVICE_KINDS as readonly string[]).includes(value);
}
