/**
 * Shared rig geometry and pose computation for the pedestrians module.
 *
 * Pedestrians are built from a small set of shared primitive parts (legs,
 * torso, arms, head, hair, hat, accessory). Each part is a merged set of
 * boxes whose geometry is built once per outfit variant (so silhouettes such
 * as shoulder pads or shift dresses differ), then instanced across the
 * crowd. Per-frame we only update instance matrices, which keeps the crowd
 * cheap.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { OutfitVariant, PartKey } from './outfits';

/** Base body proportions (world units). */
export const HIP_Y = 0.52;
const TORSO_H = 0.46;
const LEG_H = 0.52;
const ARM_H = 0.5;
const HEAD_SIZE = 0.27;

function box(
  w: number,
  h: number,
  d: number,
  tx = 0,
  ty = 0,
  tz = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(tx, ty, tz);
  return g;
}

function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(geoms);
  if (!m) throw new Error('mergeGeometries returned null');
  return m;
}

/** Build the geometry for a single rig part given an outfit variant. */
export function buildPartGeometry(
  variant: OutfitVariant,
  part: PartKey,
): THREE.BufferGeometry {
  const torsoW = 0.42 * variant.torsoWidth;
  const torsoH = TORSO_H * variant.torsoHeight;
  const legH = LEG_H * variant.legLength;

  switch (part) {
    case 'leftLeg':
    case 'rightLeg': {
      // Pivot at the top (hip). Leg extends downward; a shoe box is merged at the foot.
      const leg = box(0.17, legH, 0.2, 0, -legH / 2, 0);
      const shoe = box(0.18, 0.05, 0.24, 0, -legH - 0.02, 0.03);
      return merge([leg, shoe]);
    }
    case 'torso': {
      // Pivot at the bottom (hip). Box extends upward.
      const geoms: THREE.BufferGeometry[] = [
        box(torsoW, torsoH, 0.26, 0, torsoH / 2, 0),
      ];
      if (variant.shoulderPads) {
        const padW = 0.1;
        const padY = torsoH - 0.05;
        geoms.push(
          box(padW, 0.12, 0.22, -torsoW / 2 - padW / 2 + 0.02, padY, 0),
        );
        geoms.push(
          box(padW, 0.12, 0.22, torsoW / 2 + padW / 2 - 0.02, padY, 0),
        );
      }
      return merge(geoms);
    }
    case 'leftArm':
    case 'rightArm': {
      // Pivot at the top (shoulder). Arm extends downward.
      return box(0.13, ARM_H, 0.15, 0, -ARM_H / 2, 0);
    }
    case 'head':
      return box(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE);
    case 'hair':
      return buildHair(variant.hair);
    case 'hat':
      return buildHat(variant.hat);
    case 'accessory':
      return buildAccessory(variant.accessory);
    default:
      return box(0.1, 0.1, 0.1);
  }
}

function buildHair(style: string): THREE.BufferGeometry {
  switch (style) {
    case 'big':
      // 1985 big hair — tall and wide.
      return box(0.44, 0.34, 0.44, 0, 0.17, 0);
    case 'bob':
      return box(0.33, 0.22, 0.31, 0, 0.11, 0);
    case 'long':
      return box(0.3, 0.4, 0.28, 0, 0.2, 0);
    case 'ponytail':
      return merge([
        box(0.28, 0.1, 0.28, 0, 0.05, 0),
        box(0.15, 0.3, 0.15, 0, 0.18, -0.14),
      ]);
    case 'flat':
      return box(0.3, 0.07, 0.3, 0, 0.035, 0);
    case 'short':
    default:
      return box(0.3, 0.1, 0.3, 0, 0.05, 0);
  }
}

function buildHat(style: string): THREE.BufferGeometry {
  switch (style) {
    case 'fedora':
      return merge([
        box(0.34, 0.16, 0.34, 0, 0.08, 0),
        box(0.52, 0.03, 0.52, 0, -0.01, 0),
      ]);
    case 'pillbox':
      return box(0.34, 0.1, 0.34, 0, 0.05, 0);
    case 'flatcap':
      return merge([
        box(0.36, 0.06, 0.34, 0, 0.03, 0),
        box(0.36, 0.05, 0.1, 0, 0.02, 0.12),
      ]);
    case 'cap':
      return merge([
        box(0.34, 0.1, 0.34, 0, 0.05, 0),
        box(0.34, 0.03, 0.16, 0, 0.01, 0.17),
      ]);
    case 'widebrim':
      return merge([
        box(0.55, 0.04, 0.55, 0, 0.02, 0),
        box(0.3, 0.1, 0.3, 0, 0.08, 0),
      ]);
    case 'none':
    default:
      return box(0.01, 0.01, 0.01); // empty placeholder
  }
}

