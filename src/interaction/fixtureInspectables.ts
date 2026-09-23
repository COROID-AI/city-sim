/**
 * Chrono City — dev/test fixture inspectables.
 *
 * This module owns the *only* city content the interaction task is allowed to
 * create: a handful of clearly-labelled placeholder objects whose sole purpose
 * is to make picking, hover highlighting and per-year info card copy verifiable
 * before the streetscape tasks ship real geometry. Real content registers its
 * own inspectables through the `InspectionRegistry`; nothing here is meant to
 * appear in a finished block.
 *
 * The fixtures are deliberately arranged to exercise every label fallback:
 *  - `civic-hall`     — full copy for all five eras.
 *  - `mural-wall`     — full copy for all five eras.
 *  - `corner-drugstore` — no 2025 copy, but an authored `fallbackCopy`.
 *  - `street-clock`   — no 2005 copy and no fallback, so the registry reuses the
 *                       nearest authored era (1985).
 *
 * Lifecycle:
 *   create    → `createFixtureInspectables(registry, { parent })`.
 *   consume   → `createFixtureInspectionLayer(...)` builds the whole subsystem
 *               (registry + picking + info card + fixtures) in one call.
 *   integrate → the era-transition integration task wires the real app; it can
 *               swap the fixture definitions for real content definitions.
 */

import * as THREE from 'three';

import {
  BLOCK_HALF_WIDTH,
  SIDEWALK_CENTER_X,
  SIDEWALK_CENTER_Z,
} from '../core/blockLayout';
import { ERA_IDS, type EraId } from '../core/eraContracts';
import {
  createInspectionLayer,
  type InspectionLayer,
  type InspectionLayerOptions,
} from './pickingController';
import type {
  InspectableCopy,
  InspectableCopyByEra,
  InspectableHighlightStyle,
  InspectableRecord,
  InspectionRegistry,
} from './inspectionRegistry';

export const FIXTURE_INSPECTABLES_VERSION = 1;

/** Name of the group every fixture mesh is parented to. */
export const FIXTURE_GROUP_NAME = 'chrono-fixture-inspectables';

/** One placeholder inspectable: geometry, placement and era-keyed copy. */
export interface FixtureInspectableDefinition {
  /** Stable id, also the info card's `objectId`. */
  readonly id: string;
  /** Plain name used when no era copy resolves. */
  readonly label: string;
  /** World position of the object's base (`x`, base `y`, `z`). */
  readonly position: readonly [number, number, number];
  /** Box size in metres (`width`, `height`, `depth`). */
  readonly size: readonly [number, number, number];
  /** Base material colour. */
  readonly color: number;
  /** Per-year copy. */
  readonly copy: InspectableCopyByEra;
  /** Copy used for years the map does not cover. */
  readonly fallbackCopy?: InspectableCopy;
}

/**
 * The placeholder block: a civic hall at the centre, a corner store, a sidewalk
 * clock and a mural wall on the west sidewalk. Positions are expressed through
 * the shared `BlockLayout` metrics so the fixtures never drift from the layout
 * the navigation and traffic tasks use.
 */
