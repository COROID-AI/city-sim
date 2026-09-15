/**
 * 1965 prop builder — the mechanical register, its tape printer and the steel
 * counter furniture of the period.
 *
 * The register is built around a printed key bank (the keys are painted into the
 * key legend texture rather than modelled one by one, which keeps the silhouette
 * period-exact at a fraction of the polygon budget) with a glazed dial window, a
 * winding crank on the right cheek and a printer clamped to the back. The
 * builder hands the module the era's animated parts: the crank that winds, the
 * tape that feeds out of the printer and the drawer that eases open.
 */

import * as THREE from 'three';
import {
  counterBoxMesh,
  counterCylinderMesh,
  counterFaceMaterial,
  counterFaceMesh,
  counterMaterial,
  counterPrivateMap,
  type CounterMaterialSet,
} from '../textures/labels';
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

/** Chromed steel drawer with a felt-lined coin insert and a lock. */
function buildCashDrawer(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`));
  const face = counterFaceMesh(set, 'chrome', [x * 0.96, y * 0.7], `counter-${entry.id}-face`, {
    position: [0, 0, z / 2 + 0.001],
  });
  node.add(face);
  const insert = counterBoxMesh(set, entry.trim ?? 'felt', [x * 0.8, y * 0.3, z * 0.6], `counter-${entry.id}-insert`, {
    position: [0, y * 0.3, 0],
  });
  node.add(insert);
  const handle = counterBoxMesh(set, 'chrome', [x * 0.4, y * 0.18, 0.012], `counter-${entry.id}-handle`, {
    position: [0, -y * 0.1, z / 2 + 0.008],
  });
  node.add(handle);
  const lock = counterCylinderMesh(set, 'chrome', {
    radius: 0.009,
    height: 0.006,
    radialSegments: 10,
    position: [-x * 0.36, 0, z / 2 + 0.002],
    rotation: [Math.PI / 2, 0, 0],
  });
  lock.name = `counter-${entry.id}-lock`;
  node.add(lock);
  return node;
}

/** Enamelled register: housing, key bank, glazed dials and a printed plate. */
function buildRegisterBody(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-housing`));

  // Sloped key bank on the front face: three rows of printed keys.
  const keybank = counterFaceMesh(set, entry.trim ?? 'keyface', [x * 0.86, y * 0.42], `counter-${entry.id}-keybank`, {
    position: [0, -y * 0.2, z / 2 + 0.002],
    rotation: [0.28, 0, 0],
  });
  node.add(keybank);

  // Glazed window over the accumulating dials.
  const glass = counterFaceMesh(set, 'chrome', [x * 0.5, y * 0.22], `counter-${entry.id}-dial-window`, {
    position: [0, y * 0.24, z / 2 + 0.002],
  });
  node.add(glass);
  const dials = counterFaceMesh(set, 'keyface', [x * 0.42, y * 0.16], `counter-${entry.id}-dials`, {
    position: [0, y * 0.24, z / 2 + 0.003],
  });
  node.add(dials);

  const plate = counterFaceMesh(set, 'label', [x * 0.5, y * 0.12], `counter-${entry.id}-plate`, {
    position: [0, y * 0.44, z / 2 - 0.06],
    rotation: [-Math.PI / 2, 0, 0],
  });
  node.add(plate);
  return node;
}

/** Chrome winding crank on the register's right cheek. */
function buildRegisterCrank(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const boss = counterCylinderMesh(set, entry.material, {
    radius: z * 0.28,
    height: x * 0.8,
    radialSegments: 10,
    rotation: [0, 0, Math.PI / 2],
    position: [-x * 0.6, 0, 0],
  });
  boss.name = `counter-${entry.id}-boss`;
  node.add(boss);
  const arm = counterBoxMesh(set, entry.material, [x * 0.6, y * 0.8, z * 0.22], `counter-${entry.id}-arm`, {
    position: [0, 0, z * 0.2],
  });
  node.add(arm);
  const knob = counterCylinderMesh(set, 'bakelite', {
    radius: z * 0.24,
    height: x * 0.9,
    radialSegments: 8,
    rotation: [0, 0, Math.PI / 2],
    position: [-x * 0.1, y * 0.34, z * 0.36],
  });
  knob.name = `counter-${entry.id}-knob`;
  node.add(knob);
  return node;
}

