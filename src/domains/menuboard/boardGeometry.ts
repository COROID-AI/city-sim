/**
 * Board geometry: the era forms, where the board hangs, and the carcass members.
 *
 * This module is pure maths over the shared contracts — no three.js mesh is
 * built here, so every decision the board makes about its own size and position
 * is assertable headlessly:
 *
 *  - {@link boardForm} — the five physical forms: a small portrait chalk slate,
 *    a wide painted panel, a deep fluorescent light box with a promo housing, a
 *    bank of backlit acrylic panels and a bezelled digital screen.
 *  - {@link resolveBoardAnchor} / {@link boardPlacement} — placement derived from
 *    the environment shell, never from hard-coded world coordinates. The board
 *    prefers the shell's designated `menu` wall mount (the anchor the poster
 *    domain reserves a readable sightline around) and falls back to a
 *    counter-wall anchor derived from the counter zone when a layout publishes
 *    no menu mount.
 *  - {@link boardMembers} — the carcass decomposed into named members (slab,
 *    frame bars, chalk ledge, light box, rails, bezel, standoffs, brackets),
 *    which is what makes the five boards structurally different rather than one
 *    box with five textures.
 *  - {@link boardPlacementProblems} — the invariant check the module, the
 *    composition suite and later verification work all run: finite transforms,
 *    inside {@link RoomBounds}, on a wall plane, clear of the reserved doorway,
 *    glazing, entrance and the counter.
 */

import type { RoomBounds } from '../../contracts/period';
import type { ReservedZone, StructuralLayout, WallId, WallMountSurface } from '../environment/roomBounds';
import type {
  BoardAnchor,
  BoardBox,
  BoardForm,
  BoardMaterialRole,
  BoardMember,
  BoardPlacement,
  FaceRect,
  MenuBoardKind,
  MenuBoardSpec,
  PanelRegion,
} from './types';
import type { BoardLayout } from './lettering';

/* -------------------------------------------------------------------------- */
/* Forms                                                                     */
/* -------------------------------------------------------------------------- */

/** True when a form is a manufacture rather than a piece of stone. */
interface FormRecipe extends BoardForm {
  readonly notes: string;
}

const FORMS: Readonly<Record<MenuBoardKind, FormRecipe>> = Object.freeze({
  'chalk-slate': Object.freeze({
    kind: 'chalk-slate' as const,
    name: 'Hand-chalked slate',
    width: 0.92,
    height: 1.28,
    depth: 0.055,
    thickness: 0.045,
    frameWidth: 0.065,
    panelCount: 2,
    tilt: 0.03,
    hasPromoStrip: false,
    hasLightBox: false,
    backlit: false,
    emissive: false,
    hasChalkLedge: true,
    stone: true,
    notes: 'Riven slate in a stained oak surround with a chalk ledge and a duster.',
  }),
  'painted-vinyl': Object.freeze({
    kind: 'painted-vinyl' as const,
    name: 'Painted panel with applied vinyl lettering',
    width: 1.14,
    height: 0.94,
    depth: 0.05,
    thickness: 0.038,
    frameWidth: 0.045,
    panelCount: 3,
    tilt: 0.015,
    hasPromoStrip: false,
    hasLightBox: false,
    backlit: false,
    emissive: false,
    hasChalkLedge: false,
    stone: false,
    notes: 'Signwriter’s panel: gloss coach paint, vinyl letters applied by hand.',
  }),
  'fluorescent-letterboard': Object.freeze({
    kind: 'fluorescent-letterboard' as const,
    name: 'Fluorescent letter board in a light box',
    width: 1.16,
    height: 1.04,
    depth: 0.115,
    thickness: 0.09,
    frameWidth: 0.055,
    panelCount: 2,
    tilt: 0.012,
    hasPromoStrip: true,
    hasLightBox: true,
    backlit: true,
    emissive: true,
    hasChalkLedge: false,
    stone: false,
    notes: 'Twin fluorescent tubes behind slotted rails, with a promo strip along the foot.',
  }),
  'backlit-acrylic': Object.freeze({
    kind: 'backlit-acrylic' as const,
    name: 'Backlit acrylic menu panels',
    width: 1.18,
    height: 0.96,
    depth: 0.085,
    thickness: 0.058,
    frameWidth: 0.04,
    panelCount: 3,
    tilt: 0.014,
    hasPromoStrip: false,
    hasLightBox: true,
    backlit: true,
    emissive: true,
    hasChalkLedge: false,
    stone: false,
    notes: 'Three frosted acrylic panels spaced off a brushed aluminium light box.',
  }),
  'digital-screen': Object.freeze({
    kind: 'digital-screen' as const,
    name: 'Emissive digital menu screen',
    width: 1.18,
    height: 0.72,
    depth: 0.065,
    thickness: 0.05,
    frameWidth: 0.032,
    panelCount: 4,
    tilt: -0.06,
    hasPromoStrip: false,
    hasLightBox: false,
    backlit: true,
    emissive: true,
    hasChalkLedge: false,
    stone: false,
    notes: 'Slim bezelled panel split into rotating menu sections, tilted down to the customer.',
  }),
});

