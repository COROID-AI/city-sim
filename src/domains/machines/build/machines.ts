/**
 * Machine planning and geometry — the brewing machine of each era.
 *
 * This is the geometry half of the brewing domain: {@link planMachines} turns an
 * era's {@link BrewingMachineSpec} plus the environment's published
 * {@link StructuralLayout} into a geometry-free {@link MachinePlanEntry} (the
 * machine-bay counter anchor, the counter surface height, the footprint and the
 * barista clearance), and {@link buildMachine} raises the machine itself as one
 * named group inside the module's `machines` group.
 *
 * ## One namespace, one vocabulary
 *
 * Every node the module builds lives under the shared prefix
 * {@link MACHINE_NODE_PREFIX} (`machines:`) and is named
 * `<machine id>:<part>` — `machines:1945:percolator:urn-body`,
 * `machines:1965:lever-espresso:steam-wand-2-arm`. The part names are the
 * domain's vocabulary, so tests, hotspots and later tooling can address a part
 * without knowing how it was drawn. Names differ between archetypes only where
 * the era's hardware genuinely differs: the percolator has an `urn-body` and a
 * `spigot`, the multi-group machine has `granite-cheek-*` and a `walnut-top`,
 * and everything else uses the common vocabulary (see {@link ARCHETYPE_NODES}).
 *
 * ## What makes a machine the era's machine
 *
 * `buildMachine` always builds the same *programme* — plinth and feet, cabinet,
 * fascia and panel lettering, boiler, steam path, groups, wands, dials, dose
 * controls, display, lamps, cup station, drip tray, knock box and wear decals —
 * and the era's data decides the result: materials come only from the era's
 * {@link MachineMaterialSet}, the housing's `panelStyle` / `feet` / `ventCount` /
 * `wearLevel` shape the details, the steam path decides wands, sight glass,
 * pipe runs and drip tray, the dosing kind decides levers, rockers or a touch
 * panel, and the wear decals are placed from the era's seeded source. So the
 * 1945 percolator urn and the 2025 multi-group machine are the same programme
 * fed different data, which is exactly how the timeline transforms the bar.
 *
 * ## Animation hand-off
 *
 * The builder returns the nodes the module animates every frame:
 * {@link MachineBuild.needles} (gauge needles, rotation pivots),
 * {@link MachineBuild.steamPlumes} (spheres left invisible until a purge),
 * {@link MachineBuild.drips} (extraction drops) and {@link MachineBuild.jiggles}
 * (hardware tagged with the machine cue that rattles it). Steam and coffee
 * particles get small purpose-built materials without a map, so the era's
 * procedural texture budget stays exactly one texture per declared surface.
 *
 * ## Placement rules
 *
 * {@link placementProblems} is the shared rule book: a machine stands on the
 * counter surface inside the counter footprint and clear of the barista's
 * service lane, a counter-slot accessory does the same, a wall-mounted
 * accessory hangs on the back wall above the counter, and no two items on the
 * counter overlap. The module reports the list through its diagnostics
 * snapshot, and the tests require it to be empty for every era.
 */

import * as THREE from 'three';
import type { RoomBounds, YearId } from '../../../contracts/period';
import {
  counterRect,
  pointInsideBounds,
  rectsOverlap,
  serviceLaneRect,
  type CounterPassSlot,
  type FloorRect,
  type StructuralLayout,
} from '../../environment';
import { machineSurface, type MachineMaterialSet } from '../textures';
import type {
  BrewingMachineSpec,
  FeetKind,
  MachineArchetypeKind,
  MachineDimensions,
} from '../BrewingModule';
import type { AccessoryPlanEntry } from './accessories';

/* -------------------------------------------------------------------------- */
/* Node namespace                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Node-name namespace of the brewing domain. Both machines and accessories use
 * it — there is one bar, so there is one namespace.
 */
export const MACHINE_NODE_PREFIX = 'machines:';

/**
 * Prefix of the purpose-built materials the builders allocate themselves (steam
 * plumes, extraction drips). They deliberately do *not* look like machine
 * surfaces (`machine:<set>:<id>`): they carry no procedural map, so the era's
 * texture budget stays one texture per declared recipe.
 */
export const AUXILIARY_MATERIAL_PREFIX = 'machines-aux:';

/* -------------------------------------------------------------------------- */
/* Planning types                                                             */
/* -------------------------------------------------------------------------- */

/** Axis aligned point in metres, scene space. */
export interface MachinePlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * One machine, placed (but not yet built): the anchor it stands on, the counter
 * height it sits at, the footprint it occupies and the clearance the barista
 * needs in front of it.
 */
export interface MachinePlanEntry {
  readonly id: string;
  readonly year: YearId;
  readonly archetype: MachineArchetypeKind;
  readonly label: string;
  readonly model: string;
  /** The era's machine data this entry was planned from. */
  readonly spec: BrewingMachineSpec;
  readonly dimensions: MachineDimensions;
  /** Centre of the machine footprint, standing on the counter surface. */
  readonly position: MachinePlacement;
  /** Rotation about Y in radians; the machine fronts face the room (+Z). */
  readonly rotationY: number;
  /** Counter-pass anchor the machine stands on (`counter-pass-1`). */
  readonly slot: string;
  /** Free workspace in front of the group, metres (the barista's hands). */
  readonly clearance: number;
}

/** The planned bar: the machine and the anchor it was derived from. */
export interface MachinePlan {
  readonly entries: readonly MachinePlanEntry[];
  readonly slot: CounterPassSlot;
}

export interface MachinePlanInput {
  readonly spec: BrewingMachineSpec;
  readonly layout: StructuralLayout;
  readonly bounds: RoomBounds;
  readonly year: YearId;
}

export interface MachineBuildOptions {
  readonly materials: MachineMaterialSet;
  readonly year: YearId;
  /** Deterministic source for non-placement variation (scuffs, wear decals). */
  readonly random: () => number;
}

