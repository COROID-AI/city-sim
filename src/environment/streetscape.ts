/**
 * Chrono City — the street surface of the block.
 *
 * This module owns every piece of *ground* the player walks and drives on: the
 * asphalt ring, the raised sidewalk band with its kerb face and gutter, the
 * zebra crossings, the lane paint, and the era-only surface features that make a
 * year readable at a glance — 1945's embedded trolley rails and catenary wires
 * through 2025's fresh markings and inlaid smart-surface light strips.
 *
 * Geometry is derived exclusively from the shared `BlockLayout` constants (the
 * 80 × 50 m block, the 8 m road ring, the sidewalk band and the eight authored
 * crosswalk anchors) so the roads here, the lane splines traffic derives and the
 * paths pedestrians walk can never disagree. Nothing in this module creates a
 * vehicle or a pedestrian.
 *
 * Surface *colour* comes from the era palette (`.color` tints the neutral
 * procedural texture), which is what lets one road mesh morph continuously from
 * 1945 soot-dark asphalt to 2025 fresh asphalt without regenerating a texture.
 * Everything era-discrete (rails, wires, smart strips, paint wear) fades by a
 * presence weight in `[0, 1]`, so a `TimelineRuntime` tween never pops.
 *
 * Lifecycle:
 *   create    → `createStreetscape({ context, library, parent? })` builds the
 *               static ring, kerbs, crossings and the era feature groups.
 *   consume   → `applyBlend(from, to, progress, palette)` per transition frame,
 *               `applyEra(era)` to snap, `snapshot()` to observe.
 *   integrate → the `EnvironmentApi` owns the group in the scene graph.
 */

import * as THREE from 'three';

import {
  BLOCK_HALF_DEPTH,
  BLOCK_HALF_WIDTH,
  CELL_HALF_DEPTH,
  CELL_HALF_WIDTH,
  CROSSWALK_ANCHORS,
  ROAD_CENTER_X,
  ROAD_CENTER_Z,
  ROAD_INNER_X,
  ROAD_INNER_Z,
  ROADS,
  SIDEWALK_LOOP,
  type Vec2,
} from '../core/blockLayout';
import {
  ERA_IDS,
  assertEraId,
  clamp01,
  type EraId,
} from '../core/eraContracts';
import { blendEraColor, getEraDescriptor, type EraColorPalette } from '../era/eraDescriptors';
import type { SceneContext } from '../core/sceneContext';
import type { MaterialLibrary } from '../materials/materialLibrary';

export const STREETSCAPE_VERSION = 1;

/** Group name every street-surface mesh is parented to. */
export const STREETSCAPE_ROOT_NAME = 'chrono-streetscape';

/** Height of the sidewalk slab, and therefore of the kerb face, in metres. */
export const SIDEWALK_TOP_Y = 0.14;
/** Width of the kerb stone band around the sidewalk. */
export const CURB_WIDTH = 0.42;
/** Width of the darker gutter strip painted on the asphalt beside the kerb. */
export const GUTTER_WIDTH = 0.7;
/** Standard-gauge track centres for the 1945 tram loop. */
export const TROLLEY_GAUGE = 1.435;
/** Height of the overhead trolley wire above the asphalt. */
export const TROLLEY_WIRE_HEIGHT = 5.6;
/** Spacing of the tram catenary support poles along each road leg. */
export const TROLLEY_POLE_SPACING = 20;
/** Number of white bars in one zebra crossing. */
export const CROSSWALK_BAR_COUNT = 6;
/** Painted lane-marking dash length / gap, in metres. */
export const LANE_DASH_LENGTH = 2.4;
export const LANE_DASH_GAP = 3.6;

/** How a year treats the paint on its crossings and lane lines. */
export type CrosswalkPaintStyle = 'worn' | 'faded' | 'crisp' | 'fresh' | 'smart';

/** Era-authored surface treatment: the discrete half of the streetscape. */
export interface EraStreetscapeDescriptor {
  readonly era: EraId;
  readonly crosswalkStyle: CrosswalkPaintStyle;
  /** Zebra paint opacity in `[0, 1]`; 1945's is nearly scrubbed away. */
  readonly crosswalkOpacity: number;
  /** Lane dash / stop line opacity in `[0, 1]`. */
  readonly laneMarkingOpacity: number;
  /** Presence of embedded tram rails in `[0, 1]`. */
  readonly trolleyRails: number;
  /** Presence of overhead trolley wires and their poles in `[0, 1]`. */
  readonly trolleyWires: number;
  /** Presence of inlaid smart-surface light strips in `[0, 1]`. */
  readonly smartSurface: number;
  /** Night sheen of the gutter run-off in `[0, 1]`. */
  readonly gutterSheen: number;
  readonly notes: string;
}