/** Every board form, in timeline order. */
export const BOARD_FORMS: readonly BoardForm[] = Object.freeze([
  FORMS['chalk-slate'],
  FORMS['painted-vinyl'],
  FORMS['fluorescent-letterboard'],
  FORMS['backlit-acrylic'],
  FORMS['digital-screen'],
]);

/** The physical form of one era's board. */
export function boardForm(kind: MenuBoardKind): BoardForm {
  return FORMS[kind];
}

/** The form an era spec asks for. */
export function boardFormForSpec(spec: MenuBoardSpec): BoardForm {
  return boardForm(spec.boardKind);
}

/** The joinery / hardware note that goes with a form (used by diagnostics). */
export function boardFormNotes(kind: MenuBoardKind): string {
  return FORMS[kind].notes;
}

/** Structural fingerprint of a form: what makes each era's board different. */
export function boardGeometrySignature(form: BoardForm): string {
  const round = (value: number): number => Math.round(value * 1000) / 1000;
  return [
    form.kind,
    `w${round(form.width)}`,
    `h${round(form.height)}`,
    `d${round(form.depth)}`,
    `t${round(form.thickness)}`,
    `f${round(form.frameWidth)}`,
    `p${form.panelCount}`,
    form.hasPromoStrip ? 'promo' : '-',
    form.hasLightBox ? 'box' : '-',
    form.backlit ? 'lit' : '-',
    form.emissive ? 'emit' : '-',
    form.hasChalkLedge ? 'ledge' : '-',
    form.stone ? 'stone' : 'made',
  ].join('|');
}

/* -------------------------------------------------------------------------- */
/* Wall frames                                                               */
/* -------------------------------------------------------------------------- */

/** Wall coordinate frame: how a wall's plane, normal and lateral axis map to world. */
export interface BoardWallFrame {
  readonly wall: WallId;
  /** Rotation about Y that turns a `+Z` facing board towards the room. */
  readonly rotationY: number;
  /** Inward normal of the wall. */
  readonly normal: { readonly x: number; readonly y: number; readonly z: number };
  /** World direction of the board face's local `+X`. */
  readonly lateral: { readonly x: number; readonly y: number; readonly z: number };
}

/** Coordinate frame of one wall of the room. */
export function boardWallFrame(wall: WallId): BoardWallFrame {
  switch (wall) {
    case 'front':
      return { wall, rotationY: Math.PI, normal: { x: 0, y: 0, z: -1 }, lateral: { x: -1, y: 0, z: 0 } };
    case 'right':
      return { wall, rotationY: -Math.PI / 2, normal: { x: -1, y: 0, z: 0 }, lateral: { x: 0, y: 0, z: 1 } };
    case 'left':
      return { wall, rotationY: Math.PI / 2, normal: { x: 1, y: 0, z: 0 }, lateral: { x: 0, y: 0, z: -1 } };
    case 'back':
    default:
      return { wall: 'back', rotationY: 0, normal: { x: 0, y: 0, z: 1 }, lateral: { x: 1, y: 0, z: 0 } };
  }
}

/* -------------------------------------------------------------------------- */
/* Anchors                                                                   */
/* -------------------------------------------------------------------------- */

