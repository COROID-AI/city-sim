/**
 * 1985 prop builder — the electronic cash register, its numeric LED face, the
 * thermal roll and the handheld barcode scanner with its labelled goods.
 *
 * The era's character is in the lit faces: the LED face material is cloned off
 * the era's material set so the module can drive its emissive intensity without
 * disturbing the shared set, and the scanner's read lamp and the register's
 * power lamp are handed over as status lights. The receipt tape gets a private
 * copy of the paper map so only the tape scrolls.
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

/** Brushed steel drawer with a moulded coin insert and a barrel lock. */
function buildCashDrawer(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`));
  const face = counterFaceMesh(set, 'steel', [x * 0.94, y * 0.66], `counter-${entry.id}-face`, {
    position: [0, 0, z / 2 + 0.001],
  });
  node.add(face);
  node.add(
    counterBoxMesh(set, entry.trim ?? 'felt', [x * 0.78, y * 0.28, z * 0.58], `counter-${entry.id}-coin-insert`, {
      position: [0, y * 0.3, 0],
    }),
  );
  node.add(
    counterBoxMesh(set, 'chrome', [x * 0.46, y * 0.14, 0.012], `counter-${entry.id}-handle`, {
      position: [0, -y * 0.16, z / 2 + 0.008],
    }),
  );
  const lock = counterCylinderMesh(set, 'chrome', {
    radius: 0.008,
    height: 0.006,
    radialSegments: 10,
    position: [-x * 0.36, 0, z / 2 + 0.002],
    rotation: [Math.PI / 2, 0, 0],
  });
  lock.name = `counter-${entry.id}-lock`;
  node.add(lock);
  return node;
}

/** Moulded register wedge with a keypad, a receipt lid and a power lamp. */
function buildEcrBody(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-housing`));
  node.add(
    counterFaceMesh(set, entry.trim ?? 'keyface', [x * 0.82, y * 0.5], `counter-${entry.id}-keypad`, {
      position: [0, -y * 0.16, z / 2 + 0.002],
      rotation: [0.34, 0, 0],
    }),
  );
  node.add(
    counterBoxMesh(set, 'bakelite', [x * 0.7, 0.008, z * 0.34], `counter-${entry.id}-receipt-lid`, {
      position: [0, y / 2 + 0.004, -z * 0.18],
    }),
  );
  node.add(
    counterFaceMesh(set, 'label', [x * 0.6, y * 0.16], `counter-${entry.id}-fascia`, {
      position: [0, y * 0.06, z / 2 + 0.003],
    }),
  );
  const lampMaterial = counterFaceMaterial(set, 'led', { emissive: 0x4bff8a, emissiveIntensity: 1.1 });
  const lamp = counterCylinderMesh(set, 'led', {
    radius: 0.005,
    height: 0.004,
    radialSegments: 8,
    rotation: [Math.PI / 2, 0, 0],
    position: [x * 0.4, -y * 0.34, z / 2 + 0.002],
  });
  lamp.material = lampMaterial;
  addStatusLight(cues, lampMaterial);
  lamp.name = `counter-${entry.id}-power-lamp`;
  node.add(lamp);
  return node;
}

/** Red seven-segment face behind a smoked filter; the module blinks it. */
function buildDisplayLed(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, 'bakelite', [x, y, z], `counter-${entry.id}-housing`));
  const face = counterFaceMaterial(set, entry.material, { side: 'double' });
  const screen = counterFaceMesh(set, 'led', [x * 0.92, y * 0.8], `counter-${entry.id}-led-face`, {
    position: [0, 0, z / 2 + 0.001],
  });
  screen.material = face;
  node.add(screen);
  node.add(
    counterBoxMesh(set, entry.trim ?? 'chrome', [x * 0.98, y * 0.08, z * 0.6], `counter-${entry.id}-filter-frame`, {
      position: [0, y / 2 - y * 0.04, z * 0.2],
    }),
  );
  cues.displayMaterials.push(face);
  cues.displayEmissive.push(face.emissiveIntensity);
  return node;
}

/** Thermal roll on a chrome axle, with its paper edge visible. */
function buildReceiptRoll(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const roll = counterCylinderMesh(set, entry.material, {
    radius: Math.min(x, z) / 2,
    height: y,
    radialSegments: 16,
    rotation: [0, 0, Math.PI / 2],
  });
  roll.name = `counter-${entry.id}-roll`;
  node.add(roll);
  const axle = counterCylinderMesh(set, entry.trim ?? 'chrome', {
    radius: Math.min(x, z) * 0.16,
    height: x * 1.1,
    radialSegments: 10,
    rotation: [0, 0, Math.PI / 2],
  });
  axle.name = `counter-${entry.id}-axle`;
  node.add(axle);
  return node;
}

/** Printed paper strip; the module advances it and scrolls its print. */
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

