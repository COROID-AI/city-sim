/**
 * 1945 prop builder — the manual till: lever drawer, cash box, bell, coin tray,
 * docket pad, pencil, day ledger, hand-lettered price card and tip jar.
 *
 * Every prop is built inside the placement box the plan resolved (the group's
 * local origin is the box centre, so the parts are described relative to it),
 * dressed in the era's material set and finished with the printed marks of the
 * period. The builder also hands the module the two animated parts of this era:
 * the drawer that eases back on its runners and the bell that rocks while it is
 * open.
 */

import * as THREE from 'three';
import {
  counterBoxMesh,
  counterCylinderMesh,
  counterFaceMesh,
  counterMaterial,
  type CounterMaterialSet,
} from '../textures/labels';
import { createSeededRandom } from '../../../core/kernel';
import type {
  CounterDeviceBuildInput,
  CounterDeviceBuildResult,
  CounterDeviceBuilder,
  PlacedCounterProp,
} from '../CounterTechModule';

function countMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

function group(name: string): THREE.Group {
  const node = new THREE.Group();
  node.name = name;
  return node;
}

/** Brass drawer pull with its two posts. */
function buildDrawerPull(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const bar = counterCylinderMesh(set, entry.material, {
    radius: y * 0.42,
    height: x,
    radialSegments: 8,
    position: [0, 0, z * 0.5],
    rotation: [0, 0, Math.PI / 2],
  });
  bar.name = `counter-${entry.id}-bar`;
  node.add(bar);
  const postGeometry = new THREE.CylinderGeometry(y * 0.3, y * 0.3, z * 0.5, 6);
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeometry, counterMaterial(set, entry.trim ?? 'brass'));
    post.name = `counter-${entry.id}-post-${side < 0 ? 'left' : 'right'}`;
    post.rotation.x = Math.PI / 2;
    post.position.set(side * x * 0.34, 0, z * 0.25);
    node.add(post);
  }
  return node;
}

/** Oak drawer with a felt liner, a keyhole and its brass lever. */
function buildCashDrawer(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const body = counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`);
  node.add(body);
  const liner = counterBoxMesh(set, entry.trim ?? 'felt', [x * 0.86, 0.008, z * 0.76], `counter-${entry.id}-liner`, {
    position: [0, y / 2 - 0.002, 0],
  });
  node.add(liner);
  const dividerGeometry = new THREE.BoxGeometry(0.006, y * 0.5, z * 0.72);
  for (const side of [-1, 1]) {
    const divider = new THREE.Mesh(dividerGeometry, counterMaterial(set, 'wood'));
    divider.name = `counter-${entry.id}-divider-${side < 0 ? 'coins' : 'notes'}`;
    divider.position.set(side * x * 0.18, y * 0.22, 0);
    node.add(divider);
  }
  const keyhole = counterCylinderMesh(set, entry.trim ?? 'brass', {
    radius: 0.008,
    height: 0.006,
    radialSegments: 10,
    position: [0, 0, z / 2 + 0.002],
    rotation: [Math.PI / 2, 0, 0],
  });
  keyhole.name = `counter-${entry.id}-keyhole`;
  node.add(keyhole);
  return node;
}

/** The clamped cash box: body, printed brass plate, wells and a keyhole. */
function buildTillBody(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const body = counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`);
  node.add(body);
  const plate = counterFaceMesh(set, 'label', [x * 0.62, y * 0.42], `counter-${entry.id}-plate`, {
    position: [0, 0, z / 2 + 0.001],
  });
  node.add(plate);
  const wellGeometry = new THREE.BoxGeometry(x * 0.3, y * 0.5, z * 0.7);
  for (const side of [-1, 1]) {
    const well = new THREE.Mesh(wellGeometry, counterMaterial(set, 'wood'));
    well.name = `counter-${entry.id}-well-${side < 0 ? 'coin' : 'note'}`;
    well.position.set(side * x * 0.22, -y * 0.1, 0);
    node.add(well);
  }
  const keyhole = counterCylinderMesh(set, entry.trim ?? 'brass', {
    radius: 0.006,
    height: 0.005,
    radialSegments: 10,
    position: [-x * 0.3, 0, z / 2 + 0.002],
    rotation: [Math.PI / 2, 0, 0],
  });
  keyhole.name = `counter-${entry.id}-keyhole`;
  node.add(keyhole);
  return node;
}

