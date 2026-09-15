/**
 * 2025 prop builder — the tablet POS on its stand, the contactless reader with
 * its tap acknowledgement disc, the QR ordering card and the pick-up shelf.
 *
 * The tablet's screen is a cloned face material off the era's backlit slot so the
 * module can breathe it, and the reader hands over two animated cues: the tap
 * ring the module scales and shows for each acknowledged tap, and the status lamp
 * whose emissive intensity follows the same acknowledgement. The pick-up shelf is
 * built with its printed header and order tickets so the floor-standing prop
 * still reads as the app-order station.
 */

import * as THREE from 'three';
import {
  counterBoxMesh,
  counterCylinderMesh,
  counterFaceMaterial,
  counterFaceMesh,
  counterMaterial,
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

/** Slim steel note drawer with a felt base and a flush pull. */
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
    counterBoxMesh(set, entry.trim ?? 'felt', [x * 0.8, y * 0.2, z * 0.6], `counter-${entry.id}-liner`, {
      position: [0, y * 0.34, 0],
    }),
  );
  node.add(
    counterBoxMesh(set, 'chrome', [x * 0.44, y * 0.3, 0.01], `counter-${entry.id}-pull`, {
      position: [0, 0, z / 2 + 0.006],
    }),
  );
  return node;
}

/** Weighted aluminium stand: base, pole, hinge clamp and a cable gland. */
function buildTabletStand(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const base = counterCylinderMesh(set, entry.material, {
    radius: Math.min(x, z) * 0.5,
    height: y * 0.08,
    radialSegments: 16,
    position: [0, -y / 2 + y * 0.04, 0],
  });
  base.name = `counter-${entry.id}-base`;
  node.add(base);
  const pole = counterCylinderMesh(set, entry.material, {
    radius: Math.min(x, z) * 0.16,
    height: y * 0.74,
    radialSegments: 12,
    position: [0, -y * 0.08, 0],
  });
  pole.name = `counter-${entry.id}-pole`;
  node.add(pole);
  const hinge = counterBoxMesh(set, entry.material, [x * 0.72, y * 0.14, z * 0.5], `counter-${entry.id}-hinge`, {
    position: [0, y * 0.4, 0],
  });
  node.add(hinge);
  const gland = counterCylinderMesh(set, 'bakelite', {
    radius: Math.min(x, z) * 0.1,
    height: y * 0.06,
    radialSegments: 8,
    position: [Math.min(x, z) * 0.34, -y * 0.28, -Math.min(x, z) * 0.3],
  });
  gland.name = `counter-${entry.id}-gland`;
  node.add(gland);
  return node;
}