/** Id of the fallback anchor derived from the counter zone. */
export const COUNTER_WALL_ANCHOR_ID = 'counter-wall';

/** The shell's dedicated menu mount, if it publishes one. */
export function menuMountOf(layout: StructuralLayout): WallMountSurface | undefined {
  return (
    layout.wallMounts.find((mount) => mount.purpose === 'menu') ??
    layout.wallMounts.find((mount) => mount.id.includes('menu'))
  );
}

/** Scales a form down until it fits the space an anchor can carry. */
export function clampFormToCapacity(
  form: BoardForm,
  capacity: { readonly width: number; readonly height: number },
): BoardForm {
  if (!Number.isFinite(capacity.width) || !Number.isFinite(capacity.height)) return form;
  const widthFactor = capacity.width > 0 ? capacity.width / form.width : 1;
  const heightFactor = capacity.height > 0 ? capacity.height / form.height : 1;
  const factor = Math.min(1, widthFactor, heightFactor);
  if (!Number.isFinite(factor) || factor >= 1 - 1e-9) return form;
  return Object.freeze({
    ...form,
    width: form.width * factor,
    height: form.height * factor,
    depth: form.depth * Math.max(factor, 0.7),
  });
}

/**
 * Where one era's board hangs. The shell's dedicated menu mount wins, because
 * the poster domain reserves a readable sightline around exactly that mount and
 * never places artwork on it. When a layout publishes no menu mount (a custom
 * shell), the anchor is derived from the counter zone instead: centred on the
 * counter, clear of its top, on the wall the counter stands against.
 */
export function resolveBoardAnchor(layout: StructuralLayout, form: BoardForm): BoardAnchor {
  const mount = menuMountOf(layout);
  if (mount) {
    const frame = boardWallFrame(mount.wall);
    return {
      id: mount.id,
      source: 'wall-mount',
      wall: mount.wall,
      position: { x: mount.position.x, y: mount.position.y, z: mount.position.z },
      normal: frame.normal,
      rotationY: frame.rotationY,
      capacity: {
        width: Math.max(mount.width + 0.5, 0.5),
        height: Math.max(mount.height + 0.5, 0.6),
      },
    };
  }

  const counter = layout.counter;
  const wall =
    layout.walls.find((entry) => entry.id === 'back') ?? layout.walls[0];
  const frame = boardWallFrame(wall?.id ?? 'back');
  const bottom = counter.surfaceHeight + 0.3;
  const available = Math.max(layout.bounds.height - bottom - 0.35, 0.6);
  return {
    id: COUNTER_WALL_ANCHOR_ID,
    source: 'counter-wall',
    wall: wall?.id ?? 'back',
    position: {
      x: counter.center.x,
      y: bottom + Math.min(form.height, available) / 2,
      z: wall?.center.z ?? -layout.bounds.depth / 2,
    },
    normal: frame.normal,
    rotationY: frame.rotationY,
    capacity: {
      width: Math.max(Math.min(counter.width * 0.9, 2.8), 0.6),
      height: available,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Placement                                                                 */
/* -------------------------------------------------------------------------- */

interface Extents {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

function axisExtents(extents: Extents, rotationY: number, tilt: number): {
  readonly x: number;
  readonly y: number;
  readonly z: number;
} {
  const halfWidth = extents.width / 2;
  const halfHeight = extents.height / 2;
  const halfDepth = extents.depth / 2;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  let x = 0;
  let y = 0;
  let z = 0;
  for (const localX of [-halfWidth, halfWidth]) {
    for (const localY of [-halfHeight, halfHeight]) {
      for (const localZ of [-halfDepth, halfDepth]) {
        const tiltedY = localY * cosTilt - localZ * sinTilt;
        const tiltedZ = localY * sinTilt + localZ * cosTilt;
        x = Math.max(x, Math.abs(localX * cosY + tiltedZ * sinY));
        y = Math.max(y, Math.abs(tiltedY));
        z = Math.max(z, Math.abs(-localX * sinY + tiltedZ * cosY));
      }
    }
  }
  return { x, y, z };
}

/** World box of a board hung with `rotationY` and `tilt` at `position`. */
export function boardBox(
  position: { readonly x: number; readonly y: number; readonly z: number },
  rotationY: number,
  tilt: number,
  extents: Extents,
): BoardBox {
  const half = axisExtents(extents, rotationY, tilt);
  return {
    min: { x: position.x - half.x, y: position.y - half.y, z: position.z - half.z },
    max: { x: position.x + half.x, y: position.y + half.y, z: position.z + half.z },
  };
}

/** Smallest distance of a box's corners behind `origin`, along `normal`. */
function minAlongNormal(
  box: BoardBox,
  origin: { readonly x: number; readonly y: number; readonly z: number },
  normal: { readonly x: number; readonly y: number; readonly z: number },
): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        minimum = Math.min(
          minimum,
          (x - origin.x) * normal.x + (y - origin.y) * normal.y + (z - origin.z) * normal.z,
        );
      }
    }
  }
  return minimum;
}