/** Hinged lid with a brass knob and a felt underside. */
function buildTillLid(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const body = counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`);
  node.add(body);
  const hinge = counterBoxMesh(set, 'brass', [x * 0.7, 0.006, 0.006], `counter-${entry.id}-hinge`, {
    position: [0, 0, -z / 2 - 0.003],
  });
  node.add(hinge);
  const knob = counterCylinderMesh(set, 'brass', {
    radius: 0.012,
    height: 0.012,
    radialSegments: 10,
    position: [x * 0.32, y / 2 + 0.006, z * 0.2],
  });
  knob.name = `counter-${entry.id}-knob`;
  node.add(knob);
  const underside = counterBoxMesh(set, entry.trim ?? 'felt', [x * 0.9, 0.004, z * 0.9], `counter-${entry.id}-felt`, {
    position: [0, -y / 2 - 0.001, 0],
  });
  node.add(underside);
  return node;
}

/** Brass lever on the till's right cheek. */
function buildTillLever(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const boss = counterCylinderMesh(set, 'brass', {
    radius: x * 0.9,
    height: 0.02,
    radialSegments: 10,
    rotation: [0, 0, Math.PI / 2],
    position: [-x * 0.6, 0, 0],
  });
  boss.name = `counter-${entry.id}-boss`;
  node.add(boss);
  const arm = counterBoxMesh(set, entry.material, [x * 0.7, y * 0.86, z * 0.35], `counter-${entry.id}-arm`, {
    position: [0, 0, -z * 0.22],
  });
  node.add(arm);
  const knob = counterCylinderMesh(set, 'chrome', {
    radius: z * 0.22,
    height: x * 0.9,
    radialSegments: 8,
    rotation: [0, 0, Math.PI / 2],
    position: [-x * 0.2, y * 0.36, -z * 0.36],
  });
  knob.name = `counter-${entry.id}-knob`;
  node.add(knob);
  return node;
}

/** Nickel dome bell screwed to the till lid. */
function buildTillBell(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { y } = entry.size;
  const base = counterCylinderMesh(set, entry.material, {
    radius: entry.size.x * 0.5,
    height: 0.008,
    radialSegments: 12,
    position: [0, -y / 2 + 0.004, 0],
  });
  base.name = `counter-${entry.id}-base`;
  node.add(base);
  const dome = counterCylinderMesh(set, entry.material, {
    radius: entry.size.x * 0.42,
    radiusTop: entry.size.x * 0.12,
    height: y * 0.8,
    radialSegments: 12,
    position: [0, y * 0.02, 0],
  });
  dome.name = `counter-${entry.id}-dome`;
  node.add(dome);
  const knob = counterCylinderMesh(set, 'brass', {
    radius: entry.size.x * 0.1,
    height: y * 0.16,
    radialSegments: 8,
    position: [0, y * 0.44, 0],
  });
  knob.name = `counter-${entry.id}-knob`;
  node.add(knob);
  return node;
}

/** Tin coin tray with a baize base and five compartment dividers. */
function buildCoinTray(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const body = counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`);
  node.add(body);
  const baize = counterBoxMesh(set, entry.trim ?? 'felt', [x * 0.92, 0.006, z * 0.88], `counter-${entry.id}-baize`, {
    position: [0, y / 2 - 0.001, 0],
  });
  node.add(baize);
  const dividerGeometry = new THREE.BoxGeometry(0.004, y * 1.1, z * 0.82);
  for (let index = 1; index < 6; index += 1) {
    const divider = new THREE.Mesh(dividerGeometry, counterMaterial(set, entry.material));
    divider.name = `counter-${entry.id}-divider-${index}`;
    divider.position.set(-x / 2 + (x * index) / 6, 0, 0);
    node.add(divider);
  }
  return node;
}

