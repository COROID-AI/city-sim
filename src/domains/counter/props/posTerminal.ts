/**
 * 2005 prop builder — the integrated POS terminal, its CRT-style monitor, the
 * thermal printer, the PIN pad, the loyalty card stack and the cable bundle.
 *
 * The monitor's screen is a cloned face material off the era's phosphor slot, so
 * the module can breathe its emissive intensity the way a CRT warms and settles;
 * the PIN pad's status lamp is handed over as a status light. The receipt tape
 * gets its own copy of the paper map, so the receipt scrolls while the spare
 * paper stays put.
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
import { createSeededRandom } from '../../../core/kernel';
import type {
  CounterDeviceBuildInput,
  CounterDeviceBuildResult,
  CounterDeviceBuilder,
  CounterCueRegistry,
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

function addStatusLight(cues: CounterCueRegistry, material: THREE.MeshStandardMaterial): void {
  cues.statusLights.push(material);
  cues.statusLightEmissive.push(material.emissiveIntensity);
}

/** Steel drawer with a note clip, a coin insert and a barrel lock. */
function buildCashDrawer(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`));
  node.add(
    counterFaceMesh(set, 'steel', [x * 0.94, y * 0.6], `counter-${entry.id}-face`, {
      position: [0, 0, z / 2 + 0.001],
    }),
  );
  node.add(
    counterBoxMesh(set, entry.trim ?? 'felt', [x * 0.76, y * 0.24, z * 0.56], `counter-${entry.id}-coin-insert`, {
      position: [0, y * 0.32, 0],
    }),
  );
  node.add(
    counterBoxMesh(set, 'chrome', [x * 0.3, y * 0.08, z * 0.2], `counter-${entry.id}-note-clip`, {
      position: [-x * 0.2, y * 0.42, -z * 0.16],
    }),
  );
  const lock = counterCylinderMesh(set, 'chrome', {
    radius: 0.008,
    height: 0.006,
    radialSegments: 10,
    position: [-x * 0.38, 0, z / 2 + 0.002],
    rotation: [Math.PI / 2, 0, 0],
  });
  lock.name = `counter-${entry.id}-lock`;
  node.add(lock);
  return node;
}

/** Beige terminal chassis with a keyboard fascia, a printer slot and a lamp. */
function buildTerminalChassis(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-chassis`));
  node.add(
    counterFaceMesh(set, 'keyface', [x * 0.84, y * 0.5], `counter-${entry.id}-keyboard`, {
      position: [0, -y * 0.2, z / 2 + 0.002],
      rotation: [0.3, 0, 0],
    }),
  );
  node.add(
    counterFaceMesh(set, 'label', [x * 0.62, y * 0.16], `counter-${entry.id}-fascia`, {
      position: [0, y * 0.2, z / 2 + 0.002],
    }),
  );
  node.add(
    counterBoxMesh(set, 'bakelite', [x * 0.5, y * 0.06, 0.012], `counter-${entry.id}-printer-slot`, {
      position: [0, -y * 0.02, z / 2 + 0.006],
    }),
  );
  const ventGeometry = new THREE.BoxGeometry(0.006, y * 0.3, z * 0.3);
  for (const side of [-1, 1]) {
    const vent = new THREE.Mesh(ventGeometry, counterMaterial(set, 'bakelite'));
    vent.name = `counter-${entry.id}-port-${side < 0 ? 'left' : 'right'}`;
    vent.position.set(side * (x / 2 - 0.004), -y * 0.1, -z * 0.2);
    node.add(vent);
  }
  const lampMaterial = counterFaceMaterial(set, 'led', { emissive: 0x53ff8a, emissiveIntensity: 1 });
  const lamp = counterCylinderMesh(set, 'led', {
    radius: 0.005,
    height: 0.004,
    radialSegments: 8,
    rotation: [Math.PI / 2, 0, 0],
    position: [x * 0.4, y * 0.3, z / 2 + 0.002],
  });
  lamp.material = lampMaterial;
  lamp.name = `counter-${entry.id}-power-lamp`;
  addStatusLight(cues, lampMaterial);
  node.add(lamp);
  return node;
}