/**
 * Hangs a form on an anchor, hugging the wall plane. A tilted board rests on its
 * brackets, so the carcass is nudged off the wall just far enough that the tilt
 * never lets a corner through the plaster.
 */
export function boardPlacement(anchor: BoardAnchor, form: BoardForm): BoardPlacement {
  const clamped = clampFormToCapacity(form, anchor.capacity);
  let centre = {
    x: anchor.position.x + anchor.normal.x * (clamped.depth / 2),
    y: anchor.position.y + anchor.normal.y * (clamped.depth / 2),
    z: anchor.position.z + anchor.normal.z * (clamped.depth / 2),
  };
  const extents: Extents = {
    width: clamped.width,
    height: clamped.height,
    depth: clamped.depth,
  };
  let box = boardBox(centre, anchor.rotationY, clamped.tilt, extents);
  const behind = minAlongNormal(box, anchor.position, anchor.normal);
  if (behind < 0) {
    const clearance = -behind + 0.001;
    centre = {
      x: centre.x + anchor.normal.x * clearance,
      y: centre.y + anchor.normal.y * clearance,
      z: centre.z + anchor.normal.z * clearance,
    };
    box = boardBox(centre, anchor.rotationY, clamped.tilt, extents);
  }
  return {
    anchorId: anchor.id,
    source: anchor.source,
    wall: anchor.wall,
    position: centre,
    normal: anchor.normal,
    rotationY: anchor.rotationY,
    tilt: clamped.tilt,
    width: clamped.width,
    height: clamped.height,
    depth: clamped.depth,
    box,
    form: clamped,
  };
}

/* -------------------------------------------------------------------------- */
/* Carcass members                                                           */
/* -------------------------------------------------------------------------- */

function faceRect(x: number, y: number, width: number, height: number): FaceRect {
  return { x, y, width, height };
}

function member(
  id: string,
  role: BoardMember['role'],
  material: BoardMaterialRole,
  rect: FaceRect,
  depth: number,
  offset: number,
  details: string,
): BoardMember {
  return Object.freeze({ id, role, material, rect, depth, offset, details });
}

/**
 * The board carcass of one era, in face space. Members carry real dimensions,
 * material roles and prose so the five boards differ structurally: oak surround
 * and chalk ledge, painted panel with slim trim, light box with tile rails and a
 * promo housing, spaced acrylic panels on standoffs, or a bezelled screen.
 */