/** Printer unit clamped to the register, with a slot, vents and a ready lamp. */
function buildReceiptPrinter(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterDeviceBuildInput['cues'],
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-housing`));
  const slot = counterBoxMesh(set, 'bakelite', [x * 0.7, y * 0.1, 0.01], `counter-${entry.id}-slot`, {
    position: [0, y * 0.12, -z / 2 - 0.004],
  });
  node.add(slot);
  const ventGeometry = new THREE.BoxGeometry(x * 0.5, 0.004, z * 0.04);
  for (let index = 0; index < 3; index += 1) {
    const vent = new THREE.Mesh(ventGeometry, counterMaterial(set, 'bakelite'));
    vent.name = `counter-${entry.id}-vent-${index + 1}`;
    vent.position.set(0, -y * 0.28 + index * 0.016, z * 0.3);
    node.add(vent);
  }
  const lampMaterial = counterFaceMaterial(set, 'led', { color: 0xffffff, emissive: 0x66ff88, emissiveIntensity: 0.9 });
  const lamp = counterCylinderMesh(set, 'led', {
    radius: 0.005,
    height: 0.004,
    radialSegments: 8,
    rotation: [Math.PI / 2, 0, 0],
    position: [x * 0.36, y * 0.2, -z / 2 - 0.002],
  });
  lamp.name = `counter-${entry.id}-ready-lamp`;
  lamp.material = lampMaterial;
  node.add(lamp);
  cues.statusLights.push(lampMaterial);
  cues.statusLightEmissive.push(lampMaterial.emissiveIntensity);
  return node;
}

function buildProp(
  entry: PlacedCounterProp,
  input: CounterDeviceBuildInput,
): THREE.Object3D | null {
  const { materials, cues } = input;
  switch (entry.kind) {
    case 'cash-drawer': {
      const node = buildCashDrawer(entry, materials);
      cues.drawerNodes.push(node);
      return node;
    }
    case 'register-body':
      return buildRegisterBody(entry, materials);
    case 'register-crank': {
      const node = buildRegisterCrank(entry, materials);
      cues.crankNodes.push(node);
      return node;
    }
    case 'receipt-printer':
      return buildReceiptPrinter(entry, materials, cues);
    case 'receipt-tape':
      return buildReceiptTapeWithCue(entry, materials, cues);
    case 'coin-tray':
      return buildCoinTray(entry, materials);
    case 'printed-label':
      return buildPrintedLabel(entry, materials);
    case 'price-card':
      return buildPriceCard(entry, materials);
    case 'tip-jar':
      return buildTipJar(entry, materials);
    case 'cable':
      return buildCable(entry, materials);
    default:
      return null;
  }
}

function buildReceiptTapeWithCue(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterDeviceBuildInput['cues'],
): THREE.Mesh {
  const map = counterPrivateMap(set, entry.material, [1, 0.5]);
  const material = counterFaceMaterial(set, entry.material, { map, side: 'double' });
  const tape = new THREE.Mesh(new THREE.BoxGeometry(entry.size.x, entry.size.y, entry.size.z), material);
  tape.name = `counter-${entry.id}`;
  cues.tapeNodes.push(tape);
  return tape;
}

/** Steel coin tray with labelled compartments. */
function buildCoinTray(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`));
  const insert = counterBoxMesh(set, entry.trim ?? 'felt', [x * 0.9, y * 0.4, z * 0.86], `counter-${entry.id}-insert`, {
    position: [0, y * 0.24, 0],
  });
  node.add(insert);
  const dividerGeometry = new THREE.BoxGeometry(0.004, y * 0.9, z * 0.8);
  for (let index = 1; index < 5; index += 1) {
    const divider = new THREE.Mesh(dividerGeometry, counterMaterial(set, entry.material));
    divider.name = `counter-${entry.id}-divider-${index}`;
    divider.position.set(-x / 2 + (x * index) / 5, y * 0.1, 0);
    node.add(divider);
  }
  const strip = counterFaceMesh(set, 'label', [x * 0.86, y * 0.6], `counter-${entry.id}-label-strip`, {
    position: [0, -y * 0.2, z / 2 + 0.001],
  });
  node.add(strip);
  return node;
}