/** Everything the module needs from one built machine. */
export interface MachineBuild {
  readonly entry: MachinePlanEntry;
  /** The machine group, named with the machine id. */
  readonly group: THREE.Group;
  /** Wand plumes, left invisible until a steam purge runs. */
  readonly steamPlumes: readonly THREE.Mesh[];
  /** Extraction drops under the group, left invisible until a shot runs. */
  readonly drips: readonly THREE.Mesh[];
  /** Hardware that rattles while a machine cue runs. */
  readonly jiggles: readonly THREE.Object3D[];
  /** Gauge needle pivots the module trembles. */
  readonly needles: readonly THREE.Object3D[];
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

/** True when the era's machine actually carries steam wands. */
export function hasSteamWand(spec: BrewingMachineSpec): boolean {
  return spec.hasSteamWand && spec.steam.wandCount > 0;
}

/** Axis aligned footprint of a planned machine on the counter. */
export function machineFootprint(entry: MachinePlanEntry): FloorRect {
  return footprintOf(entry.position, entry.dimensions);
}

/** Plans the era's machine on the counter's machine-bay anchor. */
export function planMachines(input: MachinePlanInput): MachinePlan {
  const slot = machineBaySlot(input.layout);
  if (input.spec.dimensions.width > slot.width) {
    throw new Error(
      `The ${input.spec.label} is ${input.spec.dimensions.width.toFixed(2)} m wide but the ` +
        `${slot.id} bay is only ${slot.width.toFixed(2)} m wide.`,
    );
  }
  const position: MachinePlacement = Object.freeze({
    x: slot.position.x,
    y: slot.surfaceHeight,
    z: slot.position.z,
  });
  const entry: MachinePlanEntry = Object.freeze({
    id: input.spec.id,
    year: input.year,
    archetype: input.spec.archetype,
    label: input.spec.label,
    model: input.spec.model,
    spec: input.spec,
    dimensions: input.spec.dimensions,
    position,
    rotationY: 0,
    slot: slot.id,
    clearance: input.spec.clearance,
  });
  return Object.freeze({ entries: Object.freeze([entry]), slot });
}

/**
 * Placement rule book, shared by the module's diagnostics and the tests: every
 * machine and accessory is inside the room, the counter items stand on the
 * counter surface clear of the barista's lane, the wall-mounted items hang on
 * the back wall, and nothing two items occupy on the counter overlap.
 */
export function placementProblems(
  machines: readonly MachinePlanEntry[],
  accessories: readonly AccessoryPlanEntry[],
  layout: StructuralLayout,
  bounds: RoomBounds,
): readonly string[] {
  const problems: string[] = [];
  const counter = counterRect(layout.counter);
  const lane = serviceLaneRect(layout.serviceLane);
  const counterItems: { readonly label: string; readonly rect: FloorRect }[] = [];

  const checkCounterItem = (label: string, rect: FloorRect, position: MachinePlacement, mount: string): void => {
    if (Math.abs(position.y - layout.counter.surfaceHeight) > 1e-6) {
      problems.push(
        `${label} stands at y=${position.y.toFixed(3)} instead of the counter surface ` +
          `${layout.counter.surfaceHeight.toFixed(3)}.`,
      );
    }
    if (rect.minX < counter.minX - 1e-6 || rect.maxX > counter.maxX + 1e-6) {
      problems.push(`${label} (${mount}) overhangs the counter's width.`);
    }
    if (rect.minZ < counter.minZ - 1e-6 || rect.maxZ > counter.maxZ + 1e-6) {
      problems.push(`${label} (${mount}) overhangs the counter's depth.`);
    }
    if (rect.maxZ > lane.minZ + 1e-6) {
      problems.push(`${label} stands in the barista's service lane.`);
    }
    if (!pointInsideBounds(bounds, position, 0)) {
      problems.push(`${label} is outside the room.`);
    }
    counterItems.push({ label, rect });
  };

  for (const machine of machines) {
    checkCounterItem(machine.id, machineFootprint(machine), machine.position, 'counter');
  }

  for (const accessory of accessories) {
    const rect = footprintOf(accessory.position, accessory.dimensions);
    if (accessory.mount === 'wall') {
      if (accessory.position.z > layout.counter.backFaceZ + accessory.dimensions.depth) {
        problems.push(`${accessory.id} is mounted away from the back wall.`);
      }
      if (accessory.position.y < 0.3 || accessory.position.y > bounds.height) {
        problems.push(`${accessory.id} hangs at an impossible height (${accessory.position.y}).`);
      }
      if (
        rect.minX < -bounds.width / 2 ||
        rect.maxX > bounds.width / 2 ||
        !pointInsideBounds(bounds, accessory.position, 0)
      ) {
        problems.push(`${accessory.id} hangs outside the room.`);
      }
      continue;
    }
    if (accessory.mount === 'machine-top') {
      if (!pointInsideBounds(bounds, accessory.position, 0)) {
        problems.push(`${accessory.id} is outside the room.`);
      }
      continue;
    }
    checkCounterItem(accessory.id, rect, accessory.position, accessory.mount);
  }

  for (let left = 0; left < counterItems.length; left += 1) {
    const a = counterItems[left];
    if (!a) continue;
    for (let right = left + 1; right < counterItems.length; right += 1) {
      const b = counterItems[right];
      if (!b) continue;
      if (rectsOverlap(shrink(a.rect, OVERLAP_EPSILON), shrink(b.rect, OVERLAP_EPSILON))) {
        problems.push(`${a.label} overlaps ${b.label} on the counter.`);
      }
    }
  }

  return Object.freeze(problems);
}

/* -------------------------------------------------------------------------- */
/* Shared build helpers                                                       */
/* -------------------------------------------------------------------------- */

export interface MeshOptions {
  readonly position?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number];
  readonly scale?: number | readonly [number, number, number];
  readonly visible?: boolean;
}

/** Named mesh in the domain's node namespace. */
export function buildMesh(
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  options: MeshOptions = {},
): THREE.Mesh {
  const node = new THREE.Mesh(geometry, material);
  node.name = name;
  applyTransform(node, options);
  return node;
}

/** Named group in the domain's node namespace. */
export function buildGroup(name: string, options: MeshOptions = {}): THREE.Group {
  const node = new THREE.Group();
  node.name = name;
  applyTransform(node, options);
  return node;
}

/**
 * Makes a mesh's surface double sided. Lathed and open shells — kettle bodies,
 * pitcher bellies, carafes, filter socks — are seen from inside as well as out.
 */
export function doubleSided(mesh: THREE.Mesh): THREE.Mesh {
  const material = mesh.material;
  if (Array.isArray(material)) {
    for (const entry of material) entry.side = THREE.DoubleSide;
  } else {
    material.side = THREE.DoubleSide;
  }
  return mesh;
}

/**
 * Purpose-built material with no procedural map: steam, coffee and other
 * transient particles. Named with {@link AUXILIARY_MATERIAL_PREFIX} so the
 * surface bookkeeping ignores them.
 */
export function auxiliaryMaterial(
  key: string,
  color: number,
  opacity: number,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    name: `${AUXILIARY_MATERIAL_PREFIX}${key}`,
    color,
    transparent: true,
    opacity,
    roughness: 0.9,
    metalness: 0,
    depthWrite: false,
  });
}

/* -------------------------------------------------------------------------- */
/* Build constants                                                            */
/* -------------------------------------------------------------------------- */

const PLINTH_HEIGHT = 0.06;
const TOP_SLAB_THICKNESS = 0.03;
const PERCOLATOR_SKIRT_HEIGHT = 0.1;
const CUP_COUNT: number = 3;
const OVERLAP_EPSILON = 0.002;

/** Per-archetype node names, where the era's hardware genuinely differs. */
interface ArchetypeNodes {
  /** What the machine stands on (the 1945 percolator stands on a heating pad). */
  readonly plinth: string;
  /** Side cheeks (granite on the 2025 multi-group machine). */
  readonly cheek: string;
  /** The cup-warming rail or shelf on top. */
  readonly topRail: string;
  /** The boiler's visible shell (urn jacket, dome, heat exchanger, block). */
  readonly boilerShell: string;
}