/** A resolved (already blended) surface treatment. */
export interface ResolvedStreetscapeDescriptor {
  readonly crosswalkStyle: CrosswalkPaintStyle;
  readonly crosswalkOpacity: number;
  readonly laneMarkingOpacity: number;
  readonly trolleyRails: number;
  readonly trolleyWires: number;
  readonly smartSurface: number;
  readonly gutterSheen: number;
}

/**
 * The authored surface treatments. 1945 asphalt is soot-dark with worn paint and
 * a live tram loop; the rails and wires are lifted over the following decades;
 * 2025 gets crisp markings plus an inlaid smart-surface light network.
 */
export const STREETSCAPE_DESCRIPTORS: Readonly<Record<EraId, EraStreetscapeDescriptor>> =
  Object.freeze({
    '1945': Object.freeze({
      era: '1945',
      crosswalkStyle: 'worn',
      crosswalkOpacity: 0.4,
      laneMarkingOpacity: 0.32,
      trolleyRails: 1,
      trolleyWires: 1,
      smartSurface: 0,
      gutterSheen: 0.15,
      notes: 'Soot-dark asphalt, trolley rails in the gutters and paint scrubbed to ghosts.',
    }),
    '1965': Object.freeze({
      era: '1965',
      crosswalkStyle: 'faded',
      crosswalkOpacity: 0.62,
      laneMarkingOpacity: 0.52,
      trolleyRails: 0.3,
      trolleyWires: 0.12,
      smartSurface: 0,
      gutterSheen: 0.22,
      notes: 'New asphalt winning over the old, rails being lifted and repainted crossings.',
    }),
    '1985': Object.freeze({
      era: '1985',
      crosswalkStyle: 'crisp',
      crosswalkOpacity: 0.8,
      laneMarkingOpacity: 0.7,
      trolleyRails: 0,
      trolleyWires: 0,
      smartSurface: 0,
      gutterSheen: 0.34,
      notes: 'Crisp thermoplastic paint on coarse asphalt, wet gutters catching neon.',
    }),
    '2005': Object.freeze({
      era: '2005',
      crosswalkStyle: 'fresh',
      crosswalkOpacity: 0.9,
      laneMarkingOpacity: 0.82,
      trolleyRails: 0,
      trolleyWires: 0,
      smartSurface: 0.18,
      gutterSheen: 0.4,
      notes: 'Fresh, reflectivity-beaded markings and the first inlaid light studs.',
    }),
    '2025': Object.freeze({
      era: '2025',
      crosswalkStyle: 'smart',
      crosswalkOpacity: 0.96,
      laneMarkingOpacity: 0.9,
      trolleyRails: 0,
      trolleyWires: 0,
      smartSurface: 1,
      gutterSheen: 0.48,
      notes: 'Bright paint, quiet new asphalt and an LED smart-surface guidance network.',
    }),
  });

