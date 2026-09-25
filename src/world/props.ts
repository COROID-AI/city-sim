/**
 * Street furniture generator.
 *
 * Every era dresses the kerb differently: incandescent globes and wooden
 * telegraph poles in 1945, swan-neck lamps and newsstands in 1965, sodium cobra
 * heads plus shelters in 1985, slim LED lamps and newspaper boxes in 2005, and
 * organic LED rings, bike racks and planters in 2025.
 *
 * Returns the placed records (for the "look at things" info cards), the category
 * list (asserted by the integration tests) and the manhole / traffic-light /
 * flag handles that the ambience animator drives.
 */

import * as THREE from 'three';
import { FRONTAGE, LAYOUT } from './roads';
import type { WorldKit } from './textures';

export interface PropRecord {
  group: THREE.Group;
  category: string;
  label: string;
  position: THREE.Vector3;
}

export interface TrafficLightRef {
  group: THREE.Group;
  axis: 'x' | 'z';
  lenses: Record<'red' | 'amber' | 'green', THREE.Mesh>;
}

export interface PropsBuild {
  group: THREE.Group;
  records: PropRecord[];
  /** Unique prop category ids present in this era. */
  categories: string[];
  manholes: THREE.Vector3[];
  trafficLights: TrafficLightRef[];
  flags: THREE.Object3D[];
}

type PropFactory = (
  kit: WorldKit,
  position: THREE.Vector3,
  rotationY: number,
) => { group: THREE.Group; label: string } | null;

const KERB_OFFSET = LAYOUT.streetHalfWidth + 0.9;

function createLamp(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  const style = kit.era.props.lampStyle;
  const metal = kit.library.metal('#4a4d52', 0.5);
  const glassy = kit.library.neon(kit.era.props.lampColor, 1.25);

  group.position.copy(position);
  group.rotation.y = rotationY;

  const poleHeight = style === 'sodium-cobra' ? 8.4 : style === 'swan-neck' ? 6.6 : style === 'incandescent-globe' ? 4.6 : 6.2;
  const pole = new THREE.Mesh(kit.geometry.cylinder(0.11, 0.16, poleHeight, 10), metal);
  pole.position.y = poleHeight / 2;
  pole.castShadow = true;
  group.add(pole);

  const base = new THREE.Mesh(kit.geometry.cylinder(0.3, 0.4, 0.5, 10), kit.library.flat('#3f4246', { roughness: 0.9 }));
  base.position.y = 0.25;
  group.add(base);

  let glow: THREE.Mesh;
  switch (style) {
    case 'incandescent-globe': {
      glow = new THREE.Mesh(kit.geometry.sphere(0.34, 12, 10), glassy);
      glow.position.y = poleHeight + 0.34;
      const cap = new THREE.Mesh(kit.geometry.cylinder(0.42, 0.14, 0.22, 10), metal);
      cap.position.y = poleHeight + 0.72;
      group.add(cap);
      break;
    }
    case 'swan-neck': {
      const arm = new THREE.Mesh(kit.geometry.cylinder(0.08, 0.08, 1.9, 8), metal);
      arm.rotation.z = Math.PI / 2.4;
      arm.position.set(-0.62, poleHeight + 0.42, 0);
      const shade = new THREE.Mesh(kit.geometry.cylinder(0.42, 0.18, 0.42, 12), metal);
      shade.position.set(-1.35, poleHeight + 0.05, 0);
      glow = new THREE.Mesh(kit.geometry.sphere(0.22, 10, 8), glassy);
      glow.position.set(-1.35, poleHeight - 0.2, 0);
      group.add(arm, shade);
      break;
    }
    case 'sodium-cobra': {
      const arm = new THREE.Mesh(kit.geometry.cylinder(0.09, 0.09, 3.1, 8), metal);
      arm.rotation.z = Math.PI / 2;
      arm.position.set(-1.55, poleHeight - 0.1, 0);
      const head = new THREE.Mesh(kit.geometry.box(1.15, 0.26, 0.46), metal);
      head.position.set(-3.05, poleHeight - 0.22, 0);
      glow = new THREE.Mesh(kit.geometry.box(0.9, 0.09, 0.34), glassy);
      glow.position.set(-3.05, poleHeight - 0.38, 0);
      group.add(arm, head);
      break;
    }
    case 'led-slim': {
      const arm = new THREE.Mesh(kit.geometry.box(0.09, 0.09, 2.4), metal);
      arm.position.set(0, poleHeight - 0.05, -1.2);
      const head = new THREE.Mesh(kit.geometry.box(0.32, 0.14, 1.5), metal);
      head.position.set(0, poleHeight - 0.16, -2.4);
      glow = new THREE.Mesh(kit.geometry.box(0.24, 0.06, 1.3), glassy);
      glow.position.set(0, poleHeight - 0.26, -2.4);
      group.add(arm, head);
      break;
    }
    default: {
      // led-organic: a glowing ring on a short bracket.
      const arm = new THREE.Mesh(kit.geometry.box(0.09, 0.09, 1.1), metal);
      arm.position.set(0, poleHeight - 0.05, -0.55);
      glow = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 18), glassy);
      glow.rotation.x = Math.PI / 2;
      glow.position.set(0, poleHeight - 0.3, -1.1);
      group.add(arm);
      break;
    }
  }

  glow.castShadow = false;
  group.add(glow);
  group.userData.focus = { kind: 'prop', label: `${style.replace(/-/g, ' ')} street lamp`, id: `lamp:${position.x}:${position.z}` };
  return { group, label: `${style.replace(/-/g, ' ')} street lamp` };
}