/** Vocabulary of the five machine archetypes. */
export const ARCHETYPE_NODES: Readonly<Record<MachineArchetypeKind, ArchetypeNodes>> = Object.freeze({
  percolator: { plinth: 'heat-pad', cheek: 'pad-cheek', topRail: 'cup-shelf', boilerShell: 'urn-jacket' },
  'lever-espresso': { plinth: 'plinth', cheek: 'cheek', topRail: 'cup-rail', boilerShell: 'boiler-dome' },
  'semi-automatic': { plinth: 'plinth', cheek: 'cheek', topRail: 'cup-rail', boilerShell: 'boiler-shell' },
  'super-automatic': { plinth: 'plinth', cheek: 'cheek', topRail: 'cup-rail', boilerShell: 'boiler-block' },
  'multi-group': { plinth: 'plinth', cheek: 'granite-cheek', topRail: 'walnut-top', boilerShell: 'boiler-block' },
});

/** Overall height of one era's machine feet, in metres (top of the foot). */
export function footHeight(kind: FeetKind): number {
  switch (kind) {
    case 'cast-iron-pads':
      return 0.022;
    case 'chrome-bun-feet':
      // A bun foot is a full hemisphere: its top is a diameter above the floor.
      return 0.04;
    case 'adjustable-studs':
      return 0.03;
    case 'rubber-cups':
    default:
      return 0.018;
  }
}

/** Geometry of one era's machine feet (cast-iron pads, bun feet, studs, cups). */
function footGeometry(kind: FeetKind): THREE.BufferGeometry {
  switch (kind) {
    case 'cast-iron-pads':
      return new THREE.CylinderGeometry(0.035, 0.042, 0.022, 12);
    case 'chrome-bun-feet':
      return new THREE.SphereGeometry(0.02, 12, 8);
    case 'adjustable-studs':
      return new THREE.CylinderGeometry(0.013, 0.013, 0.03, 10);
    case 'rubber-cups':
    default:
      return new THREE.CylinderGeometry(0.024, 0.026, 0.018, 12);
  }
}

/** Profile of the 1945 percolator urn. */
interface UrnProfile {
  readonly radius: number;
  readonly bodyHeight: number;
  readonly shoulderY: number;
  readonly domeRadius: number;
}

function percolatorUrn(width: number, depth: number, deck: number, height: number): UrnProfile {
  const radius = Math.min(width * 0.46, depth * 0.5);
  const bodyHeight = height * 0.48;
  const domeRadius = radius * 0.9;
  return Object.freeze({
    radius,
    bodyHeight,
    shoulderY: deck + bodyHeight,
    domeRadius,
  });
}

/* -------------------------------------------------------------------------- */
/* Machine builder                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Raises one era's machine: the same programme of parts, driven entirely by the
 * era's data and material set.
 */
class MachineBuilder {
  private readonly entry: MachinePlanEntry;
  private readonly spec: BrewingMachineSpec;
  private readonly materials: MachineMaterialSet;
  private readonly random: () => number;
  private readonly nodes: ArchetypeNodes;

  private readonly root: THREE.Group;
  private readonly plumes: THREE.Mesh[] = [];
  private readonly drips: THREE.Mesh[] = [];
  private readonly jiggles: THREE.Object3D[] = [];
  private readonly needles: THREE.Object3D[] = [];
  private readonly auxiliaries = new Map<string, THREE.MeshStandardMaterial>();

  private readonly width: number;
  private readonly depth: number;
  private readonly height: number;
  /** Z of the front face (the side the customer and barista see). */
  private readonly front: number;
  /** Y the machine's working furniture stands on. */
  private readonly deck: number;
  /** Y of the top of the cabinet body. */
  private readonly cabinetTop: number;
  /** Y of the top slab's upper face (the machine's shoulders). */
  private readonly shoulderTop: number;
  private readonly urn: UrnProfile | null;

  constructor(entry: MachinePlanEntry, spec: BrewingMachineSpec, options: MachineBuildOptions) {
    this.entry = entry;
    this.spec = spec;
    this.materials = options.materials;
    this.random = options.random;
    this.nodes = ARCHETYPE_NODES[spec.archetype];

    this.width = spec.dimensions.width;
    this.depth = spec.dimensions.depth;
    this.height = spec.dimensions.height;
    this.front = this.depth / 2;

    const feetHeight = footHeight(spec.housing.feet);
    const plinthTop = feetHeight + PLINTH_HEIGHT;
    this.deck = spec.archetype === 'percolator' ? plinthTop + PERCOLATOR_SKIRT_HEIGHT : plinthTop;
    this.urn =
      spec.archetype === 'percolator'
        ? percolatorUrn(this.width, this.depth, this.deck, this.height)
        : null;
    this.cabinetTop =
      this.urn === null ? Math.max(this.deck + 0.14, this.height * 0.74) : this.urn.shoulderY;
    this.shoulderTop = this.cabinetTop + TOP_SLAB_THICKNESS;

    this.root = buildGroup(spec.id, {
      position: [entry.position.x, entry.position.y, entry.position.z],
      rotation: [0, entry.rotationY, 0],
    });
    this.root.userData['machineId'] = spec.id;
    this.root.userData['archetype'] = spec.archetype;
    this.root.userData['year'] = options.year;
    this.root.userData['slot'] = entry.slot;
    this.root.userData['clearance'] = entry.clearance;
    this.root.userData['panelStyle'] = spec.housing.panelStyle;
    this.root.userData['wearLevel'] = spec.housing.wearLevel;
  }

  /** Builds the machine and hands the animated nodes back to the module. */
  build(): MachineBuild {
    this.buildPlinth();
    this.buildFeet();
    this.buildCabinet();
    this.buildBoiler();
    this.buildSteamPipes();
    if (this.urn !== null) {
      this.buildPercolatorUrn();
    } else if (this.spec.steam.sightGlass) {
      this.buildSightGlass();
    }
    this.buildGroups();
    this.buildWands();
    this.buildLever();
    this.buildDials();
    this.buildDoseControls();
    this.buildDisplays();
    this.buildLamps();
    this.buildCupStation();
    this.buildDripTray();
    this.buildBeanHopper();
    if (this.spec.knockBox) this.buildKnockBox();
    this.buildWear();

    return {
      entry: this.entry,
      group: this.root,
      steamPlumes: Object.freeze([...this.plumes]),
      drips: Object.freeze([...this.drips]),
      jiggles: Object.freeze([...this.jiggles]),
      needles: Object.freeze([...this.needles]),
    };
  }

  /* -- part helpers --------------------------------------------------------- */

  private surface(id: string): THREE.MeshStandardMaterial {
    return machineSurface(this.materials, id);
  }

  private part(part: string): string {
    return `${this.spec.id}:${part}`;
  }

  private add(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    options: MeshOptions = {},
    parent: THREE.Object3D = this.root,
  ): THREE.Mesh {
    const node = buildMesh(this.part(name), geometry, material, options);
    parent.add(node);
    return node;
  }

  private addGroup(
    name: string,
    options: MeshOptions = {},
    parent: THREE.Object3D = this.root,
  ): THREE.Group {
    const node = buildGroup(this.part(name), options);
    parent.add(node);
    return node;
  }

  private auxiliary(key: string, color: number, opacity: number): THREE.MeshStandardMaterial {
    const existing = this.auxiliaries.get(key);
    if (existing) return existing;
    const material = auxiliaryMaterial(key, color, opacity);
    this.auxiliaries.set(key, material);
    return material;
  }

