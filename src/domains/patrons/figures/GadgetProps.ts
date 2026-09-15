/**
 * Gadget props — the hand-held and worn objects that date each era.
 *
 * The catalogue is the chronology guard for the whole domain: every gadget
 * carries the year it becomes legible, so the era inventory tests can prove
 * that no 1945 patron holds a smartphone, no 1985 patron holds a flip phone and
 * no era wears something the future invented:
 *
 * | gadget | introduced | era read |
 * | --- | --- | --- |
 * | newspaper / cigarette | 1900 | 1945 broadsheet and a Woodbine |
 * | transistor radio | 1954 | 1965 picnic-sized portable |
 * | cassette tape / Walkman | 1963 / 1979 | 1985 tape culture |
 * | boombox | 1980 | 1985 shoulder-carried ghetto blaster |
 * | shoulder bag | 1970 | 1985 leather shoulder bag |
 * | laptop | 1991 | 2005/2025 open notebook computer |
 * | flip phone / MP3 player | 1996 / 1998 | 2005 pocket electronics |
 * | headphones | 1958 | 2005/2025 over-ear cans |
 * | reusable cup | 2004 | 2025 keep-cup |
 * | smartphone / wireless earbuds | 2007 / 2016 | 2025 always-online pocket |
 *
 * Every prop is folded from the shared primitive bag ({@link FigureResources})
 * and painted from the era's material library, so props add nodes but no new
 * geometries, textures or downloads.
 */

import * as THREE from 'three';
import type { YearId } from '../../../contracts/period';
import type { FigureResources } from './FigureRig';
import type { FigureMaterialLibrary } from './Wardrobe';

/* -------------------------------------------------------------------------- */
/* Gadget vocabulary                                                          */
/* -------------------------------------------------------------------------- */

export type GadgetId =
  | 'newspaper'
  | 'cigarette'
  | 'coffee-cup'
  | 'notebook'
  | 'roller-pen'
  | 'transistor-radio'
  | 'cassette-tape'
  | 'walkman'
  | 'boombox'
  | 'shoulder-bag'
  | 'wired-earbuds'
  | 'flip-phone'
  | 'mp3-player'
  | 'laptop'
  | 'smartphone'
  | 'headphones'
  | 'wireless-earbuds'
  | 'reusable-cup';

/** Where a gadget can sit on a figure. */
export type GadgetMount =
  | 'hand-left'
  | 'hand-right'
  | 'worn-head'
  | 'worn-ear'
  | 'worn-shoulder'
  | 'worn-hip'
  | 'carry-side'
  | 'surface'
  | 'lap'
  | 'ground';

export interface GadgetDefinition {
  readonly id: GadgetId;
  /** Era-exact label (`'portable transistor radio'`). */
  readonly label: string;
  /** First year the gadget is historically legible. */
  readonly introduced: number;
  /** Preferred mount points, best first. */
  readonly mounts: readonly GadgetMount[];
  /** One line of era context for the inspect caption. */
  readonly detail: string;
}

function defineGadget(
  id: GadgetId,
  label: string,
  introduced: number,
  mounts: readonly GadgetMount[],
  detail: string,
): GadgetDefinition {
  return Object.freeze({ id, label, introduced, mounts: Object.freeze([...mounts]), detail });
}