/** Ruled docket pad over a carbon sheet, with a clip. */
function buildDocketPad(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const backing = counterBoxMesh(set, 'wood', [x, y * 0.4, z], `counter-${entry.id}-backing`, {
    position: [0, -y * 0.3, 0],
  });
  node.add(backing);
  const carbon = counterBoxMesh(set, 'bakelite', [x * 0.98, y * 0.2, z * 0.98], `counter-${entry.id}-carbon`, {
    position: [0, -y * 0.05, 0],
  });
  node.add(carbon);
  const pad = counterBoxMesh(set, entry.material, [x * 0.98, y * 0.9, z * 0.98], `counter-${entry.id}-pad`, {
    position: [0, y * 0.35, 0],
  });
  node.add(pad);
  const clip = counterBoxMesh(set, entry.trim ?? 'brass', [x * 0.3, y * 1.6, z * 0.12], `counter-${entry.id}-clip`, {
    position: [0, y * 0.9, -z * 0.38],
  });
  node.add(clip);
  return node;
}

/** Cedar pencil lying on the docket pad, with its tip and string. */
function buildDocketPencil(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const barrel = counterCylinderMesh(set, entry.material, {
    radius: y * 0.5,
    height: x * 0.86,
    radialSegments: 6,
    rotation: [0, 0, Math.PI / 2],
  });
  barrel.name = `counter-${entry.id}-barrel`;
  node.add(barrel);
  const tip = counterCylinderMesh(set, 'bakelite', {
    radius: y * 0.5,
    radiusTop: 0.001,
    height: x * 0.12,
    radialSegments: 6,
    rotation: [0, 0, -Math.PI / 2],
    position: [x * 0.49, 0, 0],
  });
  tip.name = `counter-${entry.id}-tip`;
  node.add(tip);
  const string = counterBoxMesh(set, 'rubber', [x * 0.2, z * 0.6, z], `counter-${entry.id}-string`, {
    position: [-x * 0.5, 0, 0],
  });
  node.add(string);
  return node;
}

/** Cloth-bound day ledger, kept open on the counter. */
function buildLedger(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const pages = counterBoxMesh(set, entry.material, [x * 0.94, y * 0.8, z * 0.94], `counter-${entry.id}-pages`);
  node.add(pages);
  for (const side of [-1, 1]) {
    const cover = counterBoxMesh(set, entry.trim ?? 'wood', [x, y * 0.16, z], `counter-${entry.id}-cover-${side < 0 ? 'bottom' : 'top'}`, {
      position: [0, (side * y) / 2 * 0.92, 0],
    });
    node.add(cover);
  }
  const ribbon = counterBoxMesh(set, 'label', [x * 0.04, y * 0.3, z * 0.6], `counter-${entry.id}-ribbon`, {
    position: [x * 0.4, y * 0.2, 0],
  });
  node.add(ribbon);
  return node;
}

/** Hand-lettered price card propped in a brass holder. */
function buildPriceCard(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const holder = counterBoxMesh(set, entry.trim ?? 'brass', [x * 0.72, y * 0.12, z * 1.6], `counter-${entry.id}-holder`, {
    position: [0, -y / 2 + y * 0.06, 0],
  });
  node.add(holder);
  const card = counterFaceMesh(set, entry.material, [x, y * 0.88], `counter-${entry.id}-card`, {
    position: [0, y * 0.04, z * 0.5 + 0.001],
    rotation: [-0.12, 0, 0],
  });
  node.add(card);
  return node;
}

