/**
 * Supporting brewing equipment — the small kit that stands beside the machine.
 *
 * Kettles, filter brewers, grinders, milk pitchers, tampers, scales, cup stacks
 * and the counter knock box: the equipment an era's bar cannot work without.
 * This module owns both halves of that story:
 *
 *  - {@link planAccessories} places the era's {@link AccessorySpec} list on the
 *    environment's published anchors — a counter-pass slot (`machine-bay`,
 *    `grinder-bay`, `tray-run`, `handoff`), the primary machine, or the back
 *    wall — with the slot's own `surfaceHeight` and the spec's `offset`. Planning
 *    is geometry-free, so the module's diagnostics can report a plan before
 *    anything is raised.
 *  - {@link buildAccessory} raises one item as a named group. Every item lives in
 *    the same node namespace as the machines ({@link ACCESSORY_NODE_PREFIX}), so
 *    `machines:1985:knock-box:knock-bar` and `machines:1985:semi-automatic:group-1-body`
 *    address their parts the same way.
 *
 * Each *kind* has an era-specific geometry programme selected by the spec's
 * `variant` (`wall-crank` hand mill, `vacuum-pot` brewer, `gooseneck-temperature`
 * kettle, `calibrated-tamper`, `speckled-stoneware-stack`, ...), and each
 * programme uses all three surfaces its data declares (`material`, `trim` and the
 * optional `secondary`): a wall mill is cast iron with a brass drawer and a beech
 * crank, a 2025 pour-over stand is matte with brushed arms over glass. Nothing is
 * fetched: the surfaces come from the era's procedural material set.
 *
 * The animated hardware is handed back as {@link AccessoryBuild.jiggles} tagged
 * with the machine cue that rattles it, so the module's `update` makes the mill's
 * crank, the cup stack and the milk pitcher move to the same cue the engine
 * plays.
 */

import * as THREE from 'three';
import type { RoomBounds, YearId } from '../../../contracts/period';
import {
  type FloorRect,
  type StructuralLayout,
} from '../../environment';
import { machineSurface, type MachineMaterialSet } from '../textures';
import {
  MACHINE_NODE_PREFIX,
  buildGroup,
  buildMesh,
  doubleSided,
  type MachinePlan,
} from './machines';
import type { AccessoryKind, AccessoryMount, AccessorySpec, BrewingSpec } from '../BrewingModule';

/* -------------------------------------------------------------------------- */
/* Node namespace                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Node-name namespace of the supporting equipment. The bar is one place, so
 * machines and accessories share the machines namespace.
 */
export const ACCESSORY_NODE_PREFIX = MACHINE_NODE_PREFIX;

/* -------------------------------------------------------------------------- */
/* Planning types                                                             */
/* -------------------------------------------------------------------------- */