/** Every gadget the patrons can carry, with its introduction year. */
export const GADGETS: Readonly<Record<GadgetId, GadgetDefinition>> = Object.freeze({
  newspaper: defineGadget(
    'newspaper',
    'folded broadsheet newspaper',
    1900,
    ['hand-left', 'surface'],
    'a broadsheet folded to the racing page',
  ),
  cigarette: defineGadget(
    'cigarette',
    'half-smoked cigarette',
    1900,
    ['hand-right', 'hand-left'],
    'tobacco ration, smoked indoors without a second thought',
  ),
  'coffee-cup': defineGadget(
    'coffee-cup',
    'thick ceramic cup',
    1800,
    ['hand-right', 'surface', 'hand-left'],
    'a heavy white cup on a saucer',
  ),
  notebook: defineGadget(
    'notebook',
    'pocket notebook',
    1800,
    ['surface', 'hand-left'],
    'a chequered pocket pad, open on the table',
  ),
  'roller-pen': defineGadget(
    'roller-pen',
    'fountain pen',
    1945,
    ['hand-right', 'surface'],
    'a lever-fill fountain pen',
  ),
  'transistor-radio': defineGadget(
    'transistor-radio',
    'portable transistor radio',
    1954,
    ['hand-right', 'surface'],
    'a picnic-sized transistor set with a telescopic aerial',
  ),
  'cassette-tape': defineGadget(
    'cassette-tape',
    'compact cassette',
    1963,
    ['surface', 'hand-left'],
    'a labelled cassette, cover propped on the table',
  ),
  walkman: defineGadget(
    'walkman',
    'belt-clip cassette player',
    1979,
    ['worn-hip', 'hand-right'],
    'a belt-clipped portable tape player with foam headphones',
  ),
  boombox: defineGadget(
    'boombox',
    'shoulder-carried boombox',
    1980,
    ['carry-side', 'surface'],
    'a ghetto blaster riding the shoulder, twin speakers forward',
  ),
  'shoulder-bag': defineGadget(
    'shoulder-bag',
    'leather shoulder bag',
    1970,
    ['worn-shoulder', 'surface'],
    'a long-strapped shoulder bag resting on the hip',
  ),
  'wired-earbuds': defineGadget(
    'wired-earbuds',
    'wired earbuds',
    1997,
    ['worn-ear', 'hand-right'],
    'thin white earbuds on a tangle of cable',
  ),
  'flip-phone': defineGadget(
    'flip-phone',
    'flip phone',
    1996,
    ['hand-right', 'surface'],
    'a hinged flip phone, screen up and keypad open',
  ),
  'mp3-player': defineGadget(
    'mp3-player',
    'hard-drive MP3 player',
    1998,
    ['hand-right', 'surface'],
    'a pocket MP3 player with a click wheel',
  ),
  laptop: defineGadget(
    'laptop',
    'open laptop',
    1991,
    ['surface', 'lap'],
    'an open notebook computer, lid tilted back',
  ),
  smartphone: defineGadget(
    'smartphone',
    'smartphone',
    2007,
    ['hand-right', 'surface'],
    'a slab smartphone, screen lit',
  ),
  headphones: defineGadget(
    'headphones',
    'over-ear headphones',
    1958,
    ['worn-head', 'surface'],
    'over-ear headphones with a wide padded band',
  ),
  'wireless-earbuds': defineGadget(
    'wireless-earbuds',
    'wireless earbuds',
    2016,
    ['worn-ear'],
    'two stemmed earbuds, no cable at all',
  ),
  'reusable-cup': defineGadget(
    'reusable-cup',
    'reusable keep-cup',
    2004,
    ['hand-right', 'surface', 'hand-left'],
    'a lidded keep-cup with a silicone band',
  ),
});

/** Every gadget id, sorted for stable diagnostics. */
export const GADGET_IDS: readonly GadgetId[] = Object.freeze(
  Object.keys(GADGETS).sort() as GadgetId[],
);

/** Runtime narrowing helper. */
export function isGadgetId(value: unknown): value is GadgetId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GADGETS, value);
}

/** Looks up a gadget definition, throwing for an unknown id. */
export function gadget(id: GadgetId): GadgetDefinition {
  const definition = GADGETS[id];
  if (!definition) throw new RangeError(`Unknown gadget "${id}".`);
  return definition;
}

/** Introduction year of a gadget. */
export function gadgetIntroducedYear(id: GadgetId): number {
  return gadget(id).introduced;
}

/** True when the gadget is period correct in `year`. */
export function gadgetAppearsIn(id: GadgetId, year: YearId): boolean {
  return gadgetIntroducedYear(id) <= Number.parseInt(year, 10);
}

/**
 * Chronology guard: one message per gadget that does not exist yet in `year`
 * (plus one per unknown id). The era inventory tests fail loudly on a non-empty
 * result, which is what keeps the five sets distinct.
 */