  /**
   * Marks hardware that rattles while `cue` runs, remembering the rest pose the
   * module's animation has to return to.
   */
  private rattle(node: THREE.Object3D, cue: string): THREE.Object3D {
    node.userData['machineCue'] = cue;
    if (node.userData['baseRotationZ'] === undefined) node.userData['baseRotationZ'] = node.rotation.z;
    this.jiggles.push(node);
    return node;
  }

  /** X of group `index` of the era's group battery. */
  private groupX(index: number): number {
    const count = Math.max(this.spec.groupCount, 1);
    const spread = Math.min(this.width * 0.62, 0.18 * (count - 1) + 0.05);
    const step = count === 1 ? 0 : spread / (count - 1);
    return (index - (count - 1) / 2) * step;
  }

  /* -- structure ------------------------------------------------------------ */

  private buildPlinth(): void {
    const body = this.surface(this.spec.housing.body);
    const plinthTop = this.deck - (this.urn === null ? 0 : PERCOLATOR_SKIRT_HEIGHT);
    const plinth = this.add(
      this.nodes.plinth,
      new THREE.BoxGeometry(this.width * 0.96, PLINTH_HEIGHT, this.depth * 0.94),
      body,
      { position: [0, plinthTop - PLINTH_HEIGHT / 2, 0] },
    );
    plinth.userData['material'] = this.spec.housing.body;
  }

  private buildFeet(): void {
    const height = footHeight(this.spec.housing.feet);
    const geometry = footGeometry(this.spec.housing.feet);
    const material =
      this.spec.housing.feet === 'cast-iron-pads'
        ? this.surface(this.spec.housing.body)
        : this.surface(this.spec.housing.trim);
    const halfX = this.width * 0.42;
    const halfZ = this.depth * 0.4;
    const corners: readonly (readonly [number, number])[] = [
      [-halfX, -halfZ],
      [halfX, -halfZ],
      [-halfX, halfZ],
      [halfX, halfZ],
    ];
    corners.forEach((corner, index) => {
      this.add(`foot-${index + 1}`, geometry, material, {
        position: [corner[0], height / 2, corner[1]],
      });
    });
  }

  private buildCabinet(): void {
    const housing = this.spec.housing;
    const cheek = this.surface(housing.cheek);
    const panel = this.surface(housing.panel);

    if (this.urn !== null) {
      // The percolator urn's enamelled skirt: the era's chassis is a cast-iron
      // pad with a belted enamel body sitting on it.
      const skirtY = this.deck - PERCOLATOR_SKIRT_HEIGHT / 2;
      this.add(
        'pad-skirt',
        new THREE.BoxGeometry(this.width * 0.94, PERCOLATOR_SKIRT_HEIGHT, this.depth * 0.9),
        cheek,
        { position: [0, skirtY, 0] },
      );
      const cheekGeometry = new THREE.BoxGeometry(0.016, PERCOLATOR_SKIRT_HEIGHT * 0.96, this.depth * 0.84);
      for (const side of [-1, 1] as const) {
        this.add(`${this.nodes.cheek}-${side < 0 ? 1 : 2}`, cheekGeometry, cheek, {
          position: [side * (this.width / 2 - 0.008), skirtY, 0],
        });
      }
      const ventCount = Math.max(Math.trunc(housing.ventCount), 0);
      const ventGeometry = new THREE.BoxGeometry(this.width * 0.42, 0.007, 0.012);
      for (let index = 0; index < ventCount; index += 1) {
        const t = ventCount === 1 ? 0.5 : index / (ventCount - 1);
        this.add(`vent-${index + 1}`, ventGeometry, cheek, {
          position: [(t - 0.5) * this.width * 0.5, skirtY, this.depth * 0.46],
        });
      }
      this.add(
        'switch-escutcheon',
        new THREE.BoxGeometry(this.width * 0.32, 0.04, 0.006),
        panel,
        { position: [this.width * 0.24, skirtY, this.depth * 0.47] },
      );
      return;
    }

    const body = this.surface(housing.body);
    const front = this.surface(housing.front);
    const trim = this.surface(housing.trim);
    const cabinetHeight = this.cabinetTop - this.deck;
    const cabinetY = this.deck + cabinetHeight / 2;

    this.add(
      'cabinet',
      new THREE.BoxGeometry(this.width, cabinetHeight, this.depth),
      body,
      { position: [0, cabinetY, 0] },
    );

    // The era's face: enamelled, crackle-painted, stainless or graphite.
    const fasciaHeight = cabinetHeight * 0.72;
    this.add(
      'fascia',
      new THREE.BoxGeometry(this.width * 0.94, fasciaHeight, 0.02),
      front,
      { position: [0, this.deck + fasciaHeight * 0.58, this.front + 0.01] },
    );

    // Maker's plate with the era's printed lettering.
    this.add(
      'maker-plate',
      new THREE.BoxGeometry(this.width * 0.34, Math.max(0.045, fasciaHeight * 0.16), 0.008),
      panel,
      { position: [-this.width * 0.16, this.deck + fasciaHeight * 0.92, this.front + 0.022] },
    );

    // Control panel plate the dose keys / rockers are set into.
    this.add(
      'panel-plate',
      new THREE.BoxGeometry(this.width * 0.42, fasciaHeight * 0.44, 0.01),
      panel,
      { position: [this.width * 0.2, this.deck + fasciaHeight * 0.42, this.front + 0.02] },
    );

    // Cheeks: chrome, stainless, granite — the era's cladding.
    const cheekHeight = cabinetHeight * 0.88;
    const cheekGeometry = new THREE.BoxGeometry(0.02, cheekHeight, this.depth * 0.9);
    for (const side of [-1, 1] as const) {
      this.add(`${this.nodes.cheek}-${side < 0 ? 1 : 2}`, cheekGeometry, cheek, {
        position: [side * (this.width / 2 - 0.01), this.deck + cheekHeight / 2, 0],
      });
    }

    // Louvres pressed into the back: the era's venting.
    const ventCount = Math.max(Math.trunc(housing.ventCount), 0);
    if (ventCount > 0) {
      const ventGeometry = new THREE.BoxGeometry(this.width * 0.7, 0.008, 0.012);
      for (let index = 0; index < ventCount; index += 1) {
        const t = ventCount === 1 ? 0.5 : index / (ventCount - 1);
        this.add(`vent-${index + 1}`, ventGeometry, body, {
          position: [0, this.deck + cabinetHeight * (0.2 + t * 0.6), -this.depth / 2 - 0.006],
        });
      }
    }

    // Polished top slab: the machine's shoulders.
    this.add(
      'top-slab',
      new THREE.BoxGeometry(this.width * 1.02, TOP_SLAB_THICKNESS, this.depth),
      trim,
      { position: [0, this.cabinetTop + TOP_SLAB_THICKNESS / 2, 0] },
    );
  }