/** Axis aligned point in metres, scene space. */
export interface AccessoryPlacement {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One piece of equipment, placed but not yet built. */
export interface AccessoryPlanEntry {
  readonly id: string;
  readonly kind: AccessoryKind;
  readonly label: string;
  readonly mount: AccessoryMount;
  /** The era's data for this piece. */
  readonly spec: AccessorySpec;
  readonly dimensions: AccessorySpec['dimensions'];
  /** Where the item's own origin sits (on the counter, machine or wall). */
  readonly position: AccessoryPlacement;
  /** Rotation about Y in radians; counter and wall items face the room (+Z). */
  readonly rotationY: number;
  /** Counter-pass anchor the item stands on, or `null` for wall mounts. */
  readonly slot: string | null;
}

export interface AccessoryPlan {
  readonly entries: readonly AccessoryPlanEntry[];
}

export interface AccessoryPlanInput {
  readonly spec: BrewingSpec;
  readonly layout: StructuralLayout;
  readonly bounds: RoomBounds;
  /** The primary machine, so machine-anchored equipment can find its top. */
  readonly machinePlan: MachinePlan;
  /** Deterministic source for placement jitter (small rotations only). */
  readonly random: () => number;
}

export interface AccessoryBuildOptions {
  readonly materials: MachineMaterialSet;
  readonly year: YearId;
  readonly random: () => number;
}

/** Everything the module needs from one built piece of equipment. */
export interface AccessoryBuild {
  readonly entry: AccessoryPlanEntry;
  /** The item's group, named with the equipment id. */
  readonly group: THREE.Group;
  /** Hardware that rattles while a machine cue runs. */
  readonly jiggles: readonly THREE.Object3D[];
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

/** Axis aligned footprint of a planned accessory. */
export function accessoryFootprint(entry: AccessoryPlanEntry): FloorRect {
  const halfX = entry.dimensions.width / 2;
  const halfZ = entry.dimensions.depth / 2;
  return {
    minX: entry.position.x - halfX,
    maxX: entry.position.x + halfX,
    minZ: entry.position.z - halfZ,
    maxZ: entry.position.z + halfZ,
  };
}

/** Plans every piece of the era's equipment, in the data's own order. */
export function planAccessories(input: AccessoryPlanInput): AccessoryPlan {
  const entries = input.spec.accessories.map((spec) => planAccessory(spec, input));
  return Object.freeze({ entries: Object.freeze(entries) });
}

/** Plans one accessory against the anchors its spec names. */
export function planAccessory(
  spec: AccessorySpec,
  input: AccessoryPlanInput,
): AccessoryPlanEntry {
  const jitter = (input.random() - 0.5) * 0.24;
  const shared = {
    id: spec.id,
    kind: spec.kind,
    label: spec.label,
    mount: spec.mount,
    spec,
    dimensions: spec.dimensions,
  } as const;

  if (spec.mount === 'wall') {
    return Object.freeze({
      ...shared,
      position: Object.freeze({
        x: spec.wallX ?? 0,
        y: spec.wallHeight ?? 1.5,
        z: input.layout.counter.backFaceZ + 0.03 + spec.dimensions.depth / 2,
      }),
      rotationY: jitter * 0.25,
      slot: null,
    });
  }

  const machine = input.machinePlan.entries[0];
  if (spec.mount === 'machine-top' && machine) {
    return Object.freeze({
      ...shared,
      position: Object.freeze({
        x: machine.position.x + (spec.offset?.x ?? 0),
        y: machine.position.y + machine.dimensions.height,
        z: machine.position.z + (spec.offset?.z ?? 0),
      }),
      rotationY: 0,
      slot: machine.slot,
    });
  }

  const slotKind = spec.counterSlot ?? 'tray-run';
  const slot =
    input.layout.counterPassSlots.find((candidate) => candidate.kind === slotKind) ??
    input.layout.counterPassSlots[0];
  const base = slot?.position ?? {
    x: 0,
    y: input.layout.counter.surfaceHeight,
    z: input.layout.counter.center.z,
  };
  // A machine-front item stands in front of the machine on the same counter run.
  const frontOffset = spec.mount === 'machine-front' && machine ? machine.dimensions.depth * 0.6 : 0;
  return Object.freeze({
    ...shared,
    position: Object.freeze({
      x: base.x + (spec.offset?.x ?? 0),
      y: input.layout.counter.surfaceHeight,
      z: base.z + (spec.offset?.z ?? 0) + frontOffset,
    }),
    rotationY: jitter,
    slot: slot?.id ?? null,
  });
}

/* -------------------------------------------------------------------------- */
/* Builder                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Raises one piece of equipment: the era's variant programme, the era's
 * materials, and the jiggling hardware the module animates.
 */
class AccessoryBuilder {
  private readonly entry: AccessoryPlanEntry;
  private readonly materials: MachineMaterialSet;
  private readonly group: THREE.Group;
  private readonly jiggles: THREE.Object3D[] = [];

  private readonly width: number;
  private readonly depth: number;
  private readonly height: number;

  constructor(entry: AccessoryPlanEntry, options: AccessoryBuildOptions) {
    this.entry = entry;
    this.materials = options.materials;
    this.width = entry.dimensions.width;
    this.depth = entry.dimensions.depth;
    this.height = entry.dimensions.height;

    this.group = buildGroup(entry.id, {
      position: [entry.position.x, entry.position.y, entry.position.z],
      rotation: [0, entry.rotationY, 0],
    });
    this.group.userData['accessoryId'] = entry.id;
    this.group.userData['kind'] = entry.kind;
    this.group.userData['variant'] = entry.spec.variant;
  }

  build(): AccessoryBuild {
    switch (this.entry.kind) {
      case 'grinder':
        this.buildGrinder();
        break;
      case 'kettle':
        this.buildKettle();
        break;
      case 'filter-brewer':
        this.buildFilterBrewer();
        break;
      case 'milk-pitcher':
        this.buildPitcher();
        break;
      case 'tamper':
        this.buildTamper();
        break;
      case 'scale':
        this.buildScale();
        break;
      case 'cup-stack':
        this.buildCupStack();
        break;
      case 'knock-box':
        this.buildKnockBox();
        break;
      default:
        break;
    }
    return {
      entry: this.entry,
      group: this.group,
      jiggles: Object.freeze([...this.jiggles]),
    };
  }

  /* -- part helpers --------------------------------------------------------- */

  private material(): THREE.MeshStandardMaterial {
    return machineSurface(this.materials, this.entry.spec.material);
  }

  private trim(): THREE.MeshStandardMaterial {
    return machineSurface(this.materials, this.entry.spec.trim);
  }

  /** The optional third surface (wood, glass, ceramic); falls back to the body. */
  private secondary(): THREE.MeshStandardMaterial {
    const id = this.entry.spec.secondary;
    return id === undefined ? this.material() : machineSurface(this.materials, id);
  }

  private part(part: string): string {
    return `${this.entry.id}:${part}`;
  }