function createTrafficLight(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string; ref: TrafficLightRef } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const metal = kit.library.metal('#3f5a3f', 0.45);
  const pole = new THREE.Mesh(kit.geometry.cylinder(0.12, 0.16, 6.4, 10), metal);
  pole.position.y = 3.2;
  pole.castShadow = true;
  const arm = new THREE.Mesh(kit.geometry.cylinder(0.09, 0.09, 2.6, 8), metal);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-1.3, 6.2, 0);
  const housing = new THREE.Mesh(kit.geometry.box(0.5, 1.5, 0.42), kit.library.flat('#2c2f2c', { roughness: 0.8 }));
  housing.position.set(-2.5, 5.6, 0);
  group.add(pole, arm, housing);

  const lensGeometry = kit.geometry.sphere(0.16, 10, 8);
  const red = new THREE.Mesh(lensGeometry, kit.library.neon('#ff2f2f', 0.4));
  red.position.set(-2.5, 6.15, 0.24);
  const amber = new THREE.Mesh(lensGeometry, kit.library.neon('#ffa32f', 0.2));
  amber.position.set(-2.5, 5.6, 0.24);
  const green = new THREE.Mesh(lensGeometry, kit.library.neon('#3fff7a', 0.2));
  green.position.set(-2.5, 5.05, 0.24);
  group.add(red, amber, green);

  const pedestrianBox = new THREE.Mesh(kit.geometry.box(0.4, 0.6, 0.3), kit.library.flat('#2c2f2c', { roughness: 0.8 }));
  pedestrianBox.position.set(-0.5, 3.6, 0.2);
  group.add(pedestrianBox);

  const label = 'signalised intersection';
  group.userData.focus = { kind: 'prop', label, id: `traffic-light:${position.x}:${position.z}` };
  return {
    group,
    label,
    ref: { group, axis: Math.abs(position.x) > Math.abs(position.z) ? 'z' : 'x', lenses: { red, amber, green } },
  };
}

function createHydrant(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const material = kit.library.flat(kit.era.props.hydrantColor, { roughness: 0.6, metalness: 0.2 });
  const body = new THREE.Mesh(kit.geometry.cylinder(0.16, 0.2, 0.75, 10), material);
  body.position.y = 0.38;
  body.castShadow = true;
  const cap = new THREE.Mesh(kit.geometry.cylinder(0.1, 0.16, 0.22, 10), material);
  cap.position.y = 0.86;
  const nub = new THREE.Mesh(kit.geometry.box(0.5, 0.14, 0.14), material);
  nub.position.y = 0.6;
  group.add(body, cap, nub);
  const label = 'fire hydrant';
  group.userData.focus = { kind: 'prop', label, id: `hydrant:${position.x}:${position.z}` };
  return { group, label };
}