  private buildBoiler(): void {
    if (this.urn !== null) return;
    const boiler = this.surface(this.spec.housing.boiler);
    const trim = this.surface(this.spec.housing.trim);
    const top = this.shoulderTop;
    const tankZ = -this.depth * 0.28;

    switch (this.spec.archetype) {
      case 'lever-espresso': {
        const radius = Math.min(this.width * 0.3, this.depth * 0.34);
        this.add(
          'boiler-dome',
          new THREE.SphereGeometry(radius, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2),
          boiler,
          { position: [0, top, -this.depth * 0.3] },
        );
        this.add(
          'boiler-dome-band',
          new THREE.TorusGeometry(radius, 0.008, 8, 22),
          trim,
          { position: [0, top, -this.depth * 0.3], rotation: [Math.PI / 2, 0, 0] },
        );
        this.add(
          'boiler-relief',
          new THREE.CylinderGeometry(0.01, 0.012, 0.026, 10),
          trim,
          { position: [radius * 0.6, top + radius * 0.8, -this.depth * 0.3] },
        );
        break;
      }
      case 'semi-automatic': {
        const radius = this.depth * 0.13;
        this.add(
          'boiler-shell',
          new THREE.CylinderGeometry(radius, radius, this.width * 0.7, 18),
          boiler,
          { position: [0, top + radius, tankZ], rotation: [0, 0, Math.PI / 2] },
        );
        const bandGeometry = new THREE.TorusGeometry(radius * 1.04, 0.006, 8, 18);
        for (const side of [-1, 1] as const) {
          this.add(`boiler-shell-band-${side < 0 ? 1 : 2}`, bandGeometry, trim, {
            position: [side * this.width * 0.2, top + radius, tankZ],
            rotation: [0, Math.PI / 2, 0],
          });
        }
        break;
      }
      case 'super-automatic':
      case 'multi-group':
      default: {
        this.add(
          this.nodes.boilerShell,
          new THREE.BoxGeometry(this.width * 0.7, 0.14, this.depth * 0.34),
          boiler,
          { position: [0, top + 0.07, tankZ] },
        );
        this.add(
          'boiler-block-rail',
          new THREE.BoxGeometry(this.width * 0.72, 0.012, this.depth * 0.35),
          trim,
          { position: [0, top + 0.146, tankZ] },
        );
        this.add(
          'boiler-relief',
          new THREE.CylinderGeometry(0.012, 0.014, 0.03, 10),
          trim,
          { position: [this.width * 0.3, top + 0.16, tankZ] },
        );
        break;
      }
    }
  }