/** Looks a treatment up; throws a `RangeError` for unknown eras. */
export function getStreetscapeDescriptor(era: EraId | string): EraStreetscapeDescriptor {
  return STREETSCAPE_DESCRIPTORS[assertEraId(era)];
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/** Blends two treatments: numbers interpolate, the paint style snaps at halfway. */
export function blendStreetscapeDescriptors(
  from: EraId,
  to: EraId,
  progress: number,
): ResolvedStreetscapeDescriptor {
  const t = clamp01(progress);
  const source = getStreetscapeDescriptor(from);
  const target = getStreetscapeDescriptor(to);
  if (from === to || t >= 1) {
    return {
      crosswalkStyle: target.crosswalkStyle,
      crosswalkOpacity: target.crosswalkOpacity,
      laneMarkingOpacity: target.laneMarkingOpacity,
      trolleyRails: target.trolleyRails,
      trolleyWires: target.trolleyWires,
      smartSurface: target.smartSurface,
      gutterSheen: target.gutterSheen,
    };
  }
  if (t <= 0) {
    return {
      crosswalkStyle: source.crosswalkStyle,
      crosswalkOpacity: source.crosswalkOpacity,
      laneMarkingOpacity: source.laneMarkingOpacity,
      trolleyRails: source.trolleyRails,
      trolleyWires: source.trolleyWires,
      smartSurface: source.smartSurface,
      gutterSheen: source.gutterSheen,
    };
  }
  return {
    crosswalkStyle: t < 0.5 ? source.crosswalkStyle : target.crosswalkStyle,
    crosswalkOpacity: lerp(source.crosswalkOpacity, target.crosswalkOpacity, t),
    laneMarkingOpacity: lerp(source.laneMarkingOpacity, target.laneMarkingOpacity, t),
    trolleyRails: lerp(source.trolleyRails, target.trolleyRails, t),
    trolleyWires: lerp(source.trolleyWires, target.trolleyWires, t),
    smartSurface: lerp(source.smartSurface, target.smartSurface, t),
    gutterSheen: lerp(source.gutterSheen, target.gutterSheen, t),
  };
}

/** Read-only state of the street surface, complete enough for a HUD or a probe. */
export interface StreetscapeSnapshot {
  readonly version: number;
  readonly era: EraId;
  readonly from: EraId;
  readonly to: EraId;
  readonly progress: number;
  readonly transitioning: boolean;
  readonly crosswalkStyle: CrosswalkPaintStyle;
  readonly crosswalkOpacity: number;
  readonly laneMarkingOpacity: number;
  readonly trolleyRailPresence: number;
  readonly trolleyWirePresence: number;
  readonly smartSurfacePresence: number;
  readonly gutterSheen: number;
  readonly roadColor: number;
  readonly sidewalkColor: number;
  readonly curbColor: number;
  readonly crosswalkCount: number;
  readonly crosswalkBarCount: number;
  readonly laneDashCount: number;
  readonly railCount: number;
  readonly wireCount: number;
  readonly trolleyPoleCount: number;
  readonly smartStripCount: number;
  readonly meshCount: number;
  readonly roadRing: Readonly<{ width: number; depth: number }>;
  readonly sidewalkTopY: number;
  readonly curbHeight: number;
}

export interface StreetscapeOptions {
  /** Shared scene context: supplies the scene graph and the seeded RNG. */
  readonly context: SceneContext;
  /** Shared procedural material library. */
  readonly library: MaterialLibrary;
  /** Object the streetscape root is parented to. Defaults to `context.scene`. */
  readonly parent?: THREE.Object3D | null;
  /** Era the surface starts as. Defaults to `2025`. */
  readonly initialEra?: EraId;
}

/* ------------------------------------------------------------------------- *
 * Geometry helpers
 * ------------------------------------------------------------------------- */

/**
 * Builds a rectangular ring (outer rectangle minus an inner hole) as a flat
 * shape whose local `+Y` maps to world `+Z` after `rotateX(-PI/2)`.
 */
function ringShape(
  innerHalfX: number,
  innerHalfZ: number,
  outerHalfX: number,
  outerHalfZ: number,
): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(-outerHalfX, -outerHalfZ);
  shape.lineTo(outerHalfX, -outerHalfZ);
  shape.lineTo(outerHalfX, outerHalfZ);
  shape.lineTo(-outerHalfX, outerHalfZ);
  shape.closePath();

  const hole = new THREE.Path();
  hole.moveTo(-innerHalfX, -innerHalfZ);
  hole.lineTo(innerHalfX, -innerHalfZ);
  hole.lineTo(innerHalfX, innerHalfZ);
  hole.lineTo(-innerHalfX, innerHalfZ);
  hole.closePath();
  shape.holes.push(hole);

  return shape;
}

/** A flat ground plane spanning `sizeX` × `sizeZ`, facing up. */
function groundPlane(sizeX: number, sizeZ: number, material: THREE.Material): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(sizeX, sizeZ);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** A thin painted band on the road, `length` along local X and `width` along Z. */
function paintBand(length: number, width: number, material: THREE.Material): THREE.Mesh {
  const mesh = groundPlane(length, width, material);
  mesh.position.y = 0.012;
  return mesh;
}

/** Tags a mesh with the surface role it plays, for diagnostics and tests. */
function tag(mesh: THREE.Object3D, role: string): void {
  mesh.userData.chronoStreetscapeRole = role;
}

/* ------------------------------------------------------------------------- *
 * Streetscape
 * ------------------------------------------------------------------------- */

export class Streetscape {
  readonly version = STREETSCAPE_VERSION;

  /** Root of every street-surface mesh. */
  readonly root: THREE.Group;

  private readonly library: MaterialLibrary;
  private readonly parent: THREE.Object3D;