function createBench(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const slat = kit.library.flat('#6f5a3f', { roughness: 0.9 });
  const frame = kit.library.metal('#3a3d40', 0.5);
  for (let i = 0; i < 3; i += 1) {
    const board = new THREE.Mesh(kit.geometry.box(1.9, 0.08, 0.16), slat);
    board.position.set(0, 0.45, -0.2 + i * 0.2);
    board.castShadow = true;
    group.add(board);
  }
  for (let i = 0; i < 3; i += 1) {
    const back = new THREE.Mesh(kit.geometry.box(1.9, 0.16, 0.07), slat);
    back.position.set(0, 0.62 + i * 0.2, -0.28);
    group.add(back);
  }
  for (const x of [-0.78, 0.78]) {
    const leg = new THREE.Mesh(kit.geometry.box(0.1, 0.45, 0.5), frame);
    leg.position.set(x, 0.22, 0);
    group.add(leg);
  }
  const label = 'park bench';
  group.userData.focus = { kind: 'prop', label, id: `bench:${position.x}:${position.z}` };
  return { group, label };
}

function createBin(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const modern = kit.era.year >= 1985;
  const material = modern ? kit.library.metal('#4f5459', 0.45) : kit.library.wall('#4a4f42', 'brick', [1, 1]);
  const body = new THREE.Mesh(kit.geometry.cylinder(0.34, 0.3, 0.95, 12), material);
  body.position.y = 0.48;
  body.castShadow = true;
  const lid = new THREE.Mesh(kit.geometry.cylinder(0.36, 0.36, 0.1, 12), modern ? material : kit.library.flat('#3f4236', { roughness: 0.9 }));
  lid.position.y = 1;
  group.add(body, lid);
  const label = modern ? 'steel litter bin' : 'ash can';
  group.userData.focus = { kind: 'prop', label, id: `bin:${position.x}:${position.z}` };
  return { group, label };
}

function createMailbox(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const material = kit.library.flat(kit.era.year <= 1965 ? '#2f4a6f' : '#3f5a7a', { roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(kit.geometry.box(0.62, 1.05, 0.5), material);
  body.position.y = 0.95;
  body.castShadow = true;
  const dome = new THREE.Mesh(kit.geometry.cylinder(0.31, 0.31, 0.5, 10), material);
  dome.rotation.z = Math.PI / 2;
  dome.position.y = 1.45;
  const post = new THREE.Mesh(kit.geometry.box(0.12, 0.6, 0.12), kit.library.metal('#3a3d40', 0.5));
  post.position.y = 0.3;
  group.add(body, dome, post);
  const label = 'post box';
  group.userData.focus = { kind: 'prop', label, id: `mailbox:${position.x}:${position.z}` };
  return { group, label };
}

function createNewsstand(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const wood = kit.library.flat('#6a543c', { roughness: 0.92 });
  const roof = kit.library.flat('#3f4a3a', { roughness: 0.85 });
  const body = new THREE.Mesh(kit.geometry.box(2.6, 1.5, 1.4), wood);
  body.position.y = 0.85;
  body.castShadow = true;
  const canopy = new THREE.Mesh(kit.geometry.box(3, 0.12, 2), roof);
  canopy.position.y = 1.75;
  group.add(body, canopy);
  for (let i = 0; i < 3; i += 1) {
    const stack = new THREE.Mesh(kit.geometry.box(0.5, 0.1, 0.4), kit.library.flat('#d9d2bd', { roughness: 0.9 }));
    stack.position.set(-0.8 + i * 0.8, 1.62, 0.4);
    group.add(stack);
  }
  const label = 'newsstand';
  group.userData.focus = { kind: 'prop', label, id: `newsstand:${position.x}:${position.z}` };
  return { group, label };
}

function createNewspaperBox(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const colors = ['#b03a2f', '#2f5ab0', '#c9a52f'];
  for (let i = 0; i < 3; i += 1) {
    const box = new THREE.Mesh(
      kit.geometry.box(0.42, 0.72, 0.36),
      kit.library.flat(colors[i % colors.length], { roughness: 0.6, metalness: 0.2 }),
    );
    box.position.set(-0.5 + i * 0.5, 0.36, 0);
    box.castShadow = true;
    group.add(box);
  }
  const label = 'newspaper boxes';
  group.userData.focus = { kind: 'prop', label, id: `newspaper-box:${position.x}:${position.z}` };
  return { group, label };
}

function createBusShelter(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const metal = kit.library.metal('#8f959b', 0.35);
  const glass = kit.library.glass('#a8c4d4', 0.35);
  const roof = new THREE.Mesh(kit.geometry.box(4.2, 0.16, 1.8), metal);
  roof.position.y = 2.6;
  roof.castShadow = true;
  const back = new THREE.Mesh(kit.geometry.box(4, 2.4, 0.08), glass);
  back.position.set(0, 1.3, -0.85);
  const bench = new THREE.Mesh(kit.geometry.box(3.2, 0.12, 0.45), metal);
  bench.position.set(0, 0.55, -0.55);
  group.add(roof, back, bench);
  for (const x of [-2, 2]) {
    const post = new THREE.Mesh(kit.geometry.box(0.12, 2.6, 0.12), metal);
    post.position.set(x, 1.3, -0.85);
    group.add(post);
  }
  const label = 'bus shelter';
  group.userData.focus = { kind: 'prop', label, id: `bus-stop:${position.x}:${position.z}` };
  return { group, label };
}

function createBikeRack(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const metal = kit.library.metal(kit.era.year >= 2025 ? '#2f6f5a' : '#6f7479', 0.35);
  for (let i = 0; i < 4; i += 1) {
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.045, 6, 14, Math.PI), metal);
    hoop.position.set(-1 + i * 0.68, 0.34, 0);
    group.add(hoop);
  }
  const rail = new THREE.Mesh(kit.geometry.box(2.8, 0.07, 0.07), metal);
  rail.position.y = 0.06;
  group.add(rail);
  const label = 'bike rack';
  group.userData.focus = { kind: 'prop', label, id: `bike-rack:${position.x}:${position.z}` };
  return { group, label };
}