  private add(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: readonly [number, number, number],
    rotation?: readonly [number, number, number],
  ): THREE.Mesh {
    const node = buildMesh(this.part(name), geometry, material, {
      position,
      rotation,
    });
    this.group.add(node);
    return node;
  }

  /**
   * Marks a node as the hardware that rattles while `cue` runs, remembering the
   * pose the module's animation has to return to.
   */
  private rattle(node: THREE.Object3D, cue: string): THREE.Object3D {
    node.userData['machineCue'] = cue;
    if (node.userData['baseRotationZ'] === undefined) node.userData['baseRotationZ'] = node.rotation.z;
    this.jiggles.push(node);
    return node;
  }

  /* -- grinders ------------------------------------------------------------- */

  private buildGrinder(): void {
    const variant = this.entry.spec.variant;
    if (variant === 'wall-crank') {
      this.buildWallMill();
      return;
    }
    // The four electric eras share a frame; the era's details differ.
    const body = this.material();
    const trim = this.trim();
    const glass = this.secondary();
    const h = this.height;
    const w = this.width;

    this.add('base', new THREE.BoxGeometry(w, h * 0.08, this.depth), trim, [0, h * 0.04, 0]);
    this.add(
      'body',
      new THREE.BoxGeometry(w * 0.82, h * 0.44, this.depth * 0.82),
      body,
      [0, h * 0.3, 0],
    );

    const hopper = this.add(
      'hopper',
      new THREE.CylinderGeometry(w * 0.42, w * 0.24, h * 0.26, 16),
      glass,
      [0, h * 0.66, 0],
    );
    hopper.userData['baseRotationZ'] = 0;
    this.rattle(hopper, 'grind');
    this.add('hopper-lid', new THREE.CylinderGeometry(w * 0.44, w * 0.44, h * 0.03, 16), trim, [
      0,
      h * 0.81,
      0,
    ]);
    this.add(
      'chute',
      new THREE.BoxGeometry(w * 0.3, h * 0.06, this.depth * 0.34),
      trim,
      [0, h * 0.12, this.depth * 0.3],
    );
    this.add('fork', new THREE.BoxGeometry(w * 0.5, 0.008, this.depth * 0.3), trim, [
      0,
      h * 0.08,
      this.depth * 0.34,
    ]);

    if (variant === 'doser-grinder') {
      // 1965: a doser chamber with the classic flicking lever.
      this.add('doser-chamber', new THREE.CylinderGeometry(w * 0.3, w * 0.3, h * 0.16, 16), trim, [
        0,
        h * 0.16,
        this.depth * 0.22,
      ]);
      const lever = this.add(
        'doser-lever',
        new THREE.BoxGeometry(0.01, h * 0.16, 0.01),
        trim,
        [w * 0.28, h * 0.2, this.depth * 0.22],
        [0, 0, -0.5],
      );
      this.rattle(lever, 'grind');
      this.add('doser-star', new THREE.TorusGeometry(w * 0.16, 0.006, 8, 12), trim, [
        0,
        h * 0.2,
        this.depth * 0.36,
      ]);
      this.add('doser-dial', new THREE.CylinderGeometry(w * 0.12, w * 0.12, 0.012, 12), trim, [
        -w * 0.42,
        h * 0.5,
        0,
      ], [0, 0, Math.PI / 2]);
      return;
    }

    if (variant === 'doserless-grinder') {
      // 1985: no doser — an adjustable fork and a chute straight into the basket.
      this.add('dosing-dial', new THREE.CylinderGeometry(w * 0.14, w * 0.14, 0.014, 12), trim, [
        -w * 0.44,
        h * 0.46,
        0,
      ], [0, 0, Math.PI / 2]);
      this.add('chute-guard', new THREE.BoxGeometry(w * 0.4, 0.01, this.depth * 0.4), trim, [
        0,
        h * 0.16,
        this.depth * 0.3,
      ]);
      return;
    }

    if (variant === 'on-demand-grinder') {
      // 2005: timed on demand — a tenth-second dial and a smoked hopper window.
      this.add('timed-dial', new THREE.CylinderGeometry(w * 0.16, w * 0.16, 0.016, 14), trim, [
        w * 0.44,
        h * 0.44,
        0,
      ], [0, 0, Math.PI / 2]);
      this.add('hopper-window', new THREE.BoxGeometry(w * 0.5, h * 0.1, 0.006), glass, [
        0,
        h * 0.62,
        this.depth * 0.44,
      ]);
      this.add('drip-cup', new THREE.CylinderGeometry(w * 0.2, w * 0.16, h * 0.05, 12), trim, [
        0,
        h * 0.1,
        this.depth * 0.28,
      ]);
      return;
    }

    // 2025: single dosing — a dosing cup, a bellows and a machined dial.
    this.add('dosing-cup', new THREE.CylinderGeometry(w * 0.28, w * 0.24, h * 0.12, 16), trim, [
      0,
      h * 0.1,
      this.depth * 0.3,
    ]);
    this.add('bellows', new THREE.SphereGeometry(w * 0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), trim, [
      0,
      h * 0.6,
      0,
    ]);
    this.add('machined-dial', new THREE.CylinderGeometry(w * 0.18, w * 0.18, 0.018, 16), trim, [
      -w * 0.44,
      h * 0.5,
      0,
    ], [0, 0, Math.PI / 2]);
    this.add('chute-window', new THREE.BoxGeometry(w * 0.34, h * 0.08, 0.006), glass, [
      0,
      h * 0.18,
      this.depth * 0.44,
    ]);
  }