export const FIXTURE_INSPECTABLES: readonly FixtureInspectableDefinition[] = Object.freeze([
  {
    id: 'civic-hall',
    label: 'Civic hall',
    position: [0, 0, -6],
    size: [18, 22, 12],
    color: 0xb9a583,
    copy: {
      '1945': {
        name: 'Provisional Town Hall',
        blurb:
          'Limestone pocked with shrapnel scars, sandbags stacked against the doors and a hand-painted sign promising reconstruction.',
      },
      '1965': {
        name: 'Civic Administration Building',
        blurb:
          'Fresh concrete and aluminium lettering announce a city busy rebuilding itself; a bronze plaque lists the officials of the new borough.',
      },
      '1985': {
        name: 'Municipal Offices',
        blurb:
          'Tinted glass and a mirrored lobby; the notice board is papered with redevelopment plans and a payphone hums by the steps.',
      },
      '2005': {
        name: 'Town Hall & Service Centre',
        blurb:
          'A wheelchair ramp and an LED information board mark the digital decade; the old plaque is now a heritage sign behind perspex.',
      },
      '2025': {
        name: 'Civic Hub',
        blurb:
          'Solar cladding and a public co-working atrium; the entrance scrolls the district carbon target across an e-ink panel.',
      },
    },
  },
  {
    id: 'corner-drugstore',
    label: 'Corner store',
    position: [BLOCK_HALF_WIDTH * 0.65, 0, 12],
    size: [12, 9, 10],
    color: 0x8d5a3b,
    copy: {
      '1945': {
        name: 'Ellis & Sons Apothecary',
        blurb:
          'A soda fountain behind the glass, ration notices taped to the window and a bicycle propped against the kerb outside.',
      },
      '1965': {
        name: 'Meridian Pharmacy',
        blurb:
          'Neon script buzzes over a self-service aisle; the window advertises polio boosters and a new frozen-food cabinet.',
      },
      '1985': {
        name: 'Meridian Drugs',
        blurb:
          'Sun-bleached posters, a video rental counter in the back and a security shutter half lowered at dusk.',
      },
      '2005': {
        name: 'Meridian Corner Chemist',
        blurb:
          'A loyalty-card banner flutters over the entrance and the till software still runs on a beige box beneath the counter.',
      },
    },
    fallbackCopy: {
      name: 'Meridian Corner Store',
      blurb:
        'The corner shop keeps its warm sandstone bones; the sign has been repainted so often the layers are visible up close.',
    },
  },
  {
    id: 'street-clock',
    label: 'Street clock on the east sidewalk',
    position: [SIDEWALK_CENTER_X, 0, -SIDEWALK_CENTER_Z],
    size: [1.6, 7, 1.6],
    color: 0x2f3b45,
    copy: {
      '1945': {
        name: 'Street Clock',
        blurb:
          'Cast iron on a granite plinth, wound by hand every Monday and blacked out during air raids.',
      },
      '1965': {
        name: 'Street Clock',
        blurb:
          'Repainted municipal green with a new glass face; office workers set their watches by the chime at nine.',
      },
      '1985': {
        name: 'Street Clock',
        blurb:
          'Chrome-trimmed and quartz-driven now, the old pillar still ticks over a bus shelter full of commuters.',
      },
      '2025': {
        name: 'Transit Clock',
        blurb:
          'The cast-iron base carries a slim LED face that syncs to the tram network and dims itself at midnight.',
      },
    },
  },
  {
    id: 'mural-wall',
    label: 'Painted wall on the west sidewalk',
    position: [-SIDEWALK_CENTER_X, 0, SIDEWALK_CENTER_Z * 0.7],
    size: [0.7, 6.5, 10],
    color: 0x6b6f78,
    copy: {
      '1945': {
        name: 'Victory Mural',
        blurb:
          'Faded paint over brick: a bomber crew, a factory skyline and "BUY WAR BONDS" in two-foot letters.',
      },
      '1965': {
        name: 'Civic Mosaic',
        blurb:
          'Thousands of porcelain tiles celebrate the new ring road, the opera house and the first televised election.',
      },
      '1985': {
        name: 'Open Wall',
        blurb:
          'Aerosol tags and a sliced-apart poster collage; the council gave up repainting it and called it a youth project.',
      },
      '2005': {
        name: 'Heritage Mural',
        blurb:
          'Varnished and floodlit, the tiled civic scene is back behind a rail with a small bronze caption plate.',
      },
      '2025': {
        name: 'Augmented Wall',
        blurb:
          'The bricks are bare again; a quiet glyph at ankle height drops a holographic layer of every past mural over them.',
      },
    },
  },
]);

/** Fixture ids in definition order — handy for harnesses probing the scene. */
export const FIXTURE_INSPECTABLE_IDS: readonly string[] = Object.freeze(
  FIXTURE_INSPECTABLES.map((definition) => definition.id),
);

/** Every era a fixture definition carries authored copy for. */
export function fixtureErasWithCopy(definition: FixtureInspectableDefinition): readonly EraId[] {
  return ERA_IDS.filter((era) => definition.copy[era] !== undefined);
}

export interface FixtureInspectablesOptions {
  /** Definitions to instantiate. Defaults to `FIXTURE_INSPECTABLES`. */
  readonly definitions?: readonly FixtureInspectableDefinition[];
  /** Object the fixture group is added to (usually `context.scene`). */
  readonly parent?: THREE.Object3D;
  /** Group name. Defaults to `FIXTURE_GROUP_NAME`. */
  readonly name?: string;
  /** Highlight override applied to every fixture. */
  readonly highlight?: InspectableHighlightStyle;
}