/** Glass-fronted tablet showing the live order list; the module breathes it. */
function buildTablet(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`));
  const screenMaterial = counterFaceMaterial(set, 'tabletScreen', { side: 'double' });
  const screen = counterFaceMesh(set, 'tabletScreen', [x * 0.9, y * 0.86], `counter-${entry.id}-screen`, {
    position: [0, 0, z / 2 + 0.001],
  });
  screen.material = screenMaterial;
  node.add(screen);
  node.add(
    counterBoxMesh(set, 'chrome', [x * 0.16, 0.003, 0.006], `counter-${entry.id}-home-indicator`, {
      position: [0, -y * 0.43, z / 2 + 0.002],
    }),
  );
  const camera = counterCylinderMesh(set, 'chrome', {
    radius: 0.003,
    height: 0.003,
    radialSegments: 8,
    rotation: [Math.PI / 2, 0, 0],
    position: [0, y * 0.42, z / 2 + 0.002],
  });
  camera.name = `counter-${entry.id}-camera`;
  node.add(camera);
  cues.displayMaterials.push(screenMaterial);
  cues.displayEmissive.push(screenMaterial.emissiveIntensity);
  return node;
}

/** Contactless puck with a printed pad and an LED ring. */
function buildContactlessReader(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const body = counterCylinderMesh(set, entry.material, {
    radius: Math.min(x, z) * 0.5,
    height: y * 0.82,
    radialSegments: 18,
    position: [0, -y * 0.06, 0],
  });
  body.name = `counter-${entry.id}-body`;
  node.add(body);
  const ringMaterial = counterFaceMaterial(set, 'led', { emissive: 0x7fe0ff, emissiveIntensity: 1 });
  const ring = counterCylinderMesh(set, 'led', {
    radius: Math.min(x, z) * 0.42,
    height: y * 0.5,
    radialSegments: 18,
    position: [0, y * 0.34, 0],
  });
  ring.material = ringMaterial;
  ring.name = `counter-${entry.id}-led-ring`;
  node.add(ring);
  const pad = counterFaceMesh(set, entry.material, [x * 0.8, z * 0.8], `counter-${entry.id}-pad`, {
    position: [0, y * 0.44, 0],
    rotation: [-Math.PI / 2, 0, 0],
  });
  node.add(pad);
  cues.tapLights.push(ringMaterial);
  cues.tapLightEmissive.push(ringMaterial.emissiveIntensity);
  return node;
}

/** Acrylic tap disc: the module scales and lights it for each acknowledgement. */
function buildTapTarget(
  entry: PlacedCounterProp,
  set: CounterMaterialSet,
  cues: CounterCueRegistry,
): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const disc = counterCylinderMesh(set, entry.material, {
    radius: Math.min(x, z) * 0.5,
    height: y,
    radialSegments: 18,
  });
  disc.name = `counter-${entry.id}-disc`;
  node.add(disc);
  const emblem = counterFaceMesh(set, entry.material, [x * 0.7, z * 0.7], `counter-${entry.id}-emblem`, {
    position: [0, y * 0.6, 0],
    rotation: [-Math.PI / 2, 0, 0],
  });
  node.add(emblem);
  cues.tapRings.push(node);
  return node;
}

/** Printed QR ordering card in a low chrome holder. */
function buildQrCard(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(
    counterBoxMesh(set, entry.trim ?? 'chrome', [x * 0.8, y * 0.1, z * 1.8], `counter-${entry.id}-holder`, {
      position: [0, -y * 0.45, 0],
    }),
  );
  node.add(
    counterFaceMesh(set, entry.material, [x, y * 0.9], `counter-${entry.id}-card`, {
      position: [0, y * 0.05, z * 0.5 + 0.001],
      rotation: [-0.14, 0, 0],
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
  node.add(
    counterFaceMesh(set, 'label', [radius * 1.5, y * 0.28], `counter-${entry.id}-label`, {
      position: [0, -y * 0.02, radius + 0.001],
    }),
  );
  return node;
}

/** Compact felt-lined coin tray kept in the operator row. */
function buildCoinTray(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(counterBoxMesh(set, entry.material, [x, y, z], `counter-${entry.id}-body`));
  node.add(
    counterBoxMesh(set, entry.trim ?? 'steel', [x * 0.92, y * 0.5, z * 0.88], `counter-${entry.id}-rim`, {
      position: [0, y * 0.2, 0],
    }),
  );
  const dividerGeometry = new THREE.BoxGeometry(0.004, y * 0.8, z * 0.8);
  for (let index = 1; index < 4; index += 1) {
    const divider = new THREE.Mesh(dividerGeometry, counterMaterial(set, entry.trim ?? 'steel'));
    divider.name = `counter-${entry.id}-divider-${index}`;
    divider.position.set(-x / 2 + (x * index) / 4, 0, 0);
    node.add(divider);
  }
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

/** Braided lead clipped flat along the island edge. */
function buildCable(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  const lead = counterCylinderMesh(set, entry.material, {
    radius: y * 0.4,
    height: z * 0.92,
    radialSegments: 8,
    rotation: [Math.PI / 2, 0, 0],
  });
  lead.name = `counter-${entry.id}-lead`;
  node.add(lead);
  const connector = counterBoxMesh(set, 'bakelite', [x * 1.6, y * 1.4, 0.02], `counter-${entry.id}-connector`, {
    position: [0, 0, -z * 0.44],
  });
  node.add(connector);
  const clip = counterBoxMesh(set, 'chrome', [x * 2.2, y * 0.6, z * 0.12], `counter-${entry.id}-clip`, {
    position: [0, 0, z * 0.1],
  });
  node.add(clip);
  return node;
}

/**
 * Floor-standing pick-up shelf, orientated to open into the room: it stands
 * against the right-hand wall, so its back (two posts) faces the wall (+x) and
 * its printed header and order tickets face the customer (-x).
 */
function buildPickupShelf(entry: PlacedCounterProp, set: CounterMaterialSet): THREE.Group {
  const node = group(`counter-${entry.id}`);
  const { x, y, z } = entry.size;
  node.add(
    counterBoxMesh(set, entry.material, [x, y * 0.03, z], `counter-${entry.id}-base`, {
      position: [0, -y / 2 + y * 0.015, 0],
    }),
  );
  const uprightGeometry = new THREE.BoxGeometry(x * 0.06, y * 0.94, z * 0.06);
  for (const side of [-1, 1]) {
    const upright = new THREE.Mesh(uprightGeometry, counterMaterial(set, entry.material));
    upright.name = `counter-${entry.id}-upright-${side < 0 ? 'left' : 'right'}`;
    upright.position.set(x * 0.42, 0, side * z * 0.4);
    node.add(upright);
  }
  for (const height of [0.3, 0.58]) {
    node.add(
      counterBoxMesh(set, entry.material, [x * 0.9, y * 0.03, z], `counter-${entry.id}-board-${height}`, {
        position: [0, -y / 2 + y * height, 0],
      }),
    );
  }
  node.add(
    counterFaceMesh(set, 'label', [z * 0.9, y * 0.14], `counter-${entry.id}-header`, {
      position: [-x * 0.48, y * 0.36, 0],
      rotation: [0, -Math.PI / 2, 0],
    }),
  );
  const ticketMaterial = counterMaterial(set, entry.trim ?? 'receiptPaper');
  const ticketGeometry = new THREE.BoxGeometry(0.004, y * 0.1, z * 0.5);
  for (let index = 0; index < 3; index += 1) {
    const ticket = new THREE.Mesh(ticketGeometry, ticketMaterial);
    ticket.name = `counter-${entry.id}-ticket-${index + 1}`;
    ticket.rotation.x = (index - 1) * 0.04;
    ticket.position.set(-x * 0.3, -y / 2 + y * 0.605, z * 0.16 * (index - 1));
    node.add(ticket);
  }
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
    case 'tablet-stand':
      return buildTabletStand(entry, materials);
    case 'tablet':
      return buildTablet(entry, materials, cues);
    case 'contactless-reader':
      return buildContactlessReader(entry, materials, cues);
    case 'tap-target':
      return buildTapTarget(entry, materials, cues);
    case 'qr-card':
      return buildQrCard(entry, materials);
    case 'tip-jar':
      return buildTipJar(entry, materials);
    case 'coin-tray':
      return buildCoinTray(entry, materials);
    case 'printed-label':
      return buildPrintedLabel(entry, materials);
    case 'cable':
      return buildCable(entry, materials);
    case 'pickup-shelf':
      return buildPickupShelf(entry, materials);
    default:
      return null;
  }
}

/** Builds the whole 2025 counter into the module's group. */
export function buildTabletContactless(input: CounterDeviceBuildInput): CounterDeviceBuildResult {
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

/** The tablet-and-contactless builder, as the module's registry expects it. */
export const tabletContactlessDevice: CounterDeviceBuilder = Object.freeze({
  family: 'tablet-contactless' as const,
  build: buildTabletContactless,
});