  /** 1945: a cast-iron wall mill with a beech crank and a tin grounds drawer. */
  private buildWallMill(): void {
    const iron = this.material();
    const brass = this.trim();
    const wood = this.secondary();
    const w = this.width;
    const d = this.depth;
    const h = this.height;

    this.add('wall-plate', new THREE.BoxGeometry(w * 0.9, h * 0.5, 0.02), iron, [0, h * 0.5, -d / 2]);
    this.add('mill-body', new THREE.CylinderGeometry(w * 0.3, w * 0.34, h * 0.36, 18), iron, [
      0,
      h * 0.46,
      -d * 0.16,
    ]);
    this.add('hopper', new THREE.CylinderGeometry(w * 0.36, w * 0.18, h * 0.22, 18), iron, [
      0,
      h * 0.78,
      -d * 0.16,
    ]);
    this.add('burr-adjust', new THREE.CylinderGeometry(w * 0.16, w * 0.16, 0.012, 12), brass, [
      0,
      h * 0.62,
      d * 0.06,
    ], [Math.PI / 2, 0, 0]);
    const crank = buildGroup(this.part('crank-arm'), {
      position: [w * 0.24, h * 0.5, -d * 0.02],
      rotation: [0, 0, -0.35],
    });
    crank.add(
      buildMesh(
        this.part('crank-arm-shaft'),
        new THREE.BoxGeometry(0.012, h * 0.22, 0.012),
        wood,
        { position: [0, h * 0.09, 0] },
      ),
    );
    crank.add(
      buildMesh(
        this.part('crank-arm-knob'),
        new THREE.CylinderGeometry(0.014, 0.014, 0.05, 12),
        wood,
        { position: [0, h * 0.2, 0], rotation: [Math.PI / 2, 0, 0] },
      ),
    );
    this.group.add(crank);
    this.rattle(crank, 'grind');

    this.add(
      'grounds-drawer',
      new THREE.BoxGeometry(w * 0.62, h * 0.12, d * 0.52),
      brass,
      [0, h * 0.08, -d * 0.06],
    );
    this.add(
      'grounds-drawer-handle',
      new THREE.BoxGeometry(0.02, 0.01, 0.02),
      brass,
      [0, h * 0.08, d * 0.2],
    );
  }

  /* -- kettles -------------------------------------------------------------- */