/** CRT monitor: deep beige housing, a glowing screen and a tilt stand. */
function buildCrtMonitor(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-housing`));
  const screenMaterial = counterFaceMaterial(set, 'screen', { side: 'double' });
  const screen = counterFaceMesh(set, 'screen', [x * 0.74, y * 0.66], `counter-${entry.id}-screen`, {
    position: [0, y * 0.06, z / 2 + 0.017],
  });
  screen.material = screenMaterial;
  node.add(screen);
  node.add(
    counterBoxMesh(set, 'bakelite', [x * 0.8, y * 0.74, 0.02], `counter-${entry.id}-bezel`, {
      position: [0, y * 0.06, z / 2 + 0.006],
    }),
  );
  const ventGeometry = new THREE.BoxGeometry(x * 0.5, 0.004, 0.02);
  for (let index = 0; index < 3; index += 1) {
    const vent = new THREE.Mesh(ventGeometry, counterMaterial(set, 'bakelite'));
    vent.name = `counter-${entry.id}-vent-${index + 1}`;
    vent.position.set(0, y * 0.36, z / 2 + 0.002 - index * 0.012);
    node.add(vent);
  }
  node.add(
    counterBoxMesh(set, entry.trim ?? 'chrome', [x * 0.7, y * 0.14, z * 0.6], `counter-${entry.id}-tilt-stand`, {
      position: [0, -y * 0.43, 0],
    }),
  );
  cues.displayMaterials.push(screenMaterial);
  cues.displayEmissive.push(screenMaterial.emissiveIntensity);
  return node;
}

/** Dark thermal printer with a paper slot, vents and a ready lamp. */
function buildReceiptPrinter(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-housing`));
  node.add(
    counterBoxMesh(set, 'bakelite', [x * 0.7, y * 0.1, 0.01], `counter-${entry.id}-slot`, {
      position: [0, y * 0.14, -z / 2 - 0.004],
    }),
  );
  const ventGeometry = new THREE.BoxGeometry(x * 0.56, 0.004, z * 0.04);
  for (let index = 0; index < 3; index += 1) {
    const vent = new THREE.Mesh(ventGeometry, counterMaterial(set, 'bakelite'));
    vent.name = `counter-${entry.id}-vent-${index + 1}`;
    vent.position.set(0, -y * 0.3 + index * 0.016, z * 0.28);
    node.add(vent);
  }
  const lampMaterial = counterFaceMaterial(set, 'led', { emissive: 0x53ff8a, emissiveIntensity: 0.9 });
  const lamp = counterCylinderMesh(set, 'led', {
    radius: 0.005,
    height: 0.004,
    radialSegments: 8,
    rotation: [Math.PI / 2, 0, 0],
    position: [x * 0.34, y * 0.22, -z / 2 - 0.002],
  });
  lamp.material = lampMaterial;
  lamp.name = `counter-${entry.id}-ready-lamp`;
  addStatusLight(cues, lampMaterial);
  node.add(lamp);
  return node;
}

/** Itemised receipt strip; the module advances it and scrolls its print. */
function buildReceiptTape(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Mesh {
  const map = counterPrivateMap(set, entry.material, [1, 0.5]);
  const material = counterFaceMaterial(set, entry.material, { map, side: 'double' });
  const tape = new THREE.Mesh(new THREE.BoxGeometry(entry.size.x, entry.size.y, entry.size.z), material);
  tape.name = `counter-${entry.id}`;
  cues.tapeNodes.push(tape);
  return tape;
}

/** Steel coin tray with felt wells and a printed denomination strip. */
function buildCoinTray(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`));
  node.add(
    counterBoxMesh(set, entry.trim ?? 'felt', [x * 0.9, y * 0.4, z * 0.86], `counter-${entry.id}-wells`, {
      position: [0, y * 0.26, 0],
    }),
  );
  const dividerGeometry = new THREE.BoxGeometry(0.004, y * 0.9, z * 0.8);
  for (let index = 1; index < 5; index += 1) {
    const divider = new THREE.Mesh(dividerGeometry, counterMaterial(set, entry.material));
    divider.name = `counter-${entry.id}-divider-${index}`;
    divider.position.set(-x / 2 + (x * index) / 5, y * 0.14, 0);
    node.add(divider);
  }
  node.add(
    counterFaceMesh(set, 'label', [x * 0.86, y * 0.5], `counter-${entry.id}-denominations`, {
      position: [0, -y * 0.16, z / 2 + 0.001],
    }),
  );
  return node;
}

/** A small fan of printed loyalty cards in a folding holder. */
function buildLoyaltyCards(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  variationSeed: number,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(
    counterBoxMesh(set, entry.trim ?? 'chrome', [x * 1.1, y * 1.6, z * 0.7], `counter-${entry.id}-holder`, {
      position: [0, -y * 0.4, -z * 0.1],
    }),
  );
  const random = createSeededRandom(variationSeed ^ 0x2d19);
  const cardGeometry = new THREE.BoxGeometry(x, y * 0.5, z * 0.92);
  const cardMaterial = counterMaterial(set, entry.material);
  for (let index = 0; index < 3; index += 1) {
    const card = new THREE.Mesh(cardGeometry, cardMaterial);
    card.name = `counter-${entry.id}-card-${index + 1}`;
    card.rotation.set(0, (index - 1) * 0.11, (random() - 0.5) * 0.02);
    card.position.set((index - 1) * x * 0.08, y * 0.2 + index * y * 0.24, (index - 1) * 0.004);
    node.add(card);
  }
  return node;
}

/** Grey PIN pad: keypad face, screen, card slot and a status lamp. */
function buildCardTerminal(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`));
  node.add(
    counterFaceMesh(set, entry.material, [x * 0.88, y * 0.86], `counter-${entry.id}-pad`, {
      position: [0, 0, z / 2 + 0.002],
      rotation: [0.22, 0, 0],
    }),
  );
  node.add(
    counterBoxMesh(set, 'chrome', [x * 0.7, 0.012, 0.02], `counter-${entry.id}-card-slot`, {
      position: [0, -y * 0.06, z * 0.42],
    }),
  );
  const lampMaterial = counterFaceMaterial(set, 'led', { emissive: 0x59d0ff, emissiveIntensity: 1 });
  const lamp = counterCylinderMesh(set, 'led', {
    radius: 0.005,
    height: 0.004,
    radialSegments: 8,
    rotation: [Math.PI / 2, 0, 0],
    position: [x * 0.36, y * 0.34, z / 2 + 0.002],
  });
  lamp.material = lampMaterial;
  lamp.name = `counter-${entry.id}-status-lamp`;
  addStatusLight(cues, lampMaterial);
  node.add(lamp);
  return node;
}