/** Glass tip jar with a printed label and a few coins in the bottom. */
function buildTipJar(entry: PlacedCounterProp, set: CounterMaterialSet, variationSeed: number): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const radius = Math.min(x, z) / 2;
  const jar = counterCylinderMesh(set, entry.material, {
    radius,
    height: y * 0.94,
    radialSegments: 14,
    position: [0, -y * 0.03, 0],
  });
  jar.name = `counter-${entry.id}-jar`;
  node.add(jar);
  const rim = counterCylinderMesh(set, entry.trim ?? 'chrome', {
    radius: radius * 1.06,
    height: y * 0.06,
    radialSegments: 14,
    position: [0, y * 0.44, 0],
  });
  rim.name = `counter-${entry.id}-rim`;
  node.add(rim);
  const label = counterFaceMesh(set, 'label', [radius * 1.5, y * 0.28], `counter-${entry.id}-label`, {
    position: [0, -y * 0.06, radius + 0.001],
  });
  node.add(label);

  // Coins: a small, seeded scatter inside the jar (never random per frame).
  const random = createSeededRandom(variationSeed ^ 0x5f3a);
  const coinGeometry = new THREE.CylinderGeometry(radius * 0.34, radius * 0.34, 0.003, 10);
  const coinMaterial = counterMaterial(set, 'brass');
  for (let index = 0; index < 4; index += 1) {
    const coin = new THREE.Mesh(coinGeometry, coinMaterial);
    coin.name = `counter-${entry.id}-coin-${index + 1}`;
    coin.rotation.set((random() - 0.5) * 0.4, random() * Math.PI, (random() - 0.5) * 0.4);
    coin.position.set(
      (random() - 0.5) * radius * 0.7,
      -y * 0.42 + index * 0.004,
      (random() - 0.5) * radius * 0.7,
    );
    node.add(coin);
  }
  return node;
}

function buildProp(
  entry: PlacedCounterProp,
  input: CounterDeviceBuildInput,
): THREE.Group | null {
  const { materials, variationSeed } = input;
  switch (entry.kind) {
    case 'cash-drawer': {
      const node = buildCashDrawer(entry, materials);
      input.cues.drawerNodes.push(node);
      return node;
    }
    case 'drawer-pull':
      return buildDrawerPull(entry, materials);
    case 'till-body':
      return buildTillBody(entry, materials);
    case 'till-lid':
      return buildTillLid(entry, materials);
    case 'till-lever': {
      const node = buildTillLever(entry, materials);
      input.cues.leverNodes.push(node);
      return node;
    }
    case 'till-bell': {
      const node = buildTillBell(entry, materials);
      input.cues.bellNodes.push(node);
      return node;
    }
    case 'coin-tray':
      return buildCoinTray(entry, materials);
    case 'docket-pad':
      return buildDocketPad(entry, materials);
    case 'docket-pencil':
      return buildDocketPencil(entry, materials);
    case 'ledger':
      return buildLedger(entry, materials);
    case 'price-card':
      return buildPriceCard(entry, materials);
    case 'tip-jar':
      return buildTipJar(entry, materials, variationSeed);
    default:
      return null;
  }
}

/** Builds the whole 1945 counter into the module's group. */
export function buildManualTill(input: CounterDeviceBuildInput): CounterDeviceBuildResult {
  const nodes = new Map<string, THREE.Object3D>();
  const nodeNames: string[] = [];
  let meshes = 0;

  for (const entry of input.plan.entries) {
    const node = buildProp(entry, input);
    if (!node) continue;
    node.name = `counter-${entry.id}`;
    node.position.set(entry.center.x, entry.center.y, entry.center.z);
    node.rotation.y = entry.rotationY;
    input.groupFor(entry.group).add(node);
    nodes.set(entry.id, node);
    nodeNames.push(node.name);
    for (const child of node.children) nodeNames.push(child.name);
    meshes += countMeshes(node);
  }

  return { nodes, nodeNames, meshes };
}

/** The manual-till builder, as the module's registry expects it. */
export const manualTillDevice: CounterDeviceBuilder = Object.freeze({
  family: 'manual-till' as const,
  build: buildManualTill,
});