function buildAccessory(style: string): THREE.BufferGeometry {
  switch (style) {
    case 'handbag':
      return box(0.18, 0.14, 0.06);
    case 'briefcase':
      return box(0.22, 0.16, 0.08);
    case 'camera':
      return box(0.12, 0.08, 0.1);
    case 'phone':
    case 'flip':
      return box(0.05, 0.09, 0.02);
    case 'smartphone':
      return box(0.06, 0.11, 0.02);
    case 'earbuds':
      return merge([
        box(0.05, 0.05, 0.05, 0.16, 0, 0),
        box(0.05, 0.05, 0.05, -0.16, 0, 0),
      ]);
    case 'mask':
      return box(0.2, 0.06, 0.02);
    case 'coffee':
      return box(0.07, 0.12, 0.07);
    case 'none':
    default:
      return box(0.01, 0.01, 0.01);
  }
}

export interface PoseContext {
  /** Gait swing factor in [-1, 1] (0 when idle / standing). */
  gait: number;
  /** Vertical bob offset applied to the upper body. */
  bob: number;
  variant: OutfitVariant;
}

/** Which parts a variant actually renders. */
export function variantParts(variant: OutfitVariant): PartKey[] {
  const parts: PartKey[] = [
    'leftLeg',
    'rightLeg',
    'torso',
    'leftArm',
    'rightArm',
    'head',
    'hair',
  ];
  if (variant.hat !== 'none') parts.push('hat');
  if (variant.accessory !== 'none') parts.push('accessory');
  return parts;
}

export interface PartTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

// Shared scratch buffers so the per-frame rig evaluation allocates nothing.
const POS: [number, number, number] = [0, 0, 0];
const ROT: [number, number, number] = [0, 0, 0];
const SCL: [number, number, number] = [1, 1, 1];
const TRANSFORM: PartTransform = { position: POS, rotation: ROT, scale: SCL };

function setTransform(
  position: [number, number, number],
  rotation: [number, number, number],
): PartTransform {
  POS[0] = position[0];
  POS[1] = position[1];
  POS[2] = position[2];
  ROT[0] = rotation[0];
  ROT[1] = rotation[1];
  ROT[2] = rotation[2];
  return TRANSFORM;
}

/** Compute the local transform of a part for a given pose. */
export function computePartLocal(
  part: PartKey,
  ctx: PoseContext,
): PartTransform {
  const { variant, gait, bob } = ctx;
  const torsoH = TORSO_H * variant.torsoHeight;
  const shoulderY = HIP_Y + torsoH;
  const headY = shoulderY + 0.16;
  const headTop = headY + HEAD_SIZE / 2;

  const bobY = bob;

  switch (part) {
    case 'leftLeg':
      return setTransform([-0.1, HIP_Y, 0], [gait, 0, 0]);
    case 'rightLeg':
      return setTransform([0.1, HIP_Y, 0], [-gait, 0, 0]);
    case 'torso':
      return setTransform([0, HIP_Y, 0], [gait === 0 ? 0 : -0.04, 0, 0]);
    case 'leftArm':
      return setTransform([-0.28, shoulderY + bobY, 0], [-gait * 0.8, 0, 0]);
    case 'rightArm':
      return setTransform([0.28, shoulderY + bobY, 0], [gait * 0.8, 0, 0]);
    case 'head':
      return setTransform([0, headY + bobY, 0], [0, 0, 0]);
    case 'hair':
      return setTransform([0, headTop + bobY, 0], [0, 0, 0]);
    case 'hat': {
      const hairH = hairHeight(variant.hair);
      return setTransform([0, headTop + hairH + bobY, 0], [0, 0, 0]);
    }
    case 'accessory':
      return accessoryLocal(variant.accessory, shoulderY, headY, bobY);
    default:
      return setTransform([0, 0, 0], [0, 0, 0]);
  }
}

function accessoryLocal(
  type: string,
  shoulderY: number,
  headY: number,
  bobY: number,
): PartTransform {
  switch (type) {
    case 'handbag':
    case 'briefcase':
      return setTransform([0.3, shoulderY - 0.32 + bobY, 0.1], [0, 0, 0]);
    case 'camera':
      return setTransform([0, shoulderY - 0.12 + bobY, 0.18], [0, 0, 0]);
    case 'phone':
    case 'flip':
    case 'smartphone':
    case 'coffee':
      return setTransform([0.3, shoulderY - 0.34 + bobY, 0.08], [0, 0, 0]);
    case 'earbuds':
      return setTransform([0, headY + bobY, 0], [0, 0, 0]);
    case 'mask':
      return setTransform([0, headY - 0.04 + bobY, 0.14], [0, 0, 0]);
    default:
      return setTransform([0, 0, 0], [0, 0, 0]);
  }
}

function hairHeight(style: string): number {
  switch (style) {
    case 'big':
      return 0.34;
    case 'bob':
      return 0.22;
    case 'long':
      return 0.4;
    case 'ponytail':
      return 0.1;
    case 'flat':
      return 0.07;
    case 'short':
    default:
      return 0.1;
  }
}