  private buildKettle(): void {
    const variant = this.entry.spec.variant;
    const body = this.material();
    const trim = this.trim();
    const accent = this.secondary();
    const w = this.width;
    const h = this.height;
    const radius = w * 0.42;

    // A lathed profile gives the kettle its era silhouette: squat and wide,
    // tall and tapered, or a modern flat-sided gooseneck body.
    const profile: readonly (readonly [number, number])[] =
      variant === 'enamel-stovetop'
        ? [
            [0.001, 0],
            [radius * 0.9, 0],
            [radius, h * 0.3],
            [radius * 0.92, h * 0.72],
            [radius * 0.6, h * 0.86],
            [radius * 0.62, h * 0.92],
            [0.001, h * 0.92],
          ]
        : variant === 'chrome-electric' || variant === 'cordless-plastic'
          ? [
              [0.001, 0],
              [radius * 0.86, 0],
              [radius, h * 0.16],
              [radius * 0.86, h * 0.8],
              [radius * 0.5, h * 0.94],
              [0.001, h * 0.94],
            ]
          : variant === 'gooseneck-temperature'
            ? [
                [0.001, 0],
                [radius * 0.9, 0],
                [radius * 0.78, h * 0.1],
                [radius * 0.8, h * 0.86],
                [radius * 0.52, h * 0.94],
                [0.001, h * 0.94],
              ]
            : [
                [0.001, 0],
                [radius * 0.8, 0],
                [radius * 0.96, h * 0.22],
                [radius * 0.88, h * 0.84],
                [radius * 0.5, h * 0.94],
                [0.001, h * 0.94],
              ];
    const lathe = new THREE.LatheGeometry(
      profile.map(([x, y]) => new THREE.Vector2(x, y)),
      20,
    );
    this.add('body', lathe, body, [0, 0, 0]);

    if (variant === 'enamel-stovetop') {
      // Cobalt banding, a bail handle and a domed bakelite knob.
      this.add('rim-band', new THREE.TorusGeometry(radius * 0.94, 0.005, 8, 20), trim, [
        0,
        h * 0.78,
        0,
      ], [Math.PI / 2, 0, 0]);
      this.add('spout', new THREE.CylinderGeometry(0.014, 0.02, h * 0.34, 12), body, [
        radius * 0.86,
        h * 0.52,
        0,
      ], [0, 0, -0.5]);
      this.add('lid', new THREE.SphereGeometry(radius * 0.6, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), body, [
        0,
        h * 0.9,
        0,
      ]);
      this.add('lid-knob', new THREE.SphereGeometry(0.014, 10, 8), accent, [0, h * 0.99, 0]);
      this.add(
        'bail-handle',
        new THREE.TorusGeometry(radius * 0.9, 0.007, 8, 16, Math.PI),
        trim,
        [0, h * 0.6, 0],
        [0, 0, Math.PI],
      );
      return;
    }

    // The electric kettles: a moulded handle, a cordless base and a lid.
    const handleShape =
      variant === 'gooseneck-temperature'
        ? new THREE.CylinderGeometry(0.011, 0.011, h * 0.5, 10)
        : new THREE.BoxGeometry(w * 0.1, h * 0.44, this.depth * 0.16);
    this.add('handle', handleShape, accent, [radius * 1.02, h * 0.5, 0], [0, 0, 0.2]);
    this.add('lid', new THREE.CylinderGeometry(radius * 0.56, radius * 0.5, h * 0.06, 16), trim, [
      0,
      h * 0.94,
      0,
    ]);
    this.add('base', new THREE.CylinderGeometry(radius * 1.04, radius * 1.08, h * 0.06, 18), trim, [
      0,
      h * 0.03,
      0,
    ]);
    if (variant === 'gooseneck-temperature') {
      // The temperature era pours: a swan-neck spout and a setpoint dial.
      this.add('gooseneck-spout', new THREE.CylinderGeometry(0.009, 0.012, h * 0.4, 10), trim, [
        radius * 0.8,
        h * 0.72,
        0,
      ], [0, 0, -0.42]);
      this.add('gooseneck-neck', new THREE.SphereGeometry(0.02, 12, 8), trim, [
        radius * 0.44,
        h * 0.9,
        0,
      ]);
      this.add('temp-dial', new THREE.CylinderGeometry(0.022, 0.022, 0.012, 14), body, [
        -radius * 0.5,
        h * 0.34,
        0,
      ], [Math.PI / 2, 0, 0]);
      return;
    }
    if (variant === 'cordless-plastic') {
      this.add('water-window', new THREE.BoxGeometry(w * 0.16, h * 0.4, 0.006), body, [
        0,
        h * 0.5,
        radius * 0.98,
      ]);
      this.add('power-switch', new THREE.BoxGeometry(w * 0.2, 0.012, 0.006), trim, [
        -radius * 0.5,
        h * 0.14,
        radius * 0.9,
      ]);
      return;
    }
    // 2005: brushed body, concealed element, a water window down the front.
    this.add('water-window', new THREE.BoxGeometry(w * 0.2, h * 0.5, 0.006), trim, [
      0,
      h * 0.48,
      radius * 0.96,
    ]);
    this.add('spout', new THREE.CylinderGeometry(0.014, 0.022, h * 0.3, 12), body, [
      radius * 0.8,
      h * 0.7,
      0,
    ], [0, 0, -0.5]);
  }

  /* -- filter brewers ------------------------------------------------------- */