export function boardMembers(form: BoardForm): readonly BoardMember[] {
  const aspect = form.width / form.height;
  const frame = form.frameWidth;
  const thickness = form.thickness;
  const front = thickness + 0.004;
  const members: BoardMember[] = [];

  const hollow = (id: string): FaceRect =>
    faceRect(frame, frame, Math.max(aspect - frame * 2, aspect * 0.2), Math.max(1 - frame * 2, 0.2));

  switch (form.kind) {
    case 'chalk-slate': {
      members.push(
        member('slate-slab', 'slab', 'stone', faceRect(0, 0, aspect, 1), thickness, thickness / 2, 'Riven slate, 45 mm, edges left unchamfered.'),
        member('oak-frame-top', 'frame-bar', 'frame', faceRect(0, 1 - frame, aspect, frame), 0.01, thickness + 0.005, 'Stained oak moulding, mitred at the corners.'),
        member('oak-frame-bottom', 'frame-bar', 'frame', faceRect(0, 0, aspect, frame), 0.01, thickness + 0.005, 'Stained oak moulding, mitred at the corners.'),
        member('oak-frame-left', 'frame-bar', 'frame', faceRect(0, 0, frame, 1), 0.01, thickness + 0.005, 'Stained oak moulding, mitred at the corners.'),
        member('oak-frame-right', 'frame-bar', 'frame', faceRect(aspect - frame, 0, frame, 1), 0.01, thickness + 0.005, 'Stained oak moulding, mitred at the corners.'),
        member('chalk-ledge', 'chalk-ledge', 'frame', faceRect(frame, 0.004, aspect - frame * 2, 0.03), 0.02, thickness - 0.008, 'Ash ledge holding the chalk and the felt duster.'),
        member('bracket-left', 'bracket', 'metal', faceRect(frame * 0.5, 0.62, 0.03, 0.22), 0.008, thickness + 0.006, 'Wrought-iron strap bracket.'),
        member('bracket-right', 'bracket', 'metal', faceRect(aspect - frame * 0.5 - 0.03, 0.62, 0.03, 0.22), 0.008, thickness + 0.006, 'Wrought-iron strap bracket.'),
      );
      break;
    }
    case 'painted-vinyl': {
      members.push(
        member('painted-body', 'slab', 'frame', faceRect(0, 0, aspect, 1), thickness, thickness / 2, 'Blockboard body, gloss coach painted in two coats.'),
        member('trim-top', 'frame-bar', 'trim', faceRect(0, 1 - frame, aspect, frame), 0.012, thickness + 0.006, 'Slim dark trim pin-striped around the panel.'),
        member('trim-bottom', 'frame-bar', 'trim', faceRect(0, 0, aspect, frame), 0.012, thickness + 0.006, 'Slim dark trim pin-striped around the panel.'),
        member('trim-left', 'frame-bar', 'trim', faceRect(0, 0, frame, 1), 0.012, thickness + 0.006, 'Slim dark trim pin-striped around the panel.'),
        member('trim-right', 'frame-bar', 'trim', faceRect(aspect - frame, 0, frame, 1), 0.012, thickness + 0.006, 'Slim dark trim pin-striped around the panel.'),
        member('header-plate', 'header-plate', 'trim', faceRect(frame, 1 - frame * 2.1, aspect - frame * 2, frame * 0.6), 0.008, front + 0.004, 'Brass plate carrying the shop name.'),
        member('bracket-left', 'bracket', 'metal', faceRect(frame * 0.6, 0.6, 0.024, 0.2), 0.008, thickness + 0.004, 'Brass strap holding the panel to the wall.'),
        member('bracket-right', 'bracket', 'metal', faceRect(aspect - frame * 0.6 - 0.024, 0.6, 0.024, 0.2), 0.008, thickness + 0.004, 'Brass strap holding the panel to the wall.'),
      );
      break;
    }
    case 'fluorescent-letterboard': {
      const promoHeight = 0.19;
      members.push(
        member('light-box', 'light-box', 'emissive', faceRect(0, 0, aspect, 1), thickness, thickness / 2, 'Sheet-steel light box housing twin fluorescent tubes.'),
        member('bezel-top', 'frame-bar', 'trim', faceRect(0, 1 - frame, aspect, frame), 0.016, thickness + 0.008, 'Extruded aluminium bezel.'),
        member('bezel-bottom', 'frame-bar', 'trim', faceRect(0, 0, aspect, frame), 0.016, thickness + 0.008, 'Extruded aluminium bezel.'),
        member('bezel-left', 'frame-bar', 'trim', faceRect(0, 0, frame, 1), 0.016, thickness + 0.008, 'Extruded aluminium bezel.'),
        member('bezel-right', 'frame-bar', 'trim', faceRect(aspect - frame, 0, frame, 1), 0.016, thickness + 0.008, 'Extruded aluminium bezel.'),
        member('tile-rail-upper', 'grid-rail', 'felt', faceRect(frame, 0.5, aspect - frame * 2, 0.012), 0.01, front + 0.002, 'Slotted rail gripping the upper rows of tiles.'),
        member('tile-rail-lower', 'grid-rail', 'felt', faceRect(frame, 0.24, aspect - frame * 2, 0.012), 0.01, front + 0.002, 'Slotted rail gripping the lower rows of tiles.'),
        member('promo-housing', 'promo-band', 'trim', faceRect(frame, frame * 0.8, aspect - frame * 2, promoHeight), 0.02, thickness + 0.012, 'Glazed housing carrying the promo strip.'),
        member('bracket-left', 'bracket', 'metal', faceRect(frame * 0.5, 0.66, 0.026, 0.24), 0.008, thickness + 0.008, 'Steel strap bracket and chain.'),
        member('bracket-right', 'bracket', 'metal', faceRect(aspect - frame * 0.5 - 0.026, 0.66, 0.026, 0.24), 0.008, thickness + 0.008, 'Steel strap bracket and chain.'),
      );
      break;
    }
    case 'backlit-acrylic': {
      const dividerWidth = 0.012;
      members.push(
        member('light-box-backing', 'backing', 'frame', faceRect(0, 0, aspect, 1), thickness, thickness / 2, 'Brushed aluminium light box with an even diffuser.'),
        member('acrylic-bay-1', 'panel', 'glass', faceRect(frame, frame, (aspect - frame * 2) / 3, 1 - frame * 2), 0.008, front + 0.004, 'Frosted acrylic panel, edge lit.'),
        member('acrylic-bay-2', 'panel', 'glass', faceRect(frame + (aspect - frame * 2) / 3 + dividerWidth, frame, (aspect - frame * 2) / 3, 1 - frame * 2), 0.008, front + 0.004, 'Frosted acrylic panel, edge lit.'),
        member('acrylic-bay-3', 'panel', 'glass', faceRect(frame + ((aspect - frame * 2) / 3 + dividerWidth) * 2, frame, (aspect - frame * 2) / 3, 1 - frame * 2), 0.008, front + 0.004, 'Frosted acrylic panel, edge lit.'),
        member('divider-1', 'grid-rail', 'trim', faceRect(frame + (aspect - frame * 2) / 3, frame, dividerWidth, 1 - frame * 2), 0.01, thickness + 0.008, 'Anodised divider between the panels.'),
        member('divider-2', 'grid-rail', 'trim', faceRect(frame + (aspect - frame * 2) / 3 * 2 + dividerWidth, frame, dividerWidth, 1 - frame * 2), 0.01, thickness + 0.008, 'Anodised divider between the panels.'),
        member('standoff-1', 'standoff', 'metal', faceRect(frame * 0.6, 0.94, 0.02, 0.02), 0.02, front + 0.01, 'Polished standoff fixing.'),
        member('standoff-2', 'standoff', 'metal', faceRect(aspect - frame * 0.6 - 0.02, 0.94, 0.02, 0.02), 0.02, front + 0.01, 'Polished standoff fixing.'),
        member('standoff-3', 'standoff', 'metal', faceRect(frame * 0.6, 0.06, 0.02, 0.02), 0.02, front + 0.01, 'Polished standoff fixing.'),
        member('standoff-4', 'standoff', 'metal', faceRect(aspect - frame * 0.6 - 0.02, 0.06, 0.02, 0.02), 0.02, front + 0.01, 'Polished standoff fixing.'),
      );
      break;
    }
    case 'digital-screen':
    default: {
      members.push(
        member('screen-backbox', 'backing', 'frame', faceRect(0, 0, aspect, 1), thickness, thickness / 2, 'Ventilated back box carrying the panel driver.'),
        member('screen-glass', 'screen-glass', 'glass', hollow('screen-glass'), 0.01, front + 0.006, 'Anti-glare glass over a 4K panel.'),
        member('bezel-top', 'frame-bar', 'trim', faceRect(0, 1 - frame, aspect, frame), 0.014, thickness + 0.007, 'Anodised bezel, 32 mm.'),
        member('bezel-bottom', 'frame-bar', 'trim', faceRect(0, 0, aspect, frame), 0.014, thickness + 0.007, 'Anodised bezel, 32 mm.'),
        member('bezel-left', 'frame-bar', 'trim', faceRect(0, 0, frame, 1), 0.014, thickness + 0.007, 'Anodised bezel, 32 mm.'),
        member('bezel-right', 'frame-bar', 'trim', faceRect(aspect - frame, 0, frame, 1), 0.014, thickness + 0.007, 'Anodised bezel, 32 mm.'),
        member('panel-divider-1', 'grid-rail', 'trim', faceRect(aspect / 4, frame, 0.008, 1 - frame * 2), 0.008, front + 0.004, 'Screen section divider.'),
        member('panel-divider-2', 'grid-rail', 'trim', faceRect(aspect / 2, frame, 0.008, 1 - frame * 2), 0.008, front + 0.004, 'Screen section divider.'),
        member('panel-divider-3', 'grid-rail', 'trim', faceRect((aspect * 3) / 4, frame, 0.008, 1 - frame * 2), 0.008, front + 0.004, 'Screen section divider.'),
        member('vent-grille', 'standoff', 'metal', faceRect(frame, frame * 0.3, aspect - frame * 2, frame * 0.5), 0.006, thickness + 0.003, 'Vent grille along the lower bezel.'),
        member('bezel-screw-left', 'bracket', 'metal', faceRect(frame * 0.6, frame * 0.35, 0.016, 0.016), 0.006, thickness + 0.008, 'Bezel screw cover hiding the VESA plate.'),
        member('bezel-screw-right', 'bracket', 'metal', faceRect(aspect - frame * 0.6 - 0.016, frame * 0.35, 0.016, 0.016), 0.006, thickness + 0.008, 'Bezel screw cover hiding the VESA plate.'),
      );
      break;
    }
  }
  return Object.freeze(members);
}