  private readonly roadMaterial: THREE.MeshStandardMaterial;
  private readonly sidewalkMaterial: THREE.MeshStandardMaterial;
  private readonly curbMaterial: THREE.MeshStandardMaterial;
  private readonly gutterMaterial: THREE.MeshStandardMaterial;
  private readonly crosswalkMaterial: THREE.MeshStandardMaterial;
  private readonly laneMaterial: THREE.MeshStandardMaterial;
  private readonly railMaterial: THREE.MeshStandardMaterial;
  private readonly wireMaterial: THREE.MeshStandardMaterial;
  private readonly poleMaterial: THREE.MeshStandardMaterial;
  private readonly smartMaterial: THREE.MeshStandardMaterial;

  private readonly railGroup: THREE.Group;
  private readonly wireGroup: THREE.Group;
  private readonly smartGroup: THREE.Group;

  private fromEra: EraId;
  private toEra: EraId;
  private progressState = 1;
  private resolved: ResolvedStreetscapeDescriptor;
  private roadColorState: number;
  private sidewalkColorState: number;
  private curbColorState: number;
  private disposedState = false;

  constructor(options: StreetscapeOptions) {
    if (!options?.context) throw new TypeError('Streetscape needs a SceneContext.');
    if (!options.library) throw new TypeError('Streetscape needs a MaterialLibrary.');
    this.library = options.library;
    this.parent = options.parent ?? options.context.scene;

    this.root = new THREE.Group();
    this.root.name = STREETSCAPE_ROOT_NAME;

    // Neutral, light palettes: the era colour is applied as a tint so a single
    // road/sidewalk material can morph between years without a texture rebuild.
    this.roadMaterial = this.surface('chrono-streetscape-road', 'asphalt', '#d8d8d8', '#9a9a9a');
    this.sidewalkMaterial = this.surface(
      'chrono-streetscape-sidewalk',
      'stone',
      '#e2ded4',
      '#b7b2a6',
    );
    this.curbMaterial = this.surface('chrono-streetscape-curb', 'stone', '#eeeeea', '#c2bdb0');
    this.gutterMaterial = this.surface('chrono-streetscape-gutter', 'asphalt', '#bcbcbc', '#8a8a8a', {
      transparent: true,
      opacity: 0.9,
    });
    this.crosswalkMaterial = this.surface(
      'chrono-streetscape-crosswalk',
      'paintedSign',
      '#f4f2ec',
      '#d8d4c8',
      { transparent: true, opacity: 0.6 },
    );
    this.laneMaterial = this.surface(
      'chrono-streetscape-lane',
      'paintedSign',
      '#f0eee6',
      '#cfcabc',
      { transparent: true, opacity: 0.5 },
    );
    this.railMaterial = this.surface('chrono-streetscape-rail', 'corrugatedMetal', '#8e9298', '#5c6167');
    this.wireMaterial = this.surface('chrono-streetscape-wire', 'corrugatedMetal', '#989ca2', '#5a5e64');
    this.poleMaterial = this.surface('chrono-streetscape-pole', 'corrugatedMetal', '#7c8188', '#4e5258');
    this.smartMaterial = this.surface('chrono-streetscape-smart', 'neon', '#dff2ff', '#9fd8ff', {
      transparent: true,
      emissive: 1.6,
      opacity: 0,
    });
    this.crosswalkMaterial.polygonOffset = true;
    this.crosswalkMaterial.polygonOffsetFactor = -2;
    this.crosswalkMaterial.polygonOffsetUnits = -2;
    this.laneMaterial.polygonOffset = true;
    this.laneMaterial.polygonOffsetFactor = -1;
    this.laneMaterial.polygonOffsetUnits = -1;

    this.buildRoadRing();
    this.buildSidewalk();
    this.buildCurbs();
    this.buildCrosswalks();
    this.buildLaneMarkings();

    this.railGroup = this.buildTrolleyRails();
    this.wireGroup = this.buildTrolleyWires();
    this.smartGroup = this.buildSmartSurface();

    const initial = assertEraId(options.initialEra ?? '2025');
    this.fromEra = initial;
    this.toEra = initial;
    this.resolved = blendStreetscapeDescriptors(initial, initial, 1);
    this.roadColorState = 0x3a3d42;
    this.sidewalkColorState = 0x9d9a92;
    this.curbColorState = 0xbdb9ae;

    this.parent.add(this.root);
    this.applyBlend(initial, initial, 1, null);
  }

  /* ---------------- state ---------------- */

  get era(): EraId {
    return this.toEra;
  }