  private buildFilterBrewer(): void {
    const variant = this.entry.spec.variant;
    const body = this.material();
    const trim = this.trim();
    const glass = this.secondary();
    const w = this.width;
    const d = this.depth;
    const h = this.height;

    if (variant === 'sock-filter-dripolator') {
      // 1945: a wire frame over an enamel jug and a boiled cotton filter sock.
      this.add('jug', new THREE.CylinderGeometry(w * 0.36, w * 0.32, h * 0.5, 18), body, [
        0,
        h * 0.25,
        0,
      ]);
      this.add('jug-spout', new THREE.CylinderGeometry(0.012, 0.018, 0.05, 10), trim, [
        w * 0.34,
        h * 0.42,
        0,
      ], [0, 0, -0.7]);
      this.add('filter-frame', new THREE.TorusGeometry(w * 0.36, 0.006, 8, 18), trim, [
        0,
        h * 0.62,
        0,
      ], [Math.PI / 2, 0, 0]);
      doubleSided(
        this.add(
          'filter-sock',
          new THREE.ConeGeometry(w * 0.32, h * 0.34, 16, 1, true),
          glass,
          [0, h * 0.62, 0],
        ),
      );
      this.add('bail-handle', new THREE.TorusGeometry(w * 0.4, 0.006, 8, 16, Math.PI), trim, [
        0,
        h * 0.34,
        0,
      ], [0, 0, 0]);
      this.add('drip-bowl', new THREE.CylinderGeometry(w * 0.42, w * 0.38, h * 0.04, 18), trim, [
        0,
        h * 0.02,
        0,
      ]);
      return;
    }

    if (variant === 'vacuum-pot') {
      // 1965: the two-bowl glass vacuum pot with its funnel rod and collar.
      this.add('lower-bowl', new THREE.SphereGeometry(w * 0.38, 18, 12), body, [0, h * 0.26, 0]);
      this.add('upper-bowl', new THREE.SphereGeometry(w * 0.35, 18, 12), glass, [0, h * 0.66, 0]);
      this.add('funnel-rod', new THREE.CylinderGeometry(0.012, 0.012, h * 0.34, 10), trim, [
        0,
        h * 0.56,
        0,
      ]);
      this.add('collar', new THREE.TorusGeometry(w * 0.26, 0.008, 8, 18), trim, [0, h * 0.5, 0], [
        Math.PI / 2,
        0,
        0,
      ]);
      this.add('handle-arm', new THREE.BoxGeometry(w * 0.5, 0.012, 0.012), trim, [
        w * 0.3,
        h * 0.42,
        0,
      ]);
      this.add('base', new THREE.CylinderGeometry(w * 0.4, w * 0.44, h * 0.06, 18), body, [
        0,
        h * 0.03,
        0,
      ]);
      return;
    }

    // The batch and pour-over brewers: a tower with a carafe on a hotplate or
    // a stand over a scale plate.
    this.add(
      'brewer-body',
      new THREE.BoxGeometry(w * 0.72, h * 0.66, d * 0.66),
      body,
      [-w * 0.1, h * 0.72, -d * 0.08],
    );
    doubleSided(
      this.add(
        'carafe',
        new THREE.CylinderGeometry(w * 0.34, w * 0.3, h * 0.4, 16),
        glass,
        [w * 0.12, h * 0.22, 0.01],
      ),
    );
    this.add('basket', new THREE.CylinderGeometry(w * 0.32, w * 0.24, h * 0.12, 16), trim, [
      -w * 0.1,
      h * 0.46,
      -d * 0.08,
    ]);
    this.add('hotplate', new THREE.CylinderGeometry(w * 0.34, w * 0.36, h * 0.03, 18), trim, [
      w * 0.12,
      h * 0.02,
      0.01,
    ]);
    this.add('carafe-handle', new THREE.BoxGeometry(0.012, h * 0.24, 0.012), trim, [
      w * 0.46,
      h * 0.24,
      0.01,
    ]);

    if (variant === 'thermostatic-brewer') {
      // 2005: a hold-temperature readout and a swing-out basket.
      this.add('temp-readout', new THREE.BoxGeometry(w * 0.34, h * 0.08, 0.006), body, [
        -w * 0.1,
        h * 0.86,
        d * 0.26,
      ]);
      this.add('basket-swing', new THREE.BoxGeometry(w * 0.3, 0.012, d * 0.4), trim, [
        -w * 0.1,
        h * 0.52,
        d * 0.2,
      ]);
      return;
    }

    if (variant === 'pour-over-stand') {
      // 2025: a matte stand with brushed arms and a glass cone dripper.
      this.add('stand-column', new THREE.BoxGeometry(w * 0.16, h * 0.9, d * 0.16), body, [
        -w * 0.34,
        h * 0.45,
        0,
      ]);
      this.add('stand-arm', new THREE.BoxGeometry(w * 0.6, 0.014, d * 0.3), trim, [
        -w * 0.06,
        h * 0.66,
        0,
      ]);
      this.add('dripper', new THREE.ConeGeometry(w * 0.3, h * 0.26, 18, 1, true), glass, [
        w * 0.02,
        h * 0.56,
        0,
      ]);
      this.add('dripper-collar', new THREE.TorusGeometry(w * 0.3, 0.006, 8, 18), trim, [
        w * 0.02,
        h * 0.7,
        0,
      ], [Math.PI / 2, 0, 0]);
      this.add('scale-plate', new THREE.BoxGeometry(w * 0.66, 0.012, d * 0.66), trim, [
        w * 0.02,
        h * 0.02,
        0,
      ]);
      return;
    }

    // 1985 batch brewer: a hold switch and a hotplate indicator.
    this.add('brew-switch', new THREE.BoxGeometry(w * 0.2, h * 0.06, 0.008), trim, [
      -w * 0.1,
      h * 0.62,
      d * 0.26,
    ]);
    this.add('water-gauge', new THREE.BoxGeometry(w * 0.12, h * 0.3, 0.006), trim, [
      -w * 0.42,
      h * 0.6,
      0,
    ]);
  }

  /* -- milk pitchers -------------------------------------------------------- */