/** Live fixture content: the meshes, their records and a teardown. */
export interface FixtureInspectablesHandle {
  readonly group: THREE.Group;
  readonly records: readonly InspectableRecord[];
  readonly meshes: readonly THREE.Mesh[];
  /** Mesh registered under `objectId`, or `null`. */
  meshFor(objectId: string): THREE.Mesh | null;
  /** Removes the meshes from the scene and deregisters them. Idempotent. */
  dispose(): void;
}

/**
 * Builds the fixture meshes, registers them in the registry and parents the
 * group. Picking resolves them like any other inspectable.
 */
export function createFixtureInspectables(
  registry: InspectionRegistry,
  options: FixtureInspectablesOptions = {},
): FixtureInspectablesHandle {
  if (!registry) throw new TypeError('createFixtureInspectables() needs an InspectionRegistry.');

  const definitions = options.definitions ?? FIXTURE_INSPECTABLES;
  const group = new THREE.Group();
  group.name = options.name ?? FIXTURE_GROUP_NAME;
  group.userData.chronoFixture = true;

  const meshes: THREE.Mesh[] = [];
  const records: InspectableRecord[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  let disposed = false;

  for (const definition of definitions) {
    const [width, height, depth] = definition.size;
    const [x, baseY, z] = definition.position;

    const geometry = new THREE.BoxGeometry(width, height, depth);
    const material = new THREE.MeshStandardMaterial({
      color: definition.color,
      roughness: 0.72,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = definition.id;
    mesh.position.set(x, baseY + height / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.chronoFixture = true;
    group.add(mesh);

    geometries.push(geometry);
    materials.push(material);
    meshes.push(mesh);

    records.push(
      registry.register({
        id: definition.id,
        object: mesh,
        copy: definition.copy,
        fallbackCopy: definition.fallbackCopy,
        label: definition.label,
        highlight: options.highlight,
        data: { fixture: true },
      }),
    );
  }

  options.parent?.add(group);
  group.updateMatrixWorld(true);

  return {
    group,
    records: Object.freeze(records),
    meshes: Object.freeze(meshes),
    meshFor(objectId: string): THREE.Mesh | null {
      return meshes.find((mesh) => mesh.name === objectId) ?? null;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const record of records) registry.deregister(record.id);
      group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

export interface FixtureInspectionLayerOptions extends InspectionLayerOptions {
  /** Object the fixture meshes are parented to. Defaults to `context.scene`. */
  readonly fixtureParent?: THREE.Object3D;
  readonly definitions?: readonly FixtureInspectableDefinition[];
  readonly fixtureName?: string;
  readonly fixtureHighlight?: InspectableHighlightStyle;
}

/** An inspection layer plus the fixture content it verifies against. */
export interface FixtureInspectionLayer extends InspectionLayer {
  readonly fixtures: FixtureInspectablesHandle;
}

/**
 * One-call dev/test composition: registry + picking controller + info card +
 * fixture inspectables, all registered on the supplied scene context. This is
 * the entry point a browser harness (or a temporary dev page) mounts to see the
 * interaction system running before the integration task wires it into the app.
 */
export function createFixtureInspectionLayer(
  options: FixtureInspectionLayerOptions,
): FixtureInspectionLayer {
  const layer = createInspectionLayer(options);
  const fixtures = createFixtureInspectables(layer.registry, {
    definitions: options.definitions,
    parent: options.fixtureParent ?? options.context.scene,
    name: options.fixtureName,
    highlight: options.fixtureHighlight,
  });
  options.context.scene.updateMatrixWorld(true);

  return {
    context: layer.context,
    registry: layer.registry,
    picking: layer.picking,
    infoCard: layer.infoCard,
    fixtures,
    get era() {
      return layer.era;
    },
    get isOpen() {
      return layer.isOpen;
    },
    setEra: (era) => layer.setEra(era),
    open: (objectId) => layer.open(objectId),
    close: () => layer.close(),
    dispose: () => {
      fixtures.dispose();
      layer.dispose();
    },
  };
}