export function gadgetChronologyConflicts(year: YearId, ids: readonly string[]): readonly string[] {
  const limit = Number.parseInt(year, 10);
  const problems: string[] = [];
  for (const id of ids) {
    if (!isGadgetId(id)) {
      problems.push(`unknown gadget "${id}"`);
      continue;
    }
    const introduced = gadgetIntroducedYear(id);
    if (introduced > limit) {
      problems.push(`"${id}" (${introduced}) is anachronistic in ${year}`);
    }
  }
  return problems;
}

/** Human readable labels for a gadget id list. */
export function gadgetLabels(ids: readonly string[]): readonly string[] {
  return Object.freeze(ids.map((id) => (isGadgetId(id) ? GADGETS[id].label : id)));
}

/* -------------------------------------------------------------------------- */
/* Prop construction                                                          */
/* -------------------------------------------------------------------------- */

type Vec3 = readonly [number, number, number];

interface PropPlacement {
  readonly position?: Vec3;
  readonly scale?: Vec3;
  readonly rotation?: Vec3;
}

function piece(
  parent: THREE.Object3D,
  resources: FigureResources,
  geometry: keyof FigureResources['geometries'],
  material: THREE.Material,
  name: string,
  placement: PropPlacement = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(resources.geometries[geometry], material);
  mesh.name = name;
  const position = placement.position ?? [0, 0, 0];
  mesh.position.set(position[0], position[1], position[2]);
  const scale = placement.scale ?? [1, 1, 1];
  mesh.scale.set(scale[0], scale[1], scale[2]);
  const rotation = placement.rotation ?? [0, 0, 0];
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function propGroup(id: GadgetId, mount: GadgetMount): THREE.Group {
  const node = new THREE.Group();
  node.name = `patron-gadget:${id}:${mount}`;
  node.userData['patronGadget'] = id;
  node.userData['patronGadgetMount'] = mount;
  return node;
}

export interface GadgetPropContext {
  readonly resources: FigureResources;
  readonly materials: FigureMaterialLibrary;
}

export interface GadgetProp {
  readonly id: GadgetId;
  readonly label: string;
  readonly mount: GadgetMount;
  /** Group whose origin is the mounting point (grip, tabletop, shoulder, …). */
  readonly group: THREE.Group;
  readonly meshCount: number;
}

/* -- individual props ------------------------------------------------------ */

function buildNewspaper(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  const paper = materials.panel('newsprint');
  piece(node, resources, 'box', paper, 'newsprint-page', {
    position: [0, 0.19, 0],
    scale: [0.3, 0.4, 0.012],
  });
  piece(node, resources, 'box', paper, 'newsprint-fold', {
    position: [0, 0.19, -0.014],
    scale: [0.28, 0.38, 0.01],
    rotation: [0, 0.25, 0],
  });
  piece(node, resources, 'box', materials.panel('gloss-black'), 'newsprint-masthead', {
    position: [0, 0.355, 0.009],
    scale: [0.2, 0.03, 0.006],
  });
}

function buildCigarette(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'cylinder', materials.panel('white-plastic'), 'cigarette-paper', {
    position: [0, 0.035, 0],
    scale: [0.016, 0.07, 0.016],
    rotation: [0, 0, Math.PI / 2.4],
  });
  piece(node, resources, 'sphere', materials.panel('brand-plate'), 'cigarette-ember', {
    position: [0.032, 0.05, 0],
    scale: [0.016, 0.016, 0.016],
    rotation: [0, 0, 0],
  });
}

function buildCoffeeCup(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  const ceramic = materials.panel('white-plastic');
  piece(node, resources, 'cylinder', ceramic, 'cup-body', {
    position: [0, 0.045, 0],
    scale: [0.07, 0.09, 0.07],
  });
  piece(node, resources, 'cylinder', materials.panel('gloss-black'), 'cup-coffee', {
    position: [0, 0.091, 0],
    scale: [0.062, 0.006, 0.062],
  });
  piece(node, resources, 'torus', ceramic, 'cup-handle', {
    position: [0.045, 0.05, 0],
    scale: [0.045, 0.045, 0.045],
    rotation: [0, 0, Math.PI / 2],
  });
}