/* -------------------------------------------------------------------------- */
/* Panel regions                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Addressable regions of the board face: the menu panels (or chalked columns),
 * plus the promo band. The module builds one mesh and one hotspot per region,
 * and the update loop drives the rotating screen panels through them.
 */
export function boardPanelRegions(layout: BoardLayout): readonly PanelRegion[] {
  const regions: PanelRegion[] = [];
  const panels = layout.panels;
  if (panels.length > 0) {
    for (const panel of panels) {
      regions.push({
        id: `region:${panel.panelId}`,
        panelId: panel.panelId,
        index: panel.index,
        title: panel.title,
        emphasis: panel.emphasis,
        kind: panel.kind === 'digital-panel' ? 'digital-panel' : 'backlit-panel',
        rect: panel.bounds,
        itemIds: panel.itemIds,
        rotationSeconds: panel.kind === 'digital-panel' ? panel.rotationSeconds : 0,
      });
    }
  } else {
    for (const column of layout.columns) {
      regions.push({
        id: `region:${column.panelId}`,
        panelId: column.panelId,
        index: column.index,
        title: column.title,
        emphasis: column.emphasis,
        kind: 'column',
        rect: column.rect,
        itemIds: column.itemIds,
        rotationSeconds: column.rotationSeconds,
      });
    }
  }
  const promo = layout.promo;
  if (promo) {
    regions.push({
      id: `region:${promo.id}`,
      panelId: promo.id,
      index: regions.length,
      title: promo.headline,
      emphasis: 'promo',
      kind: 'promo-strip',
      rect: promo.bounds,
      itemIds: Object.freeze([]),
      rotationSeconds: 0,
    });
  }
  return Object.freeze(regions);
}