/** Printed model plate in a chrome holder. */
function buildPrintedLabel(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.trim ?? 'chrome', [x * 1.02, y * 1.4, z * 1.1], `counter-${entry.id}-holder`));
  const plate = counterFaceMesh(set, entry.material, [x, y * 0.9], `counter-${entry.id}-plate`, {
    position: [0, y * 0.6, z * 0.55 + 0.001],
    rotation: [-0.2, 0, 0],
  });
  node.add(plate);
  return node;
}

/** Printed price card propped in a chrome holder. */
function buildPriceCard(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(
    counterBoxMesh(set, entry.trim ?? 'chrome', [x * 0.7, y * 0.12, z * 1.7], `counter-${entry.id}-holder`, {
      position: [0, -y * 0.44, 0],
    }),
  );
  node.add(
    counterFaceMesh(set, entry.material, [x, y * 0.88], `counter-${entry.id}-card`, {
      position: [0, y * 0.04, z * 0.5 + 0.001],
      rotation: [-0.12, 0, 0],
    }),
  );
  return node;
}

/** Glass tip jar with a printed saucer label. */
function buildTipJar(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const radius = Math.min(x, z) / 2;
  const jar = counterCylinderMesh(set, entry.material, {
    radius,
    height: y * 0.94,
    radialSegments: 12,
    position: [0, -y * 0.03, 0],
  });
  jar.name = `counter-${entry.id}-jar`;
  node.add(jar);
  const lid = counterCylinderMesh(set, entry.trim ?? 'chrome', {
    radius: radius * 1.08,
    height: y * 0.08,
    radialSegments: 12,
    position: [0, y * 0.44, 0],
  });
  lid.name = `counter-${entry.id}-lid`;
  node.add(lid);
  const label = counterFaceMesh(set, 'label', [radius * 1.6, y * 0.3], `counter-${entry.id}-label`, {
    position: [0, -y * 0.06, radius + 0.001],
  });
  node.add(label);
  return node;
}

/** Braided cord running from the register to the wall. */
function buildCable(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const lead = counterBoxMesh(set, entry.material, [x, y * 0.6, z * 0.9], `counter-${entry.id}-lead`);
  node.add(lead);
  const plug = counterBoxMesh(set, 'bakelite', [x * 1.8, y * 1.2, 0.03], `counter-${entry.id}-plug`, {
    position: [0, y * 0.3, -z * 0.4],
  });
  node.add(plug);
  const coil = counterCylinderMesh(set, entry.material, {
    radius: y * 0.4,
    height: x * 0.6,
    radialSegments: 8,
    rotation: [0, 0, Math.PI / 2],
    position: [0, y * 0.4, -z * 0.2],
  });
  coil.name = `counter-${entry.id}-coil`;
  node.add(coil);
  return node;
}

/** Builds the whole 1965 counter into the module's group. */
export function buildMechanicalRegister(input: CounterDeviceBuildInput): CounterDeviceBuildResult {
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

/** The mechanical-register builder, as the module's registry expects it. */
export const mechanicalRegisterDevice: CounterDeviceBuilder = Object.freeze({
  family: 'mechanical-register' as const,
  build: buildMechanicalRegister,
});
