/**
 * Pedestrian figure builder.
 *
 * Low-poly, shared-material figures whose outfit (torso/leg palette, silhouette,
 * headwear and period accessory) comes straight from the era's {@link OutfitSpec}.
 * Each figure exposes a {@link PedestrianRig} of named parts so the crowd sim can
 * drive a walk cycle without touching the era config.
 *
 * 1945 gets fedoras, overcoats and day-dresses; 1965 mod dresses and slim suits;
 * 1985 denim, leather and bell-bottoms; 2005 hoodies and flip phones; 2025
 * tech-wear with a phone held up in front, plus riders with helmets.
 */

import * as THREE from 'three';
import type { OutfitSpec } from '../config/types';
import type { PedestrianRig } from '../sim/crowds';
import type { WorldKit } from './textures';

export interface PedestrianBuild {
  rig: PedestrianRig;
  outfit: OutfitSpec;
}

const BODY_HEIGHT = 1.75;

function addAccessory(
  kit: WorldKit,
  rig: PedestrianRig,
  outfit: OutfitSpec,
  materials: { accent: THREE.Material; skin: THREE.Material; dark: THREE.Material },
): void {
  const head = rig.head;
  const scale = head.scale.x;
  switch (outfit.accessory) {
    case 'fedora':
    case 'hat': {
      const brim = new THREE.Mesh(kit.geometry.cylinder(0.17 * scale, 0.17 * scale, 0.02, 12), materials.accent);
      brim.position.y = 0.1 * scale;
      const crown = new THREE.Mesh(kit.geometry.cylinder(0.11 * scale, 0.11 * scale, 0.12 * scale, 12), materials.accent);
      crown.position.y = 0.16 * scale;
      head.add(brim, crown);
      break;
    }
    case 'pillbox-hat': {
      const cap = new THREE.Mesh(kit.geometry.cylinder(0.13 * scale, 0.13 * scale, 0.07 * scale, 12), materials.accent);
      cap.position.y = 0.13 * scale;
      head.add(cap);
      break;
    }
    case 'helmet': {
      const shell = new THREE.Mesh(kit.geometry.sphere(0.16 * scale, 12, 8), materials.accent);
      shell.position.y = 0.06 * scale;
      head.add(shell);
      break;
    }
    case 'hoodie': {
      const hood = new THREE.Mesh(kit.geometry.sphere(0.17 * scale, 10, 8), materials.accent);
      hood.scale.set(1, 0.8, 1);
      hood.position.set(0, -0.02 * scale, -0.08 * scale);
      head.add(hood);
      break;
    }
    default:
      break;
  }

  switch (outfit.accessory) {
    case 'phone': {
      const phone = new THREE.Mesh(kit.geometry.box(0.06, 0.12, 0.02), materials.dark);
      phone.position.set(0.16, BODY_HEIGHT * 0.63, 0.2);
      rig.rightArm.add(phone);
      break;
    }
    case 'backpack': {
      const bag = new THREE.Mesh(kit.geometry.box(0.28, 0.36, 0.16), materials.accent);
      bag.position.set(0, BODY_HEIGHT * 0.68, -0.16);
      rig.root.add(bag);
      break;
    }
    case 'sunglasses': {
      const glasses = new THREE.Mesh(kit.geometry.box(0.19 * scale, 0.04 * scale, 0.03), materials.dark);
      glasses.position.set(0, 0.03 * scale, 0.12 * scale);
      head.add(glasses);
      break;
    }
    case 'headband': {
      const band = new THREE.Mesh(kit.geometry.box(0.2 * scale, 0.035 * scale, 0.2 * scale), materials.accent);
      band.position.y = 0.08 * scale;
      head.add(band);
      break;
    }
    case 'scarf': {
      const scarf = new THREE.Mesh(kit.geometry.box(0.22, 0.09, 0.22), materials.accent);
      scarf.position.y = BODY_HEIGHT * 0.8;
      rig.root.add(scarf);
      break;
    }
    default:
      break;
  }
}