function buildNotebook(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'box', materials.panel('newsprint'), 'notebook-pad', {
    position: [0, 0.008, 0],
    scale: [0.16, 0.016, 0.22],
  });
  piece(node, resources, 'box', materials.panel('leather'), 'notebook-spine', {
    position: [0, 0.016, -0.1],
    scale: [0.16, 0.014, 0.02],
  });
  piece(node, resources, 'cylinder', materials.panel('brand-plate'), 'notebook-pen', {
    position: [0.11, 0.008, 0.02],
    scale: [0.012, 0.14, 0.012],
    rotation: [0, 0, Math.PI / 2],
  });
}

function buildRollerPen(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'cylinder', materials.panel('gloss-black'), 'pen-barrel', {
    position: [0, 0.06, 0],
    scale: [0.016, 0.12, 0.016],
    rotation: [0.25, 0, 0],
  });
  piece(node, resources, 'cone', materials.panel('brand-plate'), 'pen-nib', {
    position: [0, 0.128, -0.02],
    scale: [0.014, 0.03, 0.014],
    rotation: [0.25, 0, 0],
  });
}

function buildTransistorRadio(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  const shell = materials.dye(4, 'solid');
  piece(node, resources, 'box', shell, 'radio-case', {
    position: [0, 0.07, 0],
    scale: [0.17, 0.11, 0.055],
  });
  piece(node, resources, 'cylinder', materials.panel('metal'), 'radio-speaker', {
    position: [0.035, 0.075, 0.03],
    scale: [0.07, 0.008, 0.07],
    rotation: [Math.PI / 2, 0, 0],
  });
  piece(node, resources, 'box', materials.panel('radio-dial'), 'radio-dial', {
    position: [-0.05, 0.09, 0.03],
    scale: [0.055, 0.03, 0.006],
  });
  piece(node, resources, 'cylinder', materials.panel('brand-plate'), 'radio-aerial', {
    position: [-0.07, 0.2, 0],
    scale: [0.006, 0.28, 0.006],
    rotation: [0, 0, 0.22],
  });
}

function buildCassetteTape(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'box', materials.panel('plastic'), 'cassette-shell', {
    position: [0, 0.05, 0],
    scale: [0.1, 0.065, 0.016],
    rotation: [0.35, 0, 0],
  });
  piece(node, resources, 'cylinder', materials.panel('cassette-window'), 'cassette-hub-left', {
    position: [-0.022, 0.05, 0.01],
    scale: [0.028, 0.006, 0.028],
    rotation: [Math.PI / 2, 0, 0],
  });
  piece(node, resources, 'cylinder', materials.panel('cassette-window'), 'cassette-hub-right', {
    position: [0.022, 0.05, 0.01],
    scale: [0.028, 0.006, 0.028],
    rotation: [Math.PI / 2, 0, 0],
  });
}

function buildWalkman(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'box', materials.panel('gloss-black'), 'walkman-body', {
    position: [0, 0.065, 0],
    scale: [0.11, 0.085, 0.03],
  });
  piece(node, resources, 'box', materials.panel('cassette-window'), 'walkman-window', {
    position: [0, 0.08, 0.016],
    scale: [0.06, 0.04, 0.006],
  });
  for (let button = 0; button < 3; button += 1) {
    piece(node, resources, 'box', materials.panel('brand-plate'), `walkman-button-${button}`, {
      position: [(button - 1) * 0.025, 0.025, 0.016],
      scale: [0.018, 0.01, 0.006],
    });
  }
  piece(node, resources, 'box', materials.panel('metal'), 'walkman-clip', {
    position: [0, 0.115, -0.014],
    scale: [0.05, 0.05, 0.008],
  });
}