function createPlanter(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const concrete = kit.library.surface('#8a877c', 'sidewalk', [1, 1]);
  const soil = kit.library.flat('#3f4a34', { roughness: 1 });
  const foliage = kit.library.flat(kit.era.year >= 2025 ? '#4f8f5a' : '#4a7a48', { roughness: 1, flatShading: true });
  const box = new THREE.Mesh(kit.geometry.box(1.3, 0.62, 0.9), concrete);
  box.position.y = 0.31;
  box.castShadow = true;
  const dirt = new THREE.Mesh(kit.geometry.box(1.16, 0.06, 0.78), soil);
  dirt.position.y = 0.64;
  group.add(box, dirt);
  for (let i = 0; i < 3; i += 1) {
    const bush = new THREE.Mesh(kit.geometry.sphere(0.28, 8, 6), foliage);
    bush.position.set(-0.4 + i * 0.4, 0.82, kit.rng.jitter(0.16));
    group.add(bush);
  }
  const label = 'planter';
  group.userData.focus = { kind: 'prop', label, id: `planter:${position.x}:${position.z}` };
  return { group, label };
}

function createManhole(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const cover = new THREE.Mesh(kit.geometry.cylinder(0.55, 0.55, 0.08, 12), kit.library.metal('#4a4d52', 0.55));
  cover.position.y = 0.04;
  cover.receiveShadow = true;
  group.add(cover);
  const label = 'manhole cover';
  group.userData.focus = { kind: 'prop', label, id: `manhole:${position.x}:${position.z}` };
  return { group, label };
}

function createTelephonePole(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const wood = kit.library.flat('#5f4a34', { roughness: 0.95 });
  const poleHeight = 9.5;
  const pole = new THREE.Mesh(kit.geometry.cylinder(0.16, 0.22, poleHeight, 8), wood);
  pole.position.y = poleHeight / 2;
  pole.castShadow = true;
  group.add(pole);
  for (const y of [poleHeight - 0.6, poleHeight - 1.5]) {
    const cross = new THREE.Mesh(kit.geometry.box(2.6, 0.12, 0.12), wood);
    cross.position.y = y;
    group.add(cross);
    for (const x of [-1.1, -0.4, 0.4, 1.1]) {
      const insulator = new THREE.Mesh(kit.geometry.cylinder(0.05, 0.05, 0.16, 6), kit.library.flat('#7f8a7a', { roughness: 0.4 }));
      insulator.position.set(x, y + 0.14, 0);
      group.add(insulator);
    }
  }
  const label = 'telegraph pole';
  group.userData.focus = { kind: 'prop', label, id: `telephone-pole:${position.x}:${position.z}` };
  return { group, label };
}