/* -------------------------------------------------------------------------- */
/* Placement checks                                                          */
/* -------------------------------------------------------------------------- */

/** World box of the counter shell, which the board must clear. */
export function counterBox(layout: StructuralLayout): BoardBox {
  const counter = layout.counter;
  return {
    min: {
      x: counter.center.x - counter.width / 2,
      y: layout.floorHeight,
      z: counter.center.z - counter.depth / 2,
    },
    max: {
      x: counter.center.x + counter.width / 2,
      y: counter.surfaceHeight,
      z: counter.center.z + counter.depth / 2,
    },
  };
}

/** World box of a reserved opening (doorway, glazing bay, entrance). */
export function reservedZoneBox(zone: ReservedZone): BoardBox {
  const halfWidth = zone.width / 2;
  const halfHeight = zone.height / 2;
  const centreY = zone.sillHeight + halfHeight;
  if (zone.wall === 'back' || zone.wall === 'front') {
    return {
      min: { x: zone.position.x - halfWidth, y: centreY - halfHeight, z: zone.position.z - 0.1 },
      max: { x: zone.position.x + halfWidth, y: centreY + halfHeight, z: zone.position.z + 0.1 },
    };
  }
  return {
    min: { x: zone.position.x - 0.1, y: centreY - halfHeight, z: zone.position.z - halfWidth },
    max: { x: zone.position.x + 0.1, y: centreY + halfHeight, z: zone.position.z + halfWidth },
  };
}