  /** Visible pipe runs of the steam path. */
  private buildSteamPipes(): void {
    const pipe = this.surface(this.spec.housing.pipe);
    const trim = this.surface(this.spec.housing.trim);
    const count = Math.max(Math.trunc(this.spec.steam.pipeRuns), 0);
    if (count === 0) return;
    const urn = this.urn;

    const geometry = new THREE.CylinderGeometry(0.008, 0.008, urn === null ? 0.18 : 0.28, 8);
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0.5 : index / (count - 1);
      const x = urn === null ? (t - 0.5) * this.width * 0.52 : (index === 0 ? -1 : 1) * (urn.radius + 0.026);
      const y = urn === null ? this.deck + 0.18 : this.deck + urn.bodyHeight * 0.5;
      const z = urn === null ? this.front + 0.018 : urn.radius * 0.6;
      this.add(`pipe-${index + 1}`, geometry, pipe, { position: [x, y, z] });
      this.add(
        `pipe-${index + 1}-elbow`,
        new THREE.SphereGeometry(0.012, 10, 8),
        trim,
        { position: [x, y + (urn === null ? 0.09 : 0.14), z] },
      );
    }
  }

  private buildSightGlass(): void {
    const glass = this.surface(this.spec.housing.glass);
    const trim = this.surface(this.spec.housing.trim);
    const height = (this.cabinetTop - this.deck) * 0.5;
    const x = -(this.width / 2 - 0.02);
    const y = this.deck + height / 2 + 0.02;
    const z = this.front + 0.016;
    this.add('sight-glass', new THREE.CylinderGeometry(0.011, 0.011, height, 12), glass, {
      position: [x, y, z],
    });
    const capGeometry = new THREE.CylinderGeometry(0.015, 0.015, 0.012, 12);
    for (const end of [-1, 1] as const) {
      this.add(`sight-glass-cap-${end < 0 ? 1 : 2}`, capGeometry, trim, {
        position: [x, y + end * (height / 2), z],
      });
    }
  }

  /* -- archetype specific furniture ----------------------------------------- */

  private buildPercolatorUrn(): void {
    const urn = this.urn;
    if (urn === null) return;
    const envelope = this.surface(this.spec.housing.front);
    const trim = this.surface(this.spec.housing.trim);
    const handle = this.surface(this.spec.housing.handle);
    const glass = this.surface(this.spec.housing.glass);
    const boiler = this.surface(this.spec.housing.boiler);
    const pipe = this.surface(this.spec.housing.pipe);

    const bodyY = this.deck + urn.bodyHeight / 2;
    this.add(
      'urn-body',
      new THREE.CylinderGeometry(urn.radius, urn.radius * 0.95, urn.bodyHeight, 24),
      envelope,
      { position: [0, bodyY, 0] },
    );
    this.add(
      'urn-band',
      new THREE.TorusGeometry(urn.radius * 0.99, 0.006, 8, 24),
      trim,
      { position: [0, urn.shoulderY - urn.bodyHeight * 0.12, 0], rotation: [Math.PI / 2, 0, 0] },
    );
    this.add(
      'urn-band-base',
      new THREE.TorusGeometry(urn.radius * 0.96, 0.007, 8, 24),
      trim,
      { position: [0, this.deck + 0.012, 0], rotation: [Math.PI / 2, 0, 0] },
    );
    // Domed lid with the glass percolator knob that shows the pump action.
    this.add(
      'urn-lid',
      new THREE.SphereGeometry(urn.domeRadius, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      envelope,
      { position: [0, urn.shoulderY, 0] },
    );
    this.add('urn-lid-rim', new THREE.TorusGeometry(urn.radius * 1.01, 0.005, 8, 24), trim, {
      position: [0, urn.shoulderY + 0.002, 0],
      rotation: [Math.PI / 2, 0, 0],
    });
    this.add('perc-knob', new THREE.SphereGeometry(0.017, 12, 8), glass, {
      position: [0, urn.shoulderY + urn.domeRadius * 0.96, 0],
    });
    // Tinned copper jacket and the percolator tube inside.
    this.add(
      'urn-jacket',
      new THREE.CylinderGeometry(urn.radius * 0.8, urn.radius * 0.8, urn.bodyHeight * 0.7, 20),
      boiler,
      { position: [0, this.deck + urn.bodyHeight * 0.42, 0] },
    );
    this.add(
      'perc-tube',
      new THREE.CylinderGeometry(0.011, 0.011, urn.bodyHeight * 1.02, 10),
      pipe,
      { position: [0, this.deck + urn.bodyHeight * 0.55, 0] },
    );
    this.add(
      'perforated-basket',
      new THREE.CylinderGeometry(urn.radius * 0.68, urn.radius * 0.5, 0.06, 20),
      trim,
      { position: [0, urn.shoulderY - 0.04, 0] },
    );
    // Brass spigot with its bakelite tap over an enamel drip bowl.
    this.add(
      'spigot',
      new THREE.CylinderGeometry(0.012, 0.012, 0.05, 10),
      trim,
      { position: [0, this.deck + urn.bodyHeight * 0.24, urn.radius + 0.022], rotation: [Math.PI / 2, 0, 0] },
    );
    this.add(
      'spigot-tap',
      new THREE.BoxGeometry(0.02, 0.032, 0.012),
      handle,
      { position: [0, this.deck + urn.bodyHeight * 0.28, urn.radius + 0.052] },
    );
    this.add(
      'spigot-support',
      new THREE.CylinderGeometry(0.03, 0.036, 0.012, 12),
      trim,
      { position: [0, this.deck + urn.bodyHeight * 0.2, urn.radius + 0.02] },
    );
    // Sight tube between two brass caps on the flank.
    const tubeHeight = urn.bodyHeight * 0.52;
    this.add(
      'urn-sight-tube',
      new THREE.CylinderGeometry(0.01, 0.01, tubeHeight, 12),
      glass,
      { position: [urn.radius * 0.94, this.deck + urn.bodyHeight * 0.5, urn.radius * 0.34] },
    );
    const capGeometry = new THREE.CylinderGeometry(0.014, 0.014, 0.01, 12);
    for (const end of [-1, 1] as const) {
      this.add(`urn-sight-cap-${end < 0 ? 1 : 2}`, capGeometry, trim, {
        position: [
          urn.radius * 0.94,
          this.deck + urn.bodyHeight * 0.5 + end * (tubeHeight / 2),
          urn.radius * 0.34,
        ],
      });
    }
  }

  private buildGroups(): void {
    const count = this.spec.hasEspressoGroup ? Math.max(Math.trunc(this.spec.groupCount), 0) : 0;
    if (count === 0) return;
    const trim = this.surface(this.spec.housing.trim);
    const handle = this.surface(this.spec.housing.handle);
    const boiler = this.surface(this.spec.housing.boiler);
    const saturated = this.spec.steam.groupHead === 'saturated-groups';
    const head = saturated ? boiler : trim;
    const radius = count > 2 ? 0.036 : 0.042;
    const y = this.deck + 0.1;

    for (let index = 0; index < count; index += 1) {
      const x = this.groupX(index);
      const z = this.front - 0.012;
      this.add(`group-${index + 1}-body`, new THREE.CylinderGeometry(radius, radius, 0.05, 16), head, {
        position: [x, y, z],
      });
      this.add(
        `group-${index + 1}-ring`,
        new THREE.TorusGeometry(radius * 1.06, 0.006, 8, 16),
        trim,
        { position: [x, y - 0.024, z], rotation: [Math.PI / 2, 0, 0] },
      );
      this.add(`group-${index + 1}-spout`, new THREE.CylinderGeometry(0.008, 0.008, 0.03, 10), trim, {
        position: [x, y - 0.055, z],
      });
      this.add(
        `group-${index + 1}-portafilter`,
        new THREE.CylinderGeometry(radius * 0.92, radius * 0.92, 0.014, 16),
        trim,
        { position: [x, y - 0.075, z] },
      );
      this.add(
        `group-${index + 1}-handle`,
        new THREE.BoxGeometry(0.012, 0.012, 0.09),
        handle,
        { position: [x, y - 0.075, z + 0.06] },
      );
    }
  }

  private buildWands(): void {
    if (!hasSteamWand(this.spec)) return;
    const count = Math.max(Math.trunc(this.spec.steam.wandCount), 0);
    if (count === 0) return;
    const pipe = this.surface(this.spec.housing.pipe);
    const handle = this.surface(this.spec.housing.handle);
    const steam = this.auxiliary('steam', 0xdfe8ec, 0.34);
    const armLength = Math.max(this.spec.steam.wandLength, 0.12);
    const pivotY = this.cabinetTop - 0.05;
    const z = this.front - 0.05;

    for (let index = 0; index < count; index += 1) {
      const side: -1 | 1 = count === 1 || index > 0 ? 1 : -1;
      const x = side * (this.width / 2 + 0.018);
      const wand = this.addGroup(`steam-wand-${index + 1}`, { position: [x, pivotY, z] });
      this.add(`steam-wand-${index + 1}-joint`, new THREE.SphereGeometry(0.017, 12, 8), handle, {}, wand);
      this.add(
        `steam-wand-${index + 1}-arm`,
        new THREE.CylinderGeometry(0.0085, 0.0085, armLength, 10),
        pipe,
        { position: [0, -armLength / 2, 0], rotation: [0, 0, side * 0.1] },
        wand,
      );
      this.add(
        `steam-wand-${index + 1}-tip`,
        new THREE.ConeGeometry(0.011, 0.03, 10),
        handle,
        { position: [0, -armLength - 0.014, 0] },
        wand,
      );
      const tipY = pivotY - armLength - 0.03;
      for (let plume = 0; plume < 2; plume += 1) {
        const baseY = tipY - plume * 0.035;
        const mesh = this.add(
          `steam-wand-${index + 1}-plume-${plume + 1}`,
          new THREE.SphereGeometry(0.028 + plume * 0.012, 10, 8),
          steam,
          { position: [x, baseY, z + 0.012], visible: false },
        );
        mesh.userData['baseY'] = baseY;
        this.plumes.push(mesh);
      }
    }
  }

  private buildLever(): void {
    if (this.spec.archetype !== 'lever-espresso') return;
    const trim = this.surface(this.spec.housing.trim);
    const handle = this.surface(this.spec.housing.handle);
    const x = this.groupX(0);
    const y = this.deck + (this.cabinetTop - this.deck) * 0.78;
    const z = this.front + 0.02;
    const pivot = this.addGroup('lever', { position: [x, y, z] });
    this.add('lever-pivot', new THREE.CylinderGeometry(0.016, 0.016, 0.05, 12), trim, {
      rotation: [0, 0, Math.PI / 2],
    }, pivot);
    this.add(
      'lever-arm',
      new THREE.BoxGeometry(0.018, 0.3, 0.026),
      trim,
      { position: [0, 0.15, 0.02], rotation: [0.14, 0, 0] },
      pivot,
    );
    this.add('lever-knob', new THREE.SphereGeometry(0.021, 12, 8), handle, {
      position: [0, 0.3, 0.06],
    }, pivot);
  }

  private buildDials(): void {
    const trim = this.surface(this.spec.housing.trim);
    const gauges = this.spec.dials.filter((dial) => dial.face === 'gauge');
    const gaugeWidth = this.width * 0.2;
    for (const dial of this.spec.dials) {
      const face = this.surface(dial.slot);
      const bezel = this.surface(dial.bezel);
      if (dial.face === 'gauge') {
        const index = gauges.indexOf(dial);
        const x = -this.width * 0.34 + index * gaugeWidth;
        const y = this.deck + (this.cabinetTop - this.deck) * 0.6;
        const z = this.front + 0.03;
        const radius = 0.034;
        this.add(
          `dial-${dial.id}-bezel`,
          new THREE.CylinderGeometry(radius * 1.2, radius * 1.2, 0.014, 20),
          bezel,
          { position: [x, y, z], rotation: [Math.PI / 2, 0, 0] },
        );
        this.add(
          `dial-${dial.id}-face`,
          new THREE.CylinderGeometry(radius, radius, 0.005, 20),
          face,
          { position: [x, y, z + 0.009], rotation: [Math.PI / 2, 0, 0] },
        );
        const needle = this.addGroup(`dial-${dial.id}-needle`, { position: [x, y, z + 0.013] });
        const baseRotation = -(dial.needle ?? 0.5) * Math.PI * 0.9 + Math.PI * 0.45;
        needle.rotation.z = baseRotation;
        needle.userData['baseRotationZ'] = baseRotation;
        needle.userData['gauge'] = dial.id;
        this.add(
          `dial-${dial.id}-needle-blade`,
          new THREE.BoxGeometry(0.004, radius * 0.82, 0.003),
          trim,
          { position: [0, radius * 0.34, 0] },
          needle,
        );
        this.needles.push(needle);
        continue;
      }
      // Switches and knobs sit on their own printed escutcheon.
      const x = this.width * 0.16;
      const y =
        this.urn === null
          ? this.deck + (this.cabinetTop - this.deck) * 0.16
          : this.deck - PERCOLATOR_SKIRT_HEIGHT * 0.5;
      const z = this.urn === null ? this.front + 0.03 : this.depth * 0.48;
      this.add(
        `dial-${dial.id}-face`,
        new THREE.CylinderGeometry(0.028, 0.028, 0.005, 16),
        face,
        { position: [x, y, z], rotation: [Math.PI / 2, 0, 0] },
      );
      this.add(
        `dial-${dial.id}-knob`,
        new THREE.CylinderGeometry(0.013, 0.016, 0.028, 14),
        bezel,
        { position: [x, y, z + 0.016], rotation: [Math.PI / 2, 0, 0] },
      );
    }
  }

  private buildDoseControls(): void {
    const panel = this.surface(this.spec.housing.panel);
    switch (this.spec.dosingKind) {
      case 'volumetric-buttons':
      case 'digital-dosing': {
        const count = this.spec.dosingKind === 'volumetric-buttons' ? 3 : 4;
        const keyWidth = Math.min(0.05, this.width * 0.1);
        const geometry = new THREE.BoxGeometry(keyWidth, 0.022, 0.01);
        const y = this.deck + (this.cabinetTop - this.deck) * 0.38;
        for (let index = 0; index < count; index += 1) {
          this.add(`dose-button-${index + 1}`, geometry, panel, {
            position: [this.width * 0.08 + index * keyWidth * 1.35, y, this.front + 0.026],
          });
        }
        break;
      }
      case 'lever-pull':
        this.buildLeverCam();
        break;
      case 'touch-dosing':
      case 'none':
      default:
        break;
    }
  }

  /**
   * The cam the spring lever's arm turns on. The lever itself belongs to the
   * group head and is built by {@link MachineBuilder.buildLever}; this is the
   * cam plate visible on the fascia of a lever-pull machine.
   */
  private buildLeverCam(): void {
    const trim = this.surface(this.spec.housing.trim);
    this.add('group-lever-cam', new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12), trim, {
      position: [this.groupX(0), this.deck + 0.16, this.front + 0.02],
      rotation: [0, 0, Math.PI / 2],
    });
  }

  private buildDisplays(): void {
    const display = this.surface(this.spec.housing.display);
    const glass = this.surface(this.spec.housing.glass);
    const panel = this.surface(this.spec.housing.panel);
    const y = this.deck + (this.cabinetTop - this.deck) * 0.66;

    if (this.spec.hasTouchPanel) {
      const width = this.width * 0.52;
      const height = 0.1;
      const x = -this.width * 0.3;
      this.add('touch-panel', new THREE.BoxGeometry(width, height, 0.012), display, {
        position: [x, y, this.front + 0.03],
      });
      this.add('touch-panel-glass', new THREE.BoxGeometry(width * 1.04, height * 1.08, 0.004), glass, {
        position: [x, y, this.front + 0.038],
      });
      const rowGeometry = new THREE.BoxGeometry(width * 0.34, 0.012, 0.004);
      for (let index = 0; index < 3; index += 1) {
        this.add(`touch-row-${index + 1}`, rowGeometry, panel, {
          position: [x - width * 0.3, y - height * 0.3 + index * 0.03, this.front + 0.042],
        });
      }
      this.add('setpoint-bar', new THREE.BoxGeometry(width * 0.9, 0.01, 0.004), display, {
        position: [x, y - height * 0.38, this.front + 0.042],
      });
      return;
    }

    if (this.spec.hasDigitalDisplay) {
      const x = -this.width * 0.2;
      this.add('lcd-screen', new THREE.BoxGeometry(this.width * 0.34, 0.06, 0.01), display, {
        position: [x, y, this.front + 0.03],
      });
      this.add('lcd-glass', new THREE.BoxGeometry(this.width * 0.36, 0.072, 0.004), glass, {
        position: [x, y, this.front + 0.038],
      });
      return;
    }

    // Printed and silk-screened eras: the "display" surface is a lettered plate.
    this.add(
      'legend-plate',
      new THREE.BoxGeometry(this.width * 0.34, 0.05, 0.008),
      display,
      { position: [this.width * 0.2, this.deck + (this.cabinetTop - this.deck) * 0.82, this.front + 0.026] },
    );
  }

  private buildLamps(): void {
    const geometry = new THREE.SphereGeometry(0.009, 10, 8);
    let index = 0;
    const y = this.deck + (this.cabinetTop - this.deck) * 0.95;
    for (const lamp of this.spec.lamps) {
      const material = this.surface(lamp.slot);
      const count = Math.max(Math.trunc(lamp.count), 1);
      for (let position = 0; position < count; position += 1) {
        index += 1;
        this.add(`lamp-${index}`, geometry, material, {
          position: [-this.width * 0.34 + position * 0.03, y, this.front + 0.024],
        });
      }
    }
  }

  private buildCupStation(): void {
    const cup = this.surface(this.spec.housing.cup);
    const railMaterial =
      this.spec.archetype === 'multi-group'
        ? this.surface(this.spec.housing.handle)
        : this.surface(this.spec.housing.trim);
    const trim = this.surface(this.spec.housing.trim);
    const cupGeometry = new THREE.CylinderGeometry(0.026, 0.02, 0.034, 14);
    const saucerGeometry = new THREE.CylinderGeometry(0.032, 0.032, 0.006, 16);
    const urn = this.urn;

    if (urn !== null) {
      // The urn's cup rack: a ring shelf at the shoulder with cups stood around it.
      const shelfY = this.deck + urn.bodyHeight * 0.8;
      const shelf = this.add(
        this.nodes.topRail,
        new THREE.CylinderGeometry(urn.radius * 1.3, urn.radius * 1.26, 0.012, 24),
        this.surface(this.spec.housing.front),
        { position: [0, shelfY, 0] },
      );
      this.rattle(shelf, 'cup-clatter');
      this.add(
        'cup-shelf-rim',
        new THREE.TorusGeometry(urn.radius * 1.3, 0.005, 8, 24),
        trim,
        { position: [0, shelfY, 0], rotation: [Math.PI / 2, 0, 0] },
      );
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2 + Math.PI * 0.25;
        const x = Math.cos(angle) * urn.radius * 1.14;
        const z = Math.sin(angle) * urn.radius * 1.14;
        this.add(`cup-${index + 1}`, cupGeometry, cup, {
          position: [x, shelfY + 0.024, z],
        });
        this.add(`saucer-${index + 1}`, saucerGeometry, trim, {
          position: [x, shelfY + 0.009, z],
        });
      }
      return;
    }

    // Counter machines warm their cups on the rail behind the top slab.
    const railY = this.shoulderTop + 0.007;
    const railWidth = this.spec.archetype === 'super-automatic' ? this.width * 0.46 : this.width * 0.86;
    const railX = this.spec.archetype === 'super-automatic' ? this.width * 0.24 : 0;
    const rail = this.add(
      this.nodes.topRail,
      new THREE.BoxGeometry(railWidth, 0.014, this.depth * 0.26),
      railMaterial,
      { position: [railX, railY, this.depth * 0.08] },
    );
    this.rattle(rail, 'cup-clatter');
    for (let index = 0; index < CUP_COUNT; index += 1) {
      const t = CUP_COUNT === 1 ? 0.5 : index / (CUP_COUNT - 1);
      const x = railX + (t - 0.5) * railWidth * 0.82;
      this.add(`cup-${index + 1}`, cupGeometry, cup, {
        position: [x, railY + 0.031, this.depth * 0.08],
      });
      this.add(`saucer-${index + 1}`, saucerGeometry, trim, {
        position: [x, railY + 0.017, this.depth * 0.08],
      });
    }
    if (this.spec.cupWarmer === 'heated-drawer') {
      const y = this.cabinetTop - 0.09;
      this.add('cup-drawer', new THREE.BoxGeometry(this.width * 0.84, 0.05, 0.02), trim, {
        position: [0, y, this.front + 0.004],
      });
      this.add('cup-drawer-handle', new THREE.BoxGeometry(this.width * 0.3, 0.012, 0.018), railMaterial, {
        position: [0, y, this.front + 0.02],
      });
    }
  }

  private buildDripTray(): void {
    const trayMaterial = this.surface(this.spec.housing.cheek);
    const trim = this.surface(this.spec.housing.trim);
    const y = this.deck + 0.055;
    const z = this.front - this.depth * 0.16;
    const tray = this.add(
      'drip-tray',
      new THREE.BoxGeometry(this.width * 0.92, 0.02, this.depth * 0.32),
      trayMaterial,
      { position: [0, y, z] },
    );
    this.rattle(tray, 'cup-clatter');
    this.add('drip-grid', new THREE.BoxGeometry(this.width * 0.86, 0.006, this.depth * 0.26), trim, {
      position: [0, y + 0.013, z],
    });
    const drip = this.auxiliary('drip', 0x4a2f1b, 0.6);
    for (let index = 0; index < 2; index += 1) {
      const mesh = this.add(
        `extraction-drip-${index + 1}`,
        new THREE.SphereGeometry(0.006 + index * 0.002, 8, 6),
        drip,
        {
          position: [
            this.spec.hasEspressoGroup ? this.groupX(0) : 0,
            y + 0.06 + index * 0.03,
            this.front - 0.02,
          ],
          visible: false,
        },
      );
      this.drips.push(mesh);
    }
  }

  private buildBeanHopper(): void {
    if (this.spec.archetype !== 'super-automatic') return;
    const glass = this.surface(this.spec.housing.glass);
    const trim = this.surface(this.spec.housing.trim);
    const body = this.surface(this.spec.housing.body);
    const x = -this.width * 0.24;
    const z = this.depth * 0.16;
    const y = this.shoulderTop + 0.07;
    const hopper = this.add(
      'bean-hopper',
      new THREE.CylinderGeometry(0.078, 0.062, 0.14, 18),
      glass,
      { position: [x, y, z] },
    );
    this.rattle(hopper, 'grind');
    this.add('bean-hopper-lid', new THREE.CylinderGeometry(0.08, 0.08, 0.012, 18), trim, {
      position: [x, y + 0.076, z],
    });
    this.add('grinder-chute', new THREE.BoxGeometry(0.05, 0.03, 0.06), body, {
      position: [x, y - 0.085, z - 0.01],
    });
  }

  private buildKnockBox(): void {
    const trim = this.surface(this.spec.housing.trim);
    const bar = this.surface(this.spec.housing.handle);
    const y = this.deck + 0.018;
    const z = this.front - this.depth * 0.04;
    this.add('knock-drawer', new THREE.BoxGeometry(this.width * 0.88, 0.05, this.depth * 0.24), trim, {
      position: [0, y, z],
    });
    const knockBar = this.add(
      'knock-bar',
      new THREE.CylinderGeometry(0.012, 0.012, this.width * 0.68, 12),
      bar,
      { position: [0, y + 0.04, z], rotation: [0, 0, Math.PI / 2] },
    );
    this.rattle(knockBar, 'milk-knock');
  }

  private buildWear(): void {
    const wear = this.surface(this.spec.housing.wearPatch);
    const count = Math.max(1, Math.round(this.spec.housing.wearLevel * 6));
    const geometry = new THREE.PlaneGeometry(0.07, 0.05);
    const spanY = Math.max(this.cabinetTop - this.deck, 0.1);
    for (let index = 0; index < count; index += 1) {
      const x = (this.random() - 0.5) * this.width * 0.7;
      const y = this.deck + 0.02 + this.random() * spanY;
      this.add(`wear-${index + 1}`, geometry, wear, {
        position: [x, y, this.front + 0.014],
        rotation: [0, 0, (this.random() - 0.5) * 0.6],
      });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Public builder                                                             */
/* -------------------------------------------------------------------------- */

/** Raises the era's machine as one named group. */
export function buildMachine(
  entry: MachinePlanEntry,
  spec: BrewingMachineSpec,
  options: MachineBuildOptions,
): MachineBuild {
  return new MachineBuilder(entry, spec, options).build();
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Counter-pass slot the primary machine stands on. */
function machineBaySlot(layout: StructuralLayout): CounterPassSlot {
  const slot =
    layout.counterPassSlots.find((candidate) => candidate.kind === 'machine-bay') ??
    layout.counterPassSlots[0];
  if (!slot) {
    throw new Error('The structural layout exposes no counter-pass slot for the machine bay.');
  }
  return slot;
}

/** Axis aligned footprint of an item standing or hanging at `position`. */
function footprintOf(
  position: MachinePlacement,
  dimensions: MachineDimensions | { readonly width: number; readonly depth: number },
): FloorRect {
  const halfX = dimensions.width / 2;
  const halfZ = dimensions.depth / 2;
  return {
    minX: position.x - halfX,
    maxX: position.x + halfX,
    minZ: position.z - halfZ,
    maxZ: position.z + halfZ,
  };
}

function shrink(rect: FloorRect, amount: number): FloorRect {
  return {
    minX: rect.minX + amount,
    maxX: rect.maxX - amount,
    minZ: rect.minZ + amount,
    maxZ: rect.maxZ - amount,
  };
}

function applyTransform(node: THREE.Object3D, options: MeshOptions): void {
  if (options.position) {
    node.position.set(options.position[0], options.position[1], options.position[2]);
  }
  if (options.rotation) {
    node.rotation.set(options.rotation[0], options.rotation[1], options.rotation[2]);
  }
  if (typeof options.scale === 'number') node.scale.setScalar(options.scale);
  else if (options.scale) node.scale.set(options.scale[0], options.scale[1], options.scale[2]);
  if (options.visible !== undefined) node.visible = options.visible;
}