  get from(): EraId {
    return this.fromEra;
  }

  get progress(): number {
    return this.progressState;
  }

  get isTransitioning(): boolean {
    return this.fromEra !== this.toEra;
  }

  get isDisposed(): boolean {
    return this.disposedState;
  }

  /** Snaps the surface to an era. */
  applyEra(era: EraId): void {
    this.applyBlend(era, era, 1, null);
  }

  /**
   * Applies one frame of the era tween: presence weights interpolate, the
   * palette tints the shared road and sidewalk materials.
   */
  applyBlend(
    from: EraId,
    to: EraId,
    progress: number,
    palette: EraColorPalette | null,
  ): void {
    if (this.disposedState) return;
    const source = assertEraId(from);
    const target = assertEraId(to);
    const t = clamp01(progress);
    this.fromEra = source;
    this.toEra = target;
    this.progressState = t;
    this.resolved = blendStreetscapeDescriptors(source, target, t);

    this.setFeatureWeight(this.railGroup, this.resolved.trolleyRails);
    this.setFeatureWeight(this.wireGroup, this.resolved.trolleyWires);
    this.setFeatureWeight(this.smartGroup, this.resolved.smartSurface);

    this.crosswalkMaterial.opacity = this.resolved.crosswalkOpacity;
    this.crosswalkMaterial.transparent = true;
    this.laneMaterial.opacity = this.resolved.laneMarkingOpacity;
    this.laneMaterial.transparent = true;
    this.gutterMaterial.opacity = 0.18 + this.resolved.gutterSheen * 0.7;
    this.crosswalkMaterial.color.setHex(paintTint(this.resolved.crosswalkStyle));

    const sourcePalette = getEraDescriptor(source).palette;
    const targetPalette = getEraDescriptor(target).palette;
    this.roadColorState = palette
      ? palette.asphalt
      : blendEraColor(sourcePalette.asphalt, targetPalette.asphalt, t);
    this.sidewalkColorState = palette
      ? palette.sidewalk
      : blendEraColor(sourcePalette.sidewalk, targetPalette.sidewalk, t);
    this.curbColorState = blendEraColor(this.sidewalkColorState, 0xffffff, 0.22);
    this.roadMaterial.color.setHex(this.roadColorState);
    this.sidewalkMaterial.color.setHex(this.sidewalkColorState);
    this.curbMaterial.color.setHex(this.curbColorState);
    this.gutterMaterial.color.setHex(blendEraColor(this.roadColorState, 0x000000, 0.25));
    this.smartMaterial.color.setHex(
      palette
        ? palette.emissive
        : blendEraColor(sourcePalette.emissive, targetPalette.emissive, t),
    );

    this.smartMaterial.opacity = this.resolved.smartSurface;
    this.smartMaterial.transparent = true;
    this.smartMaterial.depthWrite = this.resolved.smartSurface > 0.5;
  }

  /* ---------------- observation ---------------- */

  snapshot(): StreetscapeSnapshot {
    const counts = this.countMeshes();
    return Object.freeze({
      version: STREETSCAPE_VERSION,
      era: this.toEra,
      from: this.fromEra,
      to: this.toEra,
      progress: this.progressState,
      transitioning: this.fromEra !== this.toEra,
      crosswalkStyle: this.resolved.crosswalkStyle,
      crosswalkOpacity: this.resolved.crosswalkOpacity,
      laneMarkingOpacity: this.resolved.laneMarkingOpacity,
      trolleyRailPresence: this.resolved.trolleyRails,
      trolleyWirePresence: this.resolved.trolleyWires,
      smartSurfacePresence: this.resolved.smartSurface,
      gutterSheen: this.resolved.gutterSheen,
      roadColor: this.roadColorState,
      sidewalkColor: this.sidewalkColorState,
      curbColor: this.curbColorState,
      crosswalkCount: CROSSWALK_ANCHORS.length,
      crosswalkBarCount: CROSSWALK_ANCHORS.length * CROSSWALK_BAR_COUNT,
      laneDashCount: counts.laneDash,
      railCount: counts.rail,
      wireCount: counts.wire,
      trolleyPoleCount: counts.pole,
      smartStripCount: counts.smart,
      meshCount: counts.total,
      roadRing: Object.freeze({
        width: CELL_HALF_WIDTH * 2,
        depth: CELL_HALF_DEPTH * 2,
      }),
      sidewalkTopY: SIDEWALK_TOP_Y,
      curbHeight: SIDEWALK_TOP_Y,
    });
  }