  private buildPitcher(): void {
    const variant = this.entry.spec.variant;
    const body = this.material();
    const trim = this.trim();
    const w = this.width;
    const h = this.height;
    const radius = w * 0.42;
    const belly = variant === 'enamel-jug' ? 1.06 : 1;

    const profile: readonly (readonly [number, number])[] = [
      [0.001, 0],
      [radius * 0.92, 0],
      [radius * belly, h * 0.34],
      [radius * 0.92, h * 0.82],
      [radius * 0.86, h],
      [0.001, h],
    ];
    const lathe = new THREE.LatheGeometry(
      profile.map(([x, y]) => new THREE.Vector2(x, y)),
      20,
    );
    doubleSided(this.add('body', lathe, body, [0, 0, 0]));

    // Pouring lip, handle and the era's rim treatment.
    this.add('spout-lip', new THREE.CylinderGeometry(0.012, 0.016, 0.05, 10), body, [
      radius * 0.7,
      h * 0.94,
      0,
    ], [0, 0, -0.9]);
    const handle = this.add(
      'handle',
      new THREE.TorusGeometry(h * 0.26, 0.006, 8, 14, Math.PI),
      trim,
      [radius * 1.06, h * 0.6, 0],
      [0, 0, -Math.PI / 2],
    );
    this.rattle(handle, 'milk-knock');
    this.add('rim-band', new THREE.TorusGeometry(radius * 0.88, 0.005, 8, 20), trim, [
      0,
      h * 0.98,
      0,
    ], [Math.PI / 2, 0, 0]);
    this.add('base-band', new THREE.TorusGeometry(radius * 0.94, 0.005, 8, 20), trim, [
      0,
      h * 0.02,
      0,
    ], [Math.PI / 2, 0, 0]);

    if (variant === 'precision-pitcher' || variant === 'calibrated-pitcher') {
      // Modern pitchers carry etched graduations down the inside of the lip.
      const graduation = new THREE.BoxGeometry(0.006, h * 0.5, 0.004);
      for (let index = 0; index < 3; index += 1) {
        this.add(`graduation-${index + 1}`, graduation, trim, [
          -radius * 0.5 - index * 0.02,
          h * (0.3 + index * 0.05),
          radius * 0.7,
        ]);
      }
    }
  }

  /* -- tampers and scales --------------------------------------------------- */

  private buildTamper(): void {
    const variant = this.entry.spec.variant;
    const base = this.material();
    const handle = this.trim();
    const w = this.width;
    const h = this.height;

    this.add('base', new THREE.CylinderGeometry(w * 0.5, w * 0.5, h * 0.22, 20), base, [
      0,
      h * 0.11,
      0,
    ]);
    this.add('base-shoulder', new THREE.TorusGeometry(w * 0.46, 0.004, 8, 20), base, [
      0,
      h * 0.22,
      0,
    ], [Math.PI / 2, 0, 0]);
    if (variant === 'bakelite-tamper') {
      // 1965: a turned bakelite knob with a narrow waist.
      this.add('handle-waist', new THREE.CylinderGeometry(w * 0.26, w * 0.34, h * 0.3, 18), handle, [
        0,
        h * 0.4,
        0,
      ]);
      this.add('handle-knob', new THREE.SphereGeometry(w * 0.42, 18, 10), handle, [
        0,
        h * 0.72,
        0,
      ]);
      return;
    }
    if (variant === 'nylon-tamper') {
      // 1985: a moulded nylon palm grip with a ribbed collar.
      this.add('handle-grip', new THREE.CylinderGeometry(w * 0.4, w * 0.44, h * 0.4, 14), handle, [
        0,
        h * 0.5,
        0,
      ]);
      this.add('handle-cap', new THREE.CylinderGeometry(w * 0.44, w * 0.4, h * 0.08, 14), handle, [
        0,
        h * 0.74,
        0,
      ]);
      return;
    }
    if (variant === 'ergonomic-tamper') {
      // 2005: a palm-shaped moulding that falls level in the basket.
      this.add('handle-palm', new THREE.SphereGeometry(w * 0.5, 18, 12), handle, [0, h * 0.56, 0]);
      this.add('handle-collar', new THREE.CylinderGeometry(w * 0.34, w * 0.38, h * 0.18, 16), handle, [
        0,
        h * 0.34,
        0,
      ]);
      return;
    }
    // 2025: a calibrated tamper with a spring-loaded click collar.
    this.add('handle-stem', new THREE.CylinderGeometry(w * 0.3, w * 0.34, h * 0.42, 16), handle, [
      0,
      h * 0.52,
      0,
    ]);
    this.add('calibration-collar', new THREE.TorusGeometry(w * 0.36, 0.008, 8, 16), handle, [
      0,
      h * 0.36,
      0,
    ], [Math.PI / 2, 0, 0]);
    this.add('handle-top', new THREE.CylinderGeometry(w * 0.36, w * 0.3, h * 0.1, 16), handle, [
      0,
      h * 0.78,
      0,
    ]);
  }