/** Moulded coin tray with five wells and a printed denomination strip. */
function buildCoinTray(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`));
  node.add(
    counterBoxMesh(set, 'bakelite', [x * 0.9, y * 0.3, z * 0.84], `counter-${entry.id}-wells`, {
      position: [0, y * 0.3, 0],
    }),
  );
  const dividerGeometry = new THREE.BoxGeometry(0.004, y * 0.8, z * 0.78);
  for (let index = 1; index < 5; index += 1) {
    const divider = new THREE.Mesh(dividerGeometry, counterMaterial(set, 'bakelite'));
    divider.name = `counter-${entry.id}-divider-${index}`;
    divider.position.set(-x / 2 + (x * index) / 5, y * 0.2, 0);
    node.add(divider);
  }
  node.add(
    counterFaceMesh(set, entry.trim ?? 'keyface', [x * 0.88, y * 0.5], `counter-${entry.id}-denominations`, {
      position: [0, y * 0.02, z / 2 + 0.001],
    }),
  );
  return node;
}

/** A printed tin waiting to be scanned, with its barcode facing the window. */
function buildScannerGoods(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const tin = counterCylinderMesh(set, entry.material, {
    radius: Math.min(x, z) / 2,
    height: y,
    radialSegments: 14,
  });
  tin.name = `counter-${entry.id}-tin`;
  node.add(tin);
  node.add(
    counterFaceMesh(set, 'label', [x * 0.8, y * 0.4], `counter-${entry.id}-wrapper`, {
      position: [0, y * 0.12, z / 2 + 0.001],
    }),
  );
  const barcode = counterFaceMesh(set, entry.trim ?? 'scannerShell', [x * 0.56, y * 0.12], `counter-${entry.id}-barcode`, {
    position: [0, -y * 0.22, z / 2 + 0.002],
  });
  node.add(barcode);
  const lid = counterCylinderMesh(set, 'chrome', {
    radius: Math.min(x, z) / 2 * 1.04,
    height: 0.006,
    radialSegments: 14,
    position: [0, y / 2 - 0.002, 0],
  });
  lid.name = `counter-${entry.id}-lid`;
  node.add(lid);
  return node;
}

/** Corded barcode scanner resting in its cradle, read lamp lit. */
function buildBarcodeScanner(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const cradle = counterBoxMesh(set, 'bakelite', [x * 0.9, y * 0.22, z * 0.9], `counter-${entry.id}-cradle`, {
    position: [0, -y * 0.38, 0],
  });
  node.add(cradle);
  const body = counterBoxMesh(set, entry.material, [x * 0.62, y * 0.5, z * 0.46], `counter-${entry.id}-body`, {
    position: [0, y * 0.1, 0],
  });
  node.add(body);
  const head = counterBoxMesh(set, entry.material, [x * 0.5, y * 0.34, z * 0.72], `counter-${entry.id}-head`, {
    position: [0, y * 0.26, z * 0.06],
  });
  node.add(head);
  const window_ = counterFaceMesh(set, 'bakelite', [x * 0.42, y * 0.22], `counter-${entry.id}-window`, {
    position: [0, y * 0.24, z * 0.42 + 0.001],
  });
  node.add(window_);
  const lampMaterial = counterFaceMaterial(set, 'led', { emissive: 0xff3a24, emissiveIntensity: 1.2 });
  const lamp = counterCylinderMesh(set, 'led', {
    radius: 0.004,
    height: 0.004,
    radialSegments: 8,
    rotation: [Math.PI / 2, 0, 0],
    position: [x * 0.2, y * 0.36, z * 0.42 + 0.002],
  });
  lamp.material = lampMaterial;
  lamp.name = `counter-${entry.id}-read-lamp`;
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

/** Mug-shaped tip jar: body, handle and a printed label. */
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
  jar.name = `counter-${entry.id}-mug`;
  node.add(jar);
  const handleGeometry = new THREE.TorusGeometry(radius * 0.5, radius * 0.14, 6, 12);
  const handle = new THREE.Mesh(handleGeometry, counterMaterial(set, entry.material));
  handle.name = `counter-${entry.id}-handle`;
  handle.rotation.y = Math.PI / 2;
  handle.position.set(radius + radius * 0.4, 0, 0);
  node.add(handle);
  node.add(
    counterFaceMesh(set, 'label', [radius * 1.5, y * 0.3], `counter-${entry.id}-label`, {
      position: [0, -y * 0.04, radius + 0.001],
    }),
  );
  return node;
}

function buildCable(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y * 0.6, z * 0.9], `counter-${entry.id}-lead`));
  node.add(
    counterBoxMesh(set, 'bakelite', [x * 1.8, y * 1.2, 0.03], `counter-${entry.id}-plug`, {
      position: [0, y * 0.3, -z * 0.4],
    }),
  );
  const coil = counterCylinderMesh(set, entry.material, {
    radius: y * 0.4,
    height: x * 0.6,
    radialSegments: 8,
    rotation: [0, 0, Math.PI / 2],
    position: [0, y * 0.4, -z * 0.18],
  });
  coil.name = `counter-${entry.id}-coil`;
  node.add(coil);
  return node;
}

function buildProp(entry: PlacedCounterProp, input: CounterDeviceBuildInput): THREE.Object3D | null {
  const { materials, cues } = input;
  switch (entry.kind) {
    case 'cash-drawer': {
      const node = buildCashDrawer(entry, materials);
      cues.drawerNodes.push(node);
      return node;
    }
    case 'ecr-body':
      return buildEcrBody(entry, materials, cues);
    case 'display-led':
      return buildDisplayLed(entry, materials, cues);
    case 'receipt-roll':
      return buildReceiptRoll(entry, materials);
    case 'receipt-tape':
      return buildReceiptTape(entry, materials, cues);
    case 'coin-tray':
      return buildCoinTray(entry, materials);
    case 'scanner-goods':
      return buildScannerGoods(entry, materials);
    case 'barcode-scanner':
      return buildBarcodeScanner(entry, materials, cues);
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

/** Builds the whole 1985 counter into the module's group. */
export function buildElectronicRegister(input: CounterDeviceBuildInput): CounterDeviceBuildResult {
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

/** The electronic-register builder, as the module's registry expects it. */
export const electronicRegisterDevice: CounterDeviceBuilder = Object.freeze({
  family: 'electronic-register' as const,
  build: buildElectronicRegister,
});