function buildPrintedLabel(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.trim ?? 'chrome', [x * 1.02, y * 1.4, z * 1.1], `counter-${entry.id}-holder`));
  node.add(
    counterFaceMesh(set, entry.material, [x, y * 0.9], `counter-${entry.id}-plate`, {
      position: [0, y * 0.6, z * 0.55 + 0.001],
      rotation: [-0.2, 0, 0],
    }),
  );
  return node;
}

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
  const rim = counterCylinderMesh(set, entry.trim ?? 'chrome', {
    radius: radius * 1.05,
    height: y * 0.06,
    radialSegments: 12,
    position: [0, y * 0.44, 0],
  });
  rim.name = `counter-${entry.id}-rim`;
  node.add(rim);
  node.add(
    counterFaceMesh(set, 'label', [radius * 1.5, y * 0.28], `counter-${entry.id}-label`, {
      position: [0, -y * 0.04, radius + 0.001],
    }),
  );
  return node;
}

/** Bundled cables clipped flat along the island edge, with a trunking strip. */
function buildCable(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, 'shelfPaint', [x, y * 0.5, z * 0.9], `counter-${entry.id}-trunking`));
  for (const side of [-1, 1]) {
    const lead = counterCylinderMesh(set, entry.material, {
      radius: y * 0.24,
      height: z * 0.82,
      radialSegments: 8,
      rotation: [Math.PI / 2, 0, 0],
      position: [side * x * 0.28, y * 0.5, 0],
    });
    lead.name = `counter-${entry.id}-lead-${side < 0 ? 'data' : 'mains'}`;
    node.add(lead);
  }
  node.add(
    counterBoxMesh(set, 'bakelite', [x * 2, y * 1.1, 0.03], `counter-${entry.id}-connector`, {
      position: [0, y * 0.4, -z * 0.42],
    }),
  );
  return node;
}

function buildProp(entry: PlacedCounterProp, input: CounterDeviceBuildInput): THREE.Object3D | null {
  const { materials, cues, variationSeed } = input;
  switch (entry.kind) {
    case 'cash-drawer': {
      const node = buildCashDrawer(entry, materials);
      cues.drawerNodes.push(node);
      return node;
    }
    case 'pos-terminal':
      return buildTerminalChassis(entry, materials, cues);
    case 'crt-monitor':
      return buildCrtMonitor(entry, materials, cues);
    case 'receipt-printer':
      return buildReceiptPrinter(entry, materials, cues);
    case 'receipt-tape':
      return buildReceiptTape(entry, materials, cues);
    case 'coin-tray':
      return buildCoinTray(entry, materials);
    case 'loyalty-cards':
      return buildLoyaltyCards(entry, materials, variationSeed);
    case 'card-terminal':
      return buildCardTerminal(entry, materials, cues);
    case 'printed-label':
      return buildPrintedLabel(entry, materials);
    case 'tip-jar':
      return buildTipJar(entry, materials);
    case 'cable':
      return buildCable(entry, materials);
    default:
      return null;
  }
}

/** Builds the whole 2005 counter into the module's group. */
export function buildPosTerminal(input: CounterDeviceBuildInput): CounterDeviceBuildResult {
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

/** The POS-terminal builder, as the module's registry expects it. */
export const posTerminalDevice: CounterDeviceBuilder = Object.freeze({
  family: 'pos-terminal' as const,
  build: buildPosTerminal,
});