  private buildScale(): void {
    const variant = this.entry.spec.variant;
    const body = this.material();
    const pan = this.trim();
    const readout = this.secondary();
    const w = this.width;
    const d = this.depth;
    const h = this.height;

    this.add('body', new THREE.BoxGeometry(w, h * 0.6, d), body, [0, h * 0.3, 0]);
    this.add('weighing-pan', new THREE.BoxGeometry(w * 0.9, h * 0.16, d * 0.86), pan, [
      0,
      h * 0.66,
      0,
    ]);
    this.add('readout', new THREE.BoxGeometry(w * 0.42, h * 0.24, 0.004), readout, [
      -w * 0.24,
      h * 0.36,
      d / 2 + 0.002,
    ]);
    this.add('key-tare', new THREE.BoxGeometry(w * 0.12, h * 0.14, 0.004), pan, [
      w * 0.24,
      h * 0.36,
      d / 2 + 0.002,
    ]);
    this.add('key-unit', new THREE.BoxGeometry(w * 0.12, h * 0.14, 0.004), pan, [
      w * 0.4,
      h * 0.36,
      d / 2 + 0.002,
    ]);
    if (variant === 'connected-brew-scale') {
      // 2025: the scale talks to the machine — a status light and an antenna.
      this.add('status-light', new THREE.SphereGeometry(h * 0.12, 10, 8), readout, [
        w * 0.4,
        h * 0.58,
        d * 0.3,
      ]);
      this.add('port-cover', new THREE.CylinderGeometry(h * 0.14, h * 0.14, 0.004, 12), pan, [
        -w * 0.42,
        h * 0.4,
        0,
      ], [0, 0, Math.PI / 2]);
      return;
    }
    this.add('battery-cover', new THREE.BoxGeometry(w * 0.4, h * 0.16, 0.004), pan, [
      0,
      h * 0.2,
      -d / 2 - 0.002,
    ]);
  }

  /* -- cup stacks and knock boxes ------------------------------------------- */

  private buildCupStack(): void {
    const cup = this.material();
    const saucer = this.trim();
    const capacity = Math.max(Math.trunc(this.entry.spec.cupCapacity ?? 6), 1);
    const count = Math.min(capacity, 6);
    const stackHeight = this.entry.spec.stackHeight ?? this.height;
    const radius = this.width * 0.42;
    const step = stackHeight / count;

    const stack = buildGroup(this.part('stack'), { position: [0, 0, 0] });
    this.group.add(stack);
    for (let index = 0; index < count; index += 1) {
      const y = step * index + step * 0.5;
      stack.add(
        buildMesh(
          this.part(`cup-${index + 1}`),
          new THREE.CylinderGeometry(radius, radius * 0.72, step * 0.62, 14),
          cup,
          { position: [0, y, 0] },
        ),
      );
      stack.add(
        buildMesh(
          this.part(`saucer-${index + 1}`),
          new THREE.CylinderGeometry(radius * 1.22, radius * 1.22, step * 0.14, 16),
          saucer,
          { position: [0, y - step * 0.34, 0] },
        ),
      );
    }
    this.add('stack-base', new THREE.CylinderGeometry(radius * 1.3, radius * 1.34, 0.008, 18), saucer, [
      0,
      0.004,
      0,
    ]);
    this.rattle(stack, 'cup-clatter');
  }

  private buildKnockBox(): void {
    const body = this.material();
    const trim = this.trim();
    const bar = this.secondary();
    const w = this.width;
    const d = this.depth;
    const h = this.height;

    this.add('body', new THREE.BoxGeometry(w, h * 0.82, d), body, [0, h * 0.41, 0]);
    this.add('gasket', new THREE.TorusGeometry(w * 0.42, 0.006, 8, 18), trim, [
      0,
      h * 0.84,
      0,
    ], [Math.PI / 2, 0, 0]);
    const knockBar = this.add('knock-bar', new THREE.CylinderGeometry(0.011, 0.011, w * 0.84, 12), bar, [
      0,
      h * 0.72,
      0,
    ], [0, 0, Math.PI / 2]);
    this.rattle(knockBar, 'milk-knock');
    this.add('bar-bracket-1', new THREE.BoxGeometry(0.012, h * 0.2, 0.012), trim, [
      -w * 0.4,
      h * 0.62,
      0,
    ]);
    this.add('bar-bracket-2', new THREE.BoxGeometry(0.012, h * 0.2, 0.012), trim, [
      w * 0.4,
      h * 0.62,
      0,
    ]);
    this.add('puck-chute', new THREE.BoxGeometry(w * 0.5, h * 0.08, d * 0.4), trim, [
      0,
      h * 0.9,
      -d * 0.1,
    ]);
  }
}

/* -------------------------------------------------------------------------- */
/* Public builder                                                             */
/* -------------------------------------------------------------------------- */

/** Raises one piece of the era's supporting equipment as a named group. */
export function buildAccessory(
  entry: AccessoryPlanEntry,
  options: AccessoryBuildOptions,
): AccessoryBuild {
  return new AccessoryBuilder(entry, options).build();
}