/** True when two world boxes overlap (touching faces do not count). */
export function boxesOverlap(a: BoardBox, b: BoardBox): boolean {
  return (
    a.min.x < b.max.x &&
    b.min.x < a.max.x &&
    a.min.y < b.max.y &&
    b.min.y < a.max.y &&
    a.min.z < b.max.z &&
    b.min.z < a.max.z
  );
}

/** True when every component of a box is finite. */
export function boxIsFinite(box: BoardBox): boolean {
  return (
    Number.isFinite(box.min.x) &&
    Number.isFinite(box.min.y) &&
    Number.isFinite(box.min.z) &&
    Number.isFinite(box.max.x) &&
    Number.isFinite(box.max.y) &&
    Number.isFinite(box.max.z)
  );
}

/**
 * Everything that must hold for a placed board: finite transform, inside the
 * room, hung flat on a wall plane, and clear of the reserved openings and the
 * counter. Returns an empty list when the placement is sound.
 */
export function boardPlacementProblems(
  placement: BoardPlacement,
  layout: StructuralLayout,
  bounds: RoomBounds = layout.bounds,
): readonly string[] {
  const problems: string[] = [];
  const { position } = placement;
  if (
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y) ||
    !Number.isFinite(position.z) ||
    !Number.isFinite(placement.rotationY) ||
    !Number.isFinite(placement.tilt) ||
    !Number.isFinite(placement.width) ||
    !Number.isFinite(placement.height) ||
    !Number.isFinite(placement.depth)
  ) {
    problems.push('the board transform is not finite');
    return Object.freeze(problems);
  }
  if (!boxIsFinite(placement.box)) {
    problems.push('the board box is not finite');
    return Object.freeze(problems);
  }

  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  const epsilon = 1e-6;
  if (placement.box.min.x < -halfWidth - epsilon || placement.box.max.x > halfWidth + epsilon) {
    problems.push('the board crosses a side wall');
  }
  if (placement.box.min.z < -halfDepth - epsilon || placement.box.max.z > halfDepth + epsilon) {
    problems.push('the board crosses the storefront or the back wall');
  }
  if (placement.box.min.y < layout.floorHeight - epsilon) {
    problems.push('the board hangs below the floor');
  }
  if (placement.box.max.y > bounds.height + epsilon) {
    problems.push('the board hangs above the ceiling');
  }

  const wall = layout.walls.find((entry) => entry.id === placement.wall);
  if (wall) {
    const planeCoordinate = wall.runAxis === 'x' ? placement.position.z : placement.position.x;
    const wallPlane = wall.runAxis === 'x' ? wall.center.z : wall.center.x;
    const offset = placement.depth / 2;
    if (Math.abs(Math.abs(planeCoordinate - wallPlane) - offset) > 0.08) {
      problems.push(`the board is not hung on the ${placement.wall} wall plane`);
    }
  }

  const obstacles: readonly BoardBox[] = [
    reservedZoneBox(layout.doorway),
    reservedZoneBox(layout.entrance),
    ...layout.glazingZones.map((zone) => reservedZoneBox(zone)),
    counterBox(layout),
  ];
  for (const obstacle of obstacles) {
    if (boxesOverlap(placement.box, obstacle)) {
      problems.push('the board overlaps a reserved opening or the counter');
      break;
    }
  }
  return Object.freeze(problems);
}

/** Distance an inspection camera should keep from the board to frame it. */
export function boardFocusDistance(placement: BoardPlacement): number {
  return Math.max(placement.width, placement.height) * 1.35 + 0.45;
}