/** Build one pedestrian figure with an era outfit. */
export function createPedestrian(kit: WorldKit, outfit: OutfitSpec): PedestrianBuild {
  const [torso, legs, accent] = outfit.colors;
  const root = new THREE.Group();
  root.name = `pedestrian:${outfit.id}`;

  const torsoMaterial = kit.library.cloth(torso);
  const legMaterial = kit.library.cloth(legs);
  const accentMaterial = kit.library.cloth(accent);
  const skinMaterial = kit.library.skin(outfit.skin);
  const darkMaterial = kit.library.flat('#1e1f22', { roughness: 0.8 });

  const legLength = BODY_HEIGHT * (outfit.silhouette === 'fitted-dress' ? 0.6 : 0.48);
  const legWidth = outfit.silhouette === 'bell-bottom' ? 0.17 : 0.12;

  // Hips / torso.
  const hips = new THREE.Mesh(kit.geometry.box(0.32, 0.18, 0.2), legMaterial);
  hips.position.y = legLength + 0.06;
  hips.castShadow = true;
  root.add(hips);

  const chestHeight = BODY_HEIGHT * (outfit.silhouette === 'wide-lapel-suit' ? 0.32 : 0.3);
  const chestWidth = outfit.silhouette === 'wide-lapel-suit' ? 0.42 : 0.34;
  const chest = new THREE.Mesh(kit.geometry.box(chestWidth, chestHeight, 0.24), torsoMaterial);
  chest.position.y = legLength + 0.15 + chestHeight / 2;
  chest.castShadow = true;
  root.add(chest);

  // Shoulder pads / overcoat collar.
  if (outfit.silhouette === 'wide-lapel-suit' || outfit.accessory === 'shoulder-pads') {
    const pads = new THREE.Mesh(kit.geometry.box(chestWidth + 0.16, 0.1, 0.26), torsoMaterial);
    pads.position.y = legLength + 0.15 + chestHeight - 0.02;
    root.add(pads);
  }

  // Coat / dress skirt down to the hem line.
  if (outfit.silhouette === 'long-coat' || outfit.silhouette === 'fitted-dress' || outfit.silhouette === 'techwear') {
    const skirtLength = BODY_HEIGHT * outfit.hem * 0.55;
    const skirt = new THREE.Mesh(
      kit.geometry.cylinder(
        outfit.silhouette === 'fitted-dress' ? 0.16 : 0.2,
        outfit.silhouette === 'fitted-dress' ? 0.24 : 0.26,
        skirtLength,
        10,
      ),
      torsoMaterial,
    );
    // Hangs from the waist down past the knee.
    skirt.position.y = legLength + 0.2 - skirtLength / 2;
    root.add(skirt);
  }

  // Neck + head.
  const neck = new THREE.Mesh(kit.geometry.cylinder(0.05, 0.05, 0.08, 8), skinMaterial);
  neck.position.y = legLength + 0.15 + chestHeight + 0.03;
  const head = new THREE.Mesh(kit.geometry.sphere(0.115, 12, 10), skinMaterial);
  head.position.y = legLength + 0.15 + chestHeight + 0.16;
  head.castShadow = true;
  root.add(neck, head);

  // Legs (pivoting groups so the walk cycle can swing them).
  const legGeometry = kit.geometry.box(legWidth, legLength, 0.18);
  const leftLeg = new THREE.Group();
  leftLeg.position.set(-0.09, legLength, 0);
  const leftLegMesh = new THREE.Mesh(legGeometry, legMaterial);
  leftLegMesh.position.y = -legLength / 2;
  leftLegMesh.castShadow = true;
  leftLeg.add(leftLegMesh);
  const rightLeg = new THREE.Group();
  rightLeg.position.set(0.09, legLength, 0);
  const rightLegMesh = new THREE.Mesh(legGeometry, legMaterial);
  rightLegMesh.position.y = -legLength / 2;
  rightLegMesh.castShadow = true;
  rightLeg.add(rightLegMesh);
  root.add(leftLeg, rightLeg);

  // Arms.
  const armLength = BODY_HEIGHT * 0.3;
  const armGeometry = kit.geometry.box(0.09, armLength, 0.1);
  const leftArm = new THREE.Group();
  leftArm.position.set(-chestWidth / 2 - 0.05, legLength + 0.15 + chestHeight, 0);
  const leftArmMesh = new THREE.Mesh(armGeometry, torsoMaterial);
  leftArmMesh.position.y = -armLength / 2;
  leftArm.add(leftArmMesh);
  const rightArm = new THREE.Group();
  rightArm.position.set(chestWidth / 2 + 0.05, legLength + 0.15 + chestHeight, 0);
  const rightArmMesh = new THREE.Mesh(armGeometry, torsoMaterial);
  rightArmMesh.position.y = -armLength / 2;
  rightArm.add(rightArmMesh);
  root.add(leftArm, rightArm);

  // Shoes.
  const shoeGeometry = kit.geometry.box(0.14, 0.07, 0.26);
  for (const dx of [-0.09, 0.09]) {
    const shoe = new THREE.Mesh(shoeGeometry, darkMaterial);
    shoe.position.set(dx, 0.03, 0.04);
    root.add(shoe);
  }

  const rig: PedestrianRig = {
    root,
    head,
    torso: chest,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    height: BODY_HEIGHT,
    phase: 0,
    lean: outfit.silhouette === 'techwear' ? 0.12 : 0.03,
  };
  addAccessory(kit, rig, outfit, { accent: accentMaterial, skin: skinMaterial, dark: darkMaterial });

  root.userData.focus = { kind: 'pedestrian', label: outfit.label, id: outfit.id };

  return { rig, outfit };
}

/** Where a pedestrian starts: position on a sidewalk route plus its route index. */
export interface PedestrianAnchor {
  x: number;
  z: number;
  facing: number;
  routeIndex: number;
  distance: number;
}

export interface PedestriansBuild {
  group: THREE.Group;
  rigs: PedestrianBuild[];
  anchors: PedestrianAnchor[];
}

/**
 * Populate the sidewalks with `count` pedestrians walking the ring around the
 * block plus the two market strips along the streets.
 */
export function createPedestrians(kit: WorldKit, anchors: PedestrianAnchor[]): PedestriansBuild {
  const group = new THREE.Group();
  group.name = 'pedestrians';
  const rigs: PedestrianBuild[] = [];

  for (let i = 0; i < anchors.length; i += 1) {
    const outfit = kit.era.outfits[i % kit.era.outfits.length];
    const build = createPedestrian(kit, outfit);
    const anchor = anchors[i] ?? { x: 0, z: 0, facing: 0, routeIndex: 0, distance: 0 };
    build.rig.root.position.set(anchor.x, 0.22, anchor.z);
    build.rig.root.rotation.y = anchor.facing;
    build.rig.phase = kit.rng.range(0, Math.PI * 2);
    build.rig.speed = 1.05 * kit.era.crowdPace * kit.rng.range(0.85, 1.15);
    build.rig.role = 'walker';
    rigs.push(build);
    group.add(build.rig.root);
  }

  return { group, rigs, anchors };
}