function createBarrier(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const wood = kit.library.flat('#c9a52f', { roughness: 0.85 });
  const plank = new THREE.Mesh(kit.geometry.box(2.4, 0.24, 0.1), wood);
  plank.position.y = 0.95;
  const plank2 = new THREE.Mesh(kit.geometry.box(2.4, 0.24, 0.1), wood);
  plank2.position.y = 0.6;
  group.add(plank, plank2);
  for (const x of [-0.9, 0.9]) {
    const leg = new THREE.Mesh(kit.geometry.box(0.12, 1.1, 0.12), wood);
    leg.position.set(x, 0.55, 0);
    group.add(leg);
  }
  const label = 'works barrier';
  group.userData.focus = { kind: 'prop', label, id: `barrier:${position.x}:${position.z}` };
  return { group, label };
}

function createStreetSign(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const metal = kit.library.metal('#6f7479', 0.4);
  const pole = new THREE.Mesh(kit.geometry.cylinder(0.05, 0.06, 3.2, 8), metal);
  pole.position.y = 1.6;
  group.add(pole);
  const plate = new THREE.Mesh(kit.geometry.box(1.5, 0.3, 0.05), kit.library.flat('#e6e6dd', { roughness: 0.5 }));
  plate.position.y = 3.1;
  const plate2 = new THREE.Mesh(kit.geometry.box(1.1, 0.28, 0.05), kit.library.flat(kit.era.year >= 2025 ? '#2f6f5a' : '#2f5a8a', { roughness: 0.5 }));
  plate2.position.y = 2.76;
  group.add(plate, plate2);
  const label = 'street name sign';
  group.userData.focus = { kind: 'prop', label, id: `street-sign:${position.x}:${position.z}` };
  return { group, label };
}

function createFlag(kit: WorldKit, position: THREE.Vector3, rotationY: number): { group: THREE.Group; label: string } {
  const group = new THREE.Group();
  group.position.copy(position);
  group.rotation.y = rotationY;
  const metal = kit.library.metal('#8f959b', 0.4);
  const pole = new THREE.Mesh(kit.geometry.cylinder(0.04, 0.05, 3.4, 8), metal);
  pole.position.y = 1.7;
  group.add(pole);
  const cloth = kit.library.flat(
    kit.era.year <= 1945 ? '#a8322f' : kit.era.year <= 1985 ? '#2f4a8a' : '#2f8a7a',
    { roughness: 1, side: THREE.DoubleSide },
  );
  const flag = new THREE.Mesh(kit.geometry.box(1.3, 0.7, 0.02), cloth);
  flag.position.set(0.68, 3.05, 0);
  flag.name = 'flag-cloth';
  group.add(flag);
  const label = 'street banner';
  group.userData.focus = { kind: 'prop', label, id: `flag:${position.x}:${position.z}` };
  return { group, label };
}

interface PropPlan {
  category: string;
  count: number;
  spacingBias?: number;
  factory: PropFactory;
  /** Place along the kerb (true) or at the intersection corners (false). */
  kerb: boolean;
  enabled: boolean;
}