function buildBoombox(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  const shell = materials.dye(0, 'solid');
  piece(node, resources, 'box', shell, 'boombox-body', {
    position: [0, 0.1, 0],
    scale: [0.36, 0.19, 0.1],
  });
  for (const side of [-1, 1] as const) {
    piece(node, resources, 'cylinder', materials.panel('metal'), `boombox-speaker-${side}`, {
      position: [side * 0.11, 0.1, 0.052],
      scale: [0.125, 0.01, 0.125],
      rotation: [Math.PI / 2, 0, 0],
    });
  }
  piece(node, resources, 'box', materials.panel('cassette-window'), 'boombox-deck', {
    position: [0, 0.13, 0.052],
    scale: [0.09, 0.05, 0.008],
  });
  piece(node, resources, 'torus', materials.panel('brand-plate'), 'boombox-handle', {
    position: [0, 0.2, 0],
    scale: [0.2, 0.13, 0.13],
    rotation: [0, 0, 0],
  });
}

function buildShoulderBag(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'box', materials.panel('leather'), 'bag-strap', {
    position: [0.02, -0.18, 0],
    scale: [0.035, 0.44, 0.012],
    rotation: [0, 0, 0.12],
  });
  piece(node, resources, 'box', materials.panel('leather'), 'bag-body', {
    position: [0.09, -0.4, 0],
    scale: [0.2, 0.18, 0.07],
  });
  piece(node, resources, 'box', materials.panel('brand-plate'), 'bag-clasp', {
    position: [0.09, -0.35, 0.04],
    scale: [0.04, 0.025, 0.01],
  });
}

function buildWiredEarbuds(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  for (const side of [-1, 1] as const) {
    piece(node, resources, 'sphere', materials.panel('white-plastic'), `earbud-${side}`, {
      position: [side * 0.028, 0, 0],
      scale: [0.028, 0.028, 0.028],
    });
  }
  piece(node, resources, 'cylinder', materials.panel('white-plastic'), 'earbud-cable', {
    position: [0, -0.12, 0],
    scale: [0.006, 0.24, 0.006],
  });
}

function buildFlipPhone(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'box', materials.panel('gloss-black'), 'flip-lower', {
    position: [0, 0.055, 0.012],
    scale: [0.045, 0.11, 0.014],
    rotation: [1.15, 0, 0],
  });
  piece(node, resources, 'box', materials.panel('gloss-black'), 'flip-upper', {
    position: [0, 0.115, -0.02],
    scale: [0.045, 0.09, 0.012],
    rotation: [0.32, 0, 0],
  });
  piece(node, resources, 'box', materials.panel('screen-lit'), 'flip-screen', {
    position: [0, 0.12, -0.012],
    scale: [0.034, 0.055, 0.004],
    rotation: [0.32, 0, 0],
  });
}

function buildMp3Player(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'box', materials.panel('white-plastic'), 'mp3-body', {
    position: [0, 0.055, 0],
    scale: [0.06, 0.11, 0.012],
  });
  piece(node, resources, 'box', materials.panel('screen-dim'), 'mp3-screen', {
    position: [0, 0.088, 0.008],
    scale: [0.045, 0.03, 0.004],
  });
  piece(node, resources, 'cylinder', materials.panel('brand-plate'), 'mp3-wheel', {
    position: [0, 0.038, 0.008],
    scale: [0.05, 0.006, 0.05],
    rotation: [Math.PI / 2, 0, 0],
  });
}

function buildLaptop(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'box', materials.panel('metal'), 'laptop-base', {
    position: [0, 0.012, 0],
    scale: [0.32, 0.022, 0.23],
  });
  piece(node, resources, 'box', materials.panel('gloss-black'), 'laptop-keyboard', {
    position: [0, 0.026, 0.02],
    scale: [0.27, 0.006, 0.13],
  });
  piece(node, resources, 'box', materials.panel('metal'), 'laptop-lid', {
    position: [0, 0.13, -0.125],
    scale: [0.32, 0.23, 0.016],
    rotation: [-0.32, 0, 0],
  });
  piece(node, resources, 'box', materials.panel('screen-lit'), 'laptop-screen', {
    position: [0, 0.132, -0.115],
    scale: [0.28, 0.195, 0.004],
    rotation: [-0.32, 0, 0],
  });
}