  /** Releases every geometry this module created and detaches from the scene. */
  dispose(): void {
    if (this.disposedState) return;
    this.disposedState = true;
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry.dispose();
    });
    this.root.removeFromParent();
    this.root.clear();
  }

  /* ---------------- construction ---------------- */

  private surface(
    name: string,
    surface: Parameters<MaterialLibrary['get']>[0]['surface'],
    base: string,
    accent: string,
    options: Partial<Parameters<MaterialLibrary['get']>[0]> = {},
  ): THREE.MeshStandardMaterial {
    return this.library.get({
      surface,
      palette: { base, accent, grime: '#5a5a5a', highlight: '#f2f2f2' },
      name,
      ...options,
    });
  }

  private buildRoadRing(): void {
    // The asphalt ring: the whole cell rectangle minus the sidewalk's outer edge.
    const shape = ringShape(ROAD_INNER_X, ROAD_INNER_Z, CELL_HALF_WIDTH, CELL_HALF_DEPTH);
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, this.roadMaterial);
    mesh.receiveShadow = true;
    tag(mesh, 'road-ring');
    this.root.add(mesh);

    // The gutter run-off: a slightly darker, semi-transparent band hugging the
    // kerb, which is where the era palette's sheen reads most strongly.
    const gutterShape = ringShape(
      ROAD_INNER_X,
      ROAD_INNER_Z,
      ROAD_INNER_X + GUTTER_WIDTH,
      ROAD_INNER_Z + GUTTER_WIDTH,
    );
    const gutterGeometry = new THREE.ShapeGeometry(gutterShape);
    gutterGeometry.rotateX(-Math.PI / 2);
    const gutter = new THREE.Mesh(gutterGeometry, this.gutterMaterial);
    gutter.position.y = 0.004;
    gutter.receiveShadow = true;
    tag(gutter, 'gutter');
    this.root.add(gutter);
  }

  private rectHole(halfX: number, halfZ: number): THREE.Path {
    const hole = new THREE.Path();
    hole.moveTo(-halfX, -halfZ);
    hole.lineTo(halfX, -halfZ);
    hole.lineTo(halfX, halfZ);
    hole.lineTo(-halfX, halfZ);
    hole.closePath();
    return hole;
  }

  private buildSidewalk(): void {
    const shape = new THREE.Shape();
    const outerX = ROAD_INNER_X;
    const outerZ = ROAD_INNER_Z;
    shape.moveTo(-outerX, -outerZ);
    shape.lineTo(outerX, -outerZ);
    shape.lineTo(outerX, outerZ);
    shape.lineTo(-outerX, outerZ);
    shape.closePath();
    shape.holes.push(this.rectHole(BLOCK_HALF_WIDTH, BLOCK_HALF_DEPTH));

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: SIDEWALK_TOP_Y,
      bevelEnabled: false,
      curveSegments: 1,
    });
    // Extrusion runs along local +Z; rotating -90° about X turns it into +Y and
    // the shape's local Y into world Z, so the slab sits on the ground.
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, this.sidewalkMaterial);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    tag(mesh, 'sidewalk');
    this.root.add(mesh);
  }

  private buildCurbs(): void {
    const half = CURB_WIDTH / 2;
    const spanX = ROAD_INNER_X;
    const spanZ = ROAD_INNER_Z;
    const bands: Array<{ size: [number, number, number]; position: [number, number, number] }> = [
      { size: [spanX * 2, SIDEWALK_TOP_Y, CURB_WIDTH], position: [0, SIDEWALK_TOP_Y / 2, -spanZ + half] },
      { size: [spanX * 2, SIDEWALK_TOP_Y, CURB_WIDTH], position: [0, SIDEWALK_TOP_Y / 2, spanZ - half] },
      { size: [CURB_WIDTH, SIDEWALK_TOP_Y, spanZ * 2], position: [-spanX + half, SIDEWALK_TOP_Y / 2, 0] },
      { size: [CURB_WIDTH, SIDEWALK_TOP_Y, spanZ * 2], position: [spanX - half, SIDEWALK_TOP_Y / 2, 0] },
    ];
    for (const band of bands) {
      const geometry = new THREE.BoxGeometry(...band.size);
      const mesh = new THREE.Mesh(geometry, this.curbMaterial);
      mesh.position.set(...band.position);
      mesh.receiveShadow = true;
      tag(mesh, 'curb');
      this.root.add(mesh);
    }
  }

  private buildCrosswalks(): void {
    for (const anchor of CROSSWALK_ANCHORS) {
      const group = new THREE.Group();
      group.name = `chrono-crosswalk-${anchor.id}`;
      group.position.set(anchor.center.x, 0, anchor.center.z);
      group.rotation.y = anchor.rotationY;
      // Local +X runs along the crossing (pedestrians walk it), local +Z spans
      // the band width; zebra bars are therefore thin in X and wide in Z.
      const spacing = anchor.length / CROSSWALK_BAR_COUNT;
      const barThickness = spacing * 0.52;
      for (let index = 0; index < CROSSWALK_BAR_COUNT; index += 1) {
        const bar = paintBand(barThickness, anchor.width, this.crosswalkMaterial);
        const offset = -anchor.length / 2 + spacing * (index + 0.5);
        bar.position.x = offset;
        tag(bar, 'crosswalk-bar');
        bar.userData.chronoCrosswalk = anchor.id;
        group.add(bar);
      }
      this.root.add(group);
    }
  }

  private buildLaneMarkings(): void {
    for (const segment of ROADS) {
      const alongX = segment.axis === 'x';
      const stride = LANE_DASH_LENGTH + LANE_DASH_GAP;
      const count = Math.max(1, Math.floor(segment.length / stride));
      for (let index = 0; index < count; index += 1) {
        const centre = segment.start + stride * (index + 0.5);
        const dash = paintBand(LANE_DASH_LENGTH, 0.16, this.laneMaterial);
        if (alongX) {
          dash.position.set(centre, 0.012, segment.center);
        } else {
          dash.rotation.y = Math.PI / 2;
          dash.position.set(segment.center, 0.012, centre);
        }
        tag(dash, 'lane-dash');
        this.root.add(dash);
      }
    }
  }

  private buildTrolleyRails(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'chrono-trolley-rails';
    const halfGauge = TROLLEY_GAUGE / 2;
    for (const segment of ROADS) {
      const alongX = segment.axis === 'x';
      for (const offset of [-halfGauge, halfGauge]) {
        const geometry = alongX
          ? new THREE.BoxGeometry(segment.length, 0.05, 0.12)
          : new THREE.BoxGeometry(0.12, 0.05, segment.length);
        const rail = new THREE.Mesh(geometry, this.railMaterial);
        const cross = segment.center + offset;
        rail.position.set(
          alongX ? 0 : cross,
          0.03,
          alongX ? cross : 0,
        );
        rail.receiveShadow = true;
        tag(rail, 'rail');
        group.add(rail);
      }
    }
    this.root.add(group);
    return group;
  }

  private buildTrolleyWires(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'chrono-trolley-wires';
    const wireY = TROLLEY_WIRE_HEIGHT;
    const runs: Array<{ axis: 'x' | 'z'; fixed: number }> = [
      { axis: 'x', fixed: -ROAD_CENTER_Z },
      { axis: 'x', fixed: ROAD_CENTER_Z },
      { axis: 'z', fixed: -ROAD_CENTER_X },
      { axis: 'z', fixed: ROAD_CENTER_X },
    ];
    for (const run of runs) {
      const length = run.axis === 'x' ? CELL_HALF_WIDTH * 2 : CELL_HALF_DEPTH * 2;
      const geometry = new THREE.CylinderGeometry(0.035, 0.035, length, 6, 1);
      geometry.rotateX(run.axis === 'x' ? 0 : Math.PI / 2);
      geometry.rotateZ(run.axis === 'x' ? Math.PI / 2 : 0);
      const wire = new THREE.Mesh(geometry, this.wireMaterial);
      wire.position.set(
        run.axis === 'x' ? 0 : run.fixed,
        wireY,
        run.axis === 'x' ? run.fixed : 0,
      );
      tag(wire, 'wire');
      group.add(wire);
    }

    // Catenary support poles: one at each ring corner and one mid-leg, so the
    // overhead run reads as engineered rather than floating.
    const polePositions: Vec2[] = [
      { x: -ROAD_CENTER_X, z: -ROAD_CENTER_Z },
      { x: ROAD_CENTER_X, z: -ROAD_CENTER_Z },
      { x: ROAD_CENTER_X, z: ROAD_CENTER_Z },
      { x: -ROAD_CENTER_X, z: ROAD_CENTER_Z },
      { x: 0, z: -ROAD_CENTER_Z },
      { x: 0, z: ROAD_CENTER_Z },
      { x: -ROAD_CENTER_X, z: 0 },
      { x: ROAD_CENTER_X, z: 0 },
    ];
    for (const position of polePositions) {
      const geometry = new THREE.CylinderGeometry(0.09, 0.13, wireY, 8, 1);
      const pole = new THREE.Mesh(geometry, this.poleMaterial);
      pole.position.set(position.x, wireY / 2, position.z);
      pole.castShadow = true;
      tag(pole, 'pole');
      group.add(pole);
    }
    this.root.add(group);
    return group;
  }

  private buildSmartSurface(): THREE.Group {
    const group = new THREE.Group();
    group.name = 'chrono-smart-surface';
    group.visible = false;

    // A guidance light line inlaid along the sidewalk centre loop.
    for (let index = 0; index < SIDEWALK_LOOP.length; index += 1) {
      const from = SIDEWALK_LOOP[index];
      const to = SIDEWALK_LOOP[(index + 1) % SIDEWALK_LOOP.length];
      const strip = this.segmentStrip(from, to, 0.14, SIDEWALK_TOP_Y + 0.012);
      tag(strip, 'smart-strip');
      group.add(strip);
    }

    // LED stud rows flanking each crossing: the smart-surface answer to kerb
    // paint, which is what makes the 2025 street read as active even by day.
    for (const anchor of CROSSWALK_ANCHORS) {
      for (const side of [-1, 1]) {
        const offset = side * (anchor.width / 2 + 0.28);
        const stud = paintBand(anchor.length, 0.12, this.smartMaterial);
        stud.position.y = 0.02;
        if (anchor.axis === 'x') {
          stud.position.set(anchor.center.x, 0.02, anchor.center.z + offset);
        } else {
          stud.rotation.y = Math.PI / 2;
          stud.position.set(anchor.center.x + offset, 0.02, anchor.center.z);
        }
        tag(stud, 'smart-strip');
        group.add(stud);
      }
    }
    this.root.add(group);
    return group;
  }

  private segmentStrip(from: Vec2, to: Vec2, width: number, y: number): THREE.Mesh {
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const geometry = new THREE.BoxGeometry(length, 0.02, width);
    const mesh = new THREE.Mesh(geometry, this.smartMaterial);
    mesh.position.set((from.x + to.x) / 2, y, (from.z + to.z) / 2);
    mesh.rotation.y = Math.atan2(-(to.z - from.z), to.x - from.x);
    return mesh;
  }

  private setFeatureWeight(group: THREE.Group, weight: number): void {
    const visible = weight > 0.02;
    group.visible = visible;
    group.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (!material || Array.isArray(material)) return;
      material.transparent = weight < 0.995;
      material.opacity = Math.max(0.02, weight);
      material.depthWrite = weight > 0.6;
    });
  }

  private countMeshes(): {
    total: number;
    laneDash: number;
    rail: number;
    wire: number;
    pole: number;
    smart: number;
  } {
    const counts = { total: 0, laneDash: 0, rail: 0, wire: 0, pole: 0, smart: 0 };
    this.root.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      counts.total += 1;
      const role = String(mesh.userData.chronoStreetscapeRole ?? '');
      if (role === 'lane-dash') counts.laneDash += 1;
      else if (role === 'rail') counts.rail += 1;
      else if (role === 'wire') counts.wire += 1;
      else if (role === 'pole') counts.pole += 1;
      else if (role === 'smart-strip') counts.smart += 1;
    });
    return counts;
  }
}

/** Paint tint for a style: 1945's is dirtier than 2025's bright thermoplastic. */
function paintTint(style: CrosswalkPaintStyle): number {
  switch (style) {
    case 'worn':
      return 0xd8d2c2;
    case 'faded':
      return 0xe6e2d6;
    case 'crisp':
      return 0xf2f0e8;
    case 'fresh':
      return 0xf6f4ee;
    case 'smart':
      return 0xf8f8f4;
    default:
      return 0xf0eee6;
  }
}

/** Every street-surface mesh role, for diagnostics and tests. */
export const STREETSCAPE_ROLES = Object.freeze([
  'road-ring',
  'gutter',
  'sidewalk',
  'curb',
  'crosswalk-bar',
  'lane-dash',
  'rail',
  'wire',
  'pole',
  'smart-strip',
]);

/** Creates the block's street surface (the `create` half of the lifecycle). */
export function createStreetscape(options: StreetscapeOptions): Streetscape {
  return new Streetscape(options);
}

/** The five eras this module authors a treatment for, in timeline order. */
export const STREETSCAPE_ERAS: readonly EraId[] = ERA_IDS;