export function createProps(kit: WorldKit): PropsBuild {
  const group = new THREE.Group();
  group.name = 'props';
  const records: PropRecord[] = [];
  const manholes: THREE.Vector3[] = [];
  const trafficLights: TrafficLightRef[] = [];
  const flags: THREE.Object3D[] = [];
  const era = kit.era;

  // ---- Signalised intersection corners -------------------------------------
  const corners: Array<[number, number]> = [
    [-KERB_OFFSET - 1.2, -KERB_OFFSET - 1.2],
    [KERB_OFFSET + 1.2, -KERB_OFFSET - 1.2],
    [-KERB_OFFSET - 1.2, KERB_OFFSET + 1.2],
    [KERB_OFFSET + 1.2, KERB_OFFSET + 1.2],
  ];
  for (const [x, z] of corners) {
    const rotationY = Math.atan2(-x, -z);
    const built = createTrafficLight(kit, new THREE.Vector3(x, LAYOUT.sidewalkY, z), rotationY);
    group.add(built.group);
    trafficLights.push(built.ref);
    records.push({
      group: built.group,
      category: 'traffic-light',
      label: built.label,
      position: built.group.position.clone(),
    });
  }

  // ---- Kerbside furniture --------------------------------------------------
  const plans: PropPlan[] = [
    { category: 'lamp', count: 18, factory: createLamp, kerb: true, enabled: true },
    { category: 'hydrant', count: 4, factory: createHydrant, kerb: true, enabled: true },
    { category: 'bin', count: 8, factory: createBin, kerb: true, enabled: true },
    { category: 'mailbox', count: 3, factory: createMailbox, kerb: true, enabled: true },
    { category: 'manhole', count: 10, factory: createManhole, kerb: true, enabled: true },
    { category: 'bench', count: era.props.benches, factory: createBench, kerb: true, enabled: true },
    { category: 'planter', count: era.props.planters, factory: createPlanter, kerb: true, enabled: true },
    { category: 'street-sign', count: 6, factory: createStreetSign, kerb: true, enabled: true },
    { category: 'barrier', count: 4, factory: createBarrier, kerb: true, enabled: true },
    { category: 'flag', count: 6, factory: createFlag, kerb: true, enabled: true },
    { category: 'newsstand', count: 3, factory: createNewsstand, kerb: true, enabled: era.props.newsstands },
    {
      category: 'newspaper-box',
      count: 5,
      factory: createNewspaperBox,
      kerb: true,
      enabled: era.props.newspaperBoxes,
    },
    { category: 'bus-stop', count: 3, factory: createBusShelter, kerb: true, enabled: era.props.busStopShelter },
    {
      category: 'telephone-pole',
      count: 7,
      factory: createTelephonePole,
      kerb: true,
      enabled: era.props.telephonePoles,
    },
    {
      category: 'bike-rack',
      count: era.props.bikeLane ? 6 : era.year >= 2005 ? 3 : 0,
      factory: createBikeRack,
      kerb: true,
      enabled: era.props.bikeLane || era.year >= 2005,
    },
  ];

  let slot = 0;
  for (const plan of plans) {
    if (!plan.enabled || plan.count <= 0) continue;
    for (let i = 0; i < plan.count; i += 1) {
      // Walk the inner kerb line: four sides of the ring, evenly spaced.
      const perimeter = 4 * 72;
      const along = ((slot * 137.508 + i * (perimeter / Math.max(1, plan.count))) % perimeter) + kit.rng.range(-1.5, 1.5);
      const side = Math.floor(along / 72) % 4;
      const local = along % 72;
      const coord = FRONTAGE + LAYOUT.sidewalkWidth - 1.1;
      let x = 0;
      let z = 0;
      if (side === 0) {
        x = -coord;
        z = -72 + local;
      } else if (side === 1) {
        x = -72 + local;
        z = coord;
      } else if (side === 2) {
        x = coord;
        z = 72 - local;
      } else {
        x = 72 - local;
        z = -coord;
      }
      if (Math.abs(x) < 16 && Math.abs(z) < 16) continue; // keep the crossing clear
      const position = new THREE.Vector3(x, LAYOUT.sidewalkY, z);
      const rotationY = Math.atan2(-x, -z);
      const built = plan.factory(kit, position, rotationY);
      if (!built) continue;
      group.add(built.group);
      records.push({ group: built.group, category: plan.category, label: built.label, position });
      if (plan.category === 'manhole') manholes.push(position.clone());
      if (plan.category === 'flag') {
        const cloth = built.group.getObjectByName('flag-cloth');
        if (cloth) flags.push(cloth);
      }
    }
    slot += 1;
  }

  const categories = Array.from(new Set(records.map((record) => record.category)));

  return { group, records, categories, manholes, trafficLights, flags };
}