function buildSmartphone(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'box', materials.panel('gloss-black'), 'phone-body', {
    position: [0, 0.06, 0],
    scale: [0.072, 0.145, 0.009],
  });
  piece(node, resources, 'box', materials.panel('screen-lit'), 'phone-screen', {
    position: [0, 0.06, 0.006],
    scale: [0.063, 0.132, 0.003],
  });
  piece(node, resources, 'cylinder', materials.panel('glass'), 'phone-camera', {
    position: [-0.02, 0.125, 0.008],
    scale: [0.012, 0.004, 0.012],
    rotation: [Math.PI / 2, 0, 0],
  });
}

function buildHeadphones(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'torus', materials.panel('headphone-cup'), 'headphone-band', {
    position: [0, 0.02, 0],
    scale: [0.26, 0.26, 0.26],
    rotation: [0, 0, 0],
  });
  for (const side of [-1, 1] as const) {
    piece(node, resources, 'cylinder', materials.panel('headphone-cup'), `headphone-cup-${side}`, {
      position: [side * 0.115, -0.02, 0],
      scale: [0.075, 0.035, 0.075],
      rotation: [0, 0, Math.PI / 2],
    });
  }
  piece(node, resources, 'box', materials.panel('metal'), 'headphone-slider', {
    position: [0, 0.1, 0],
    scale: [0.18, 0.014, 0.014],
  });
}

function buildWirelessEarbuds(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  for (const side of [-1, 1] as const) {
    piece(node, resources, 'sphere', materials.panel('white-plastic'), `bud-${side}`, {
      position: [side * 0.026, 0.005, 0],
      scale: [0.026, 0.026, 0.026],
    });
    piece(node, resources, 'box', materials.panel('white-plastic'), `bud-stem-${side}`, {
      position: [side * 0.026, -0.026, 0],
      scale: [0.011, 0.045, 0.011],
    });
  }
}

function buildReusableCup(node: THREE.Group, context: GadgetPropContext): void {
  const { resources, materials } = context;
  piece(node, resources, 'cylinder', materials.panel('reusable-cup'), 'keep-cup-body', {
    position: [0, 0.06, 0],
    scale: [0.08, 0.14, 0.08],
  });
  piece(node, resources, 'cylinder', materials.dye(2, 'stripe'), 'keep-cup-band', {
    position: [0, 0.05, 0],
    scale: [0.086, 0.05, 0.086],
  });
  piece(node, resources, 'cone', materials.panel('plastic'), 'keep-cup-lid', {
    position: [0, 0.14, 0],
    scale: [0.08, 0.035, 0.08],
  });
}

/* -- dispatch -------------------------------------------------------------- */

const BUILDERS: Readonly<Record<GadgetId, (node: THREE.Group, context: GadgetPropContext) => void>> =
  Object.freeze({
    newspaper: buildNewspaper,
    cigarette: buildCigarette,
    'coffee-cup': buildCoffeeCup,
    notebook: buildNotebook,
    'roller-pen': buildRollerPen,
    'transistor-radio': buildTransistorRadio,
    'cassette-tape': buildCassetteTape,
    walkman: buildWalkman,
    boombox: buildBoombox,
    'shoulder-bag': buildShoulderBag,
    'wired-earbuds': buildWiredEarbuds,
    'flip-phone': buildFlipPhone,
    'mp3-player': buildMp3Player,
    laptop: buildLaptop,
    smartphone: buildSmartphone,
    headphones: buildHeadphones,
    'wireless-earbuds': buildWirelessEarbuds,
    'reusable-cup': buildReusableCup,
  });

/**
 * Builds one gadget prop whose origin is its mounting point, so the figure rig
 * can drop it straight into a socket.
 */
export function createGadgetProp(id: GadgetId, context: GadgetPropContext): GadgetProp {
  const definition = gadget(id);
  const mount = definition.mounts[0] ?? 'surface';
  const node = propGroup(id, mount);
  BUILDERS[id](node, context);
  let meshCount = 0;
  node.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) meshCount += 1;
  });
  return Object.freeze({
    id,
    label: definition.label,
    mount,
    group: node,
    meshCount,
  });
}

/** Gizmo group name prefix, used to address props from the tests. */
export const GADGET_NODE_PREFIX = 'patron-gadget:';
