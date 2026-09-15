/**
 * Soft decor — the textiles, greenery and table-top dressing that carry an era
 * as much as its joinery: the runner rugs under the tables, the window curtains
 * or blinds hung inside the storefront, the potted plants and the table-top
 * setting (cruet, caddy, napkin holder, bud vase, menu card, ashtray, carafe).
 *
 * Placement rules
 * ---------------
 *  - **Rugs** run under each table column, from the first to the last row, and
 *    stop short of the service lane and the banquettes.
 *  - **Curtains and blinds** hang inside the storefront glazing, one panel per
 *    bay, clear of the entrance bay so the doorway and its swing stay empty.
 *  - **Plants** stand in the window corner, flank the counter ends and sit as
 *    small pots on the counter top.
 *  - **Table-top decor** is spread on the era's tables by a deterministic
 *    golden-angle ring (or along the length of a communal run), always inside
 *    the table top so tableware and patrons never collide with it.
 */

import * as THREE from 'three';
import type { RoomPoint } from '../../contracts/period';
import type { FurnitureBuildInput, FurniturePlanInput, PlacedProp, PropBuildResult, PlantSpec, PropPlanEntry, PropSize } from './FurnitureModule';
import { boxMesh, cylinderMesh, furnitureMaterial, sphereMesh, torusMesh } from './materials';
import { countMeshes, tableAnchors } from './tables';

/** Runner width and border as fractions of the rug footprint. */
const RUG_BORDER = 0.07;
/** How far inside the storefront the window treatment hangs. */
const WINDOW_INSET = 0.16;
/** Plant positions per placement rule. */
const PLANT_POSITIONS = Object.freeze({
  'window-corner': Object.freeze([Object.freeze({ x: -4.15, z: 4.75 })]),
  'counter-end': Object.freeze([
    Object.freeze({ x: -3.85, z: -4.72 }),
    Object.freeze({ x: 3.85, z: -4.72 }),
  ]),
  'counter-top': Object.freeze([
    Object.freeze({ x: -3.05, z: -5.0 }),
    Object.freeze({ x: 3.05, z: -5.0 }),
  ]),
} as const);

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

function entry(
  id: string,
  kind: PropPlanEntry['kind'],
  label: string,
  center: RoomPoint,
  size: PropSize,
  rotationY: number,
  support: PropPlanEntry['support'],
  tags: readonly string[],
): PropPlanEntry {
  return { id, kind, group: 'softDecor', label, center, size, rotationY, support, tags };
}

/** The runner rugs under each table column. */
export function rugZones(input: FurniturePlanInput): readonly { id: string; center: RoomPoint; size: PropSize }[] {
  const { rug } = input.spec.softDecor;
  const anchors = tableAnchors(input);
  const columns = [...new Set(anchors.map((anchor) => anchor.column))].sort((a, b) => a - b);
  const minZ = Math.min(...anchors.map((anchor) => anchor.position.z));
  const maxZ = Math.max(...anchors.map((anchor) => anchor.position.z));
  return columns.map((column) => {
    const ofColumn = anchors.filter((anchor) => anchor.column === column);
    const centreX = ofColumn.reduce((total, anchor) => total + anchor.position.x, 0) / ofColumn.length;
    const length = maxZ - minZ + 1.0;
    return {
      id: `furniture:rug-c${column}`,
      center: { x: centreX, y: 0, z: (minZ + maxZ) / 2 },
      size: { x: rug.width, y: 0.016, z: length },
    };
  });
}

/** One curtain panel or blind per glazing bay, hung inside the storefront. */
export function windowTreatmentZones(
  input: FurniturePlanInput,
): readonly { id: string; bay: string; center: RoomPoint; size: PropSize }[] {
  const { windowTreatment } = input.spec.softDecor;
  const z = input.bounds.depth / 2 - WINDOW_INSET;
  return input.layout.glazingZones.map((bay: { id: string; position: RoomPoint; width: number; height: number; sillHeight: number }) => {
    const drop = Math.max(bay.height * windowTreatment.coverage, 0.3);
    const top = bay.sillHeight + bay.height;
    return {
      id: `furniture:${windowTreatment.kind === 'roller-blinds' || windowTreatment.kind.includes('blinds') ? 'blind' : 'curtain'}-${bay.id.replace('storefront-glazing-', '')}`,
      bay: bay.id,
      center: { x: bay.position.x, y: top - drop / 2, z },
      size: { x: bay.width * 0.94, y: drop, z: 0.07 },
    };
  });
}

/** Every soft-decor placement of one era, without building anything. */
export function planSoftDecor(input: FurniturePlanInput): readonly PropPlanEntry[] {
  const { softDecor } = input.spec;
  const entries: PropPlanEntry[] = [];

  for (const zone of rugZones(input)) {
    entries.push(
      entry(zone.id, 'rug', softDecor.rug.style, { ...zone.center, y: zone.size.y / 2 }, zone.size, 0, 'floor', [
        softDecor.rug.kind,
      ]),
    );
  }

  for (const zone of windowTreatmentZones(input)) {
    const blind = softDecor.windowTreatment.kind !== 'lace-and-pelmet' && softDecor.windowTreatment.kind !== 'cafe-curtains';
    entries.push(
      entry(
        zone.id,
        blind ? 'blind' : 'curtain',
        softDecor.windowTreatment.style,
        zone.center,
        zone.size,
        0,
        'elevated',
        [softDecor.windowTreatment.kind, `bay:${zone.bay}`],
      ),
    );
  }

  for (const plant of softDecor.plants) {
    const positions = PLANT_POSITIONS[plant.placement];
    const elevated = plant.placement === 'counter-top';
    const canopy = canopyOf(plant);
    for (let index = 0; index < positions.length && index < plant.count; index += 1) {
      const spot = positions[index];
      if (!spot) continue;
      const base = elevated ? input.layout.counter.surfaceHeight : 0;
      entries.push(
        entry(
          `furniture:plant-${plant.placement}-${index + 1}`,
          'plant',
          plant.style,
          { x: spot.x, y: base + plant.height / 2, z: spot.z },
          { x: canopy, y: plant.height, z: canopy },
          0,
          elevated ? 'elevated' : 'floor',
          [plant.kind, plant.placement],
        ),
      );
    }
  }

  for (const anchor of tableAnchors(input)) {
    const items = softDecor.tableDecor.slice(0, 4);
    const long = anchor.halfZ > 0.6;
    items.forEach((item, index) => {
      const spread = long ? 0.55 : 0.2;
      const angle = index * 2.399963 + anchor.column;
      const offsetX = long ? Math.cos(angle) * 0.16 : Math.cos(angle) * spread;
      const offsetZ = long ? (index - (items.length - 1) / 2) * spread : Math.sin(angle) * spread;
      entries.push(
        entry(
          `furniture:decor:${anchor.column}-${anchor.row}-${item.kind}`,
          'table-decor',
          item.label,
          {
            x: anchor.position.x + offsetX,
            y: anchor.surfaceHeight + item.size[1] / 2,
            z: anchor.position.z + offsetZ,
          },
          { x: item.size[0], y: item.size[1], z: item.size[2] },
          0,
          'elevated',
          [item.kind],
        ),
      );
    });
  }

  return entries;
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

function partName(id: string, part: string): string {
  return `${id}:${part}`;
}

function buildRug(
  zone: { id: string; center: RoomPoint; size: PropSize },
  input: FurnitureBuildInput,
): THREE.Group {
  const { rug } = input.spec.softDecor;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'rug';
  const pile = furnitureMaterial(input.materials, rug.slot);
  const border = furnitureMaterial(input.materials, rug.borderSlot);
  const width = zone.size.x;
  const length = zone.size.z;
  const borderWidth = Math.min(width, length) * RUG_BORDER;

  group.add(
    boxMesh([width, 0.014, length], pile, {
      name: partName(zone.id, 'pile'),
      part: 'rug-pile',
      position: [0, 0.007, 0],
    }),
    // A woven border band inside the pile, then a whipped edge.
    boxMesh([width, 0.017, borderWidth], border, {
      name: partName(zone.id, 'border'),
      part: 'rug-border',
      position: [0, 0.0085, -length / 2 + borderWidth / 2],
    }),
    boxMesh([width, 0.017, borderWidth], border, {
      name: partName(zone.id, 'border'),
      part: 'rug-border',
      position: [0, 0.0085, length / 2 - borderWidth / 2],
    }),
    boxMesh([borderWidth, 0.017, length - borderWidth * 2], border, {
      name: partName(zone.id, 'border'),
      part: 'rug-border',
      position: [-width / 2 + borderWidth / 2, 0.0085, 0],
    }),
    boxMesh([borderWidth, 0.017, length - borderWidth * 2], border, {
      name: partName(zone.id, 'border'),
      part: 'rug-border',
      position: [width / 2 - borderWidth / 2, 0.0085, 0],
    }),
  );

  if (rug.fringe) {
    const tufts = Math.max(Math.round(width / 0.12), 4);
    for (let index = 0; index < tufts; index += 1) {
      const x = -width / 2 + (width / tufts) * (index + 0.5);
      for (const end of [-1, 1]) {
        group.add(
          boxMesh([0.03, 0.006, 0.05], border, {
            name: partName(zone.id, 'fringe'),
            part: 'rug-fringe',
            position: [x, 0.003, end * (length / 2 + 0.024)],
          }),
        );
      }
    }
  }

  return group;
}

function buildWindowTreatment(
  zone: { id: string; center: RoomPoint; size: PropSize },
  input: FurnitureBuildInput,
): THREE.Group {
  const { windowTreatment } = input.spec.softDecor;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'window-treatment';
  const panel = furnitureMaterial(input.materials, windowTreatment.panelSlot);
  const trim = furnitureMaterial(input.materials, windowTreatment.trimSlot);
  const width = zone.size.x;
  const drop = zone.size.y;
  const halfDrop = drop / 2;
  const slats = Math.max(windowTreatment.slats, 4);

  switch (windowTreatment.kind) {
    case 'vertical-blinds':
    case 'roller-blinds': {
      group.add(
        boxMesh([width + 0.06, 0.07, 0.09], trim, {
          name: partName(zone.id, 'headrail'),
          part: 'blind-headrail',
          position: [0, halfDrop - 0.035, 0],
        }),
      );
      if (windowTreatment.kind === 'vertical-blinds') {
        const pitch = width / slats;
        for (let index = 0; index < slats; index += 1) {
          group.add(
            boxMesh([pitch * 0.92, drop - 0.09, 0.012], panel, {
              name: partName(zone.id, 'slat'),
              part: 'blind-slat',
              position: [-width / 2 + pitch * (index + 0.5), -0.045, 0.005],
              rotation: [0, index % 2 === 0 ? 0.22 : -0.22, 0],
            }),
          );
        }
      } else {
        group.add(
          boxMesh([width, drop - 0.1, 0.01], panel, {
            name: partName(zone.id, 'sheet'),
            part: 'blind-sheet',
            position: [0, -0.05, 0],
          }),
          boxMesh([width + 0.02, 0.03, 0.04], trim, {
            name: partName(zone.id, 'bottom-bar'),
            part: 'blind-bottom-bar',
            position: [0, -halfDrop + 0.02, 0],
          }),
          cylinderMesh(0.012, 0.012, 0.22, trim, {
            name: partName(zone.id, 'chain'),
            part: 'blind-chain',
            position: [width / 2 - 0.04, halfDrop - 0.16, 0.03],
          }, 8),
        );
      }
      break;
    }

    case 'timber-venetian-blinds': {
      group.add(
        boxMesh([width + 0.06, 0.08, 0.1], trim, {
          name: partName(zone.id, 'headrail'),
          part: 'blind-headrail',
          position: [0, halfDrop - 0.04, 0],
        }),
      );
      const pitch = (drop - 0.12) / slats;
      for (let index = 0; index < slats; index += 1) {
        group.add(
          boxMesh([width, pitch * 0.62, 0.05], panel, {
            name: partName(zone.id, 'slat'),
            part: 'blind-slat',
            position: [0, halfDrop - 0.1 - pitch * index, 0],
            rotation: [0.4, 0, 0],
          }),
        );
      }
      for (const x of [-width * 0.3, width * 0.3]) {
        group.add(
          boxMesh([0.02, drop - 0.12, 0.055], trim, {
            name: partName(zone.id, 'tape'),
            part: 'blind-tape',
            position: [x, -0.05, 0],
          }),
        );
      }
      group.add(
        boxMesh([width, 0.035, 0.06], trim, {
          name: partName(zone.id, 'bottom-rail'),
          part: 'blind-bottom-bar',
          position: [0, -halfDrop + 0.03, 0],
        }),
      );
      break;
    }

    default: {
      // Café curtains and lace nets: a rod, gathered panels and a pelmet.
      group.add(
        cylinderMesh(0.014, 0.014, width + 0.1, trim, {
          name: partName(zone.id, 'rod'),
          part: 'curtain-rod',
          position: [0, halfDrop - 0.02, 0],
          rotation: [0, 0, Math.PI / 2],
        }, 12),
      );
      for (const end of [-1, 1]) {
        group.add(
          sphereMesh(0.028, trim, {
            name: partName(zone.id, 'finial'),
            part: 'curtain-finial',
            position: [end * (width / 2 + 0.06), halfDrop - 0.02, 0],
          }),
        );
      }
      const panels = windowTreatment.kind === 'lace-and-pelmet' ? 2 : 2;
      for (let index = 0; index < panels; index += 1) {
        const sign = index === 0 ? -1 : 1;
        group.add(
          boxMesh([width * 0.44, drop - 0.06, 0.03], panel, {
            name: partName(zone.id, 'panel'),
            part: 'curtain-panel',
            position: [sign * width * 0.26, -drop * 0.53 + halfDrop - 0.06, 0],
            scale: [0.92, 1, 1],
          }),
          // A gather of folds: three thin vertical pleats per panel.
          ...[-1, 0, 1].map((fold) =>
            boxMesh([0.02, drop - 0.12, 0.045], panel, {
              name: partName(zone.id, 'pleat'),
              part: 'curtain-pleat',
              position: [sign * width * 0.26 + fold * 0.07, -drop * 0.53 + halfDrop - 0.08, 0.005],
            }),
          ),
        );
      }
      if (windowTreatment.pelmet) {
        group.add(
          boxMesh([width + 0.08, 0.16, 0.09], panel, {
            name: partName(zone.id, 'pelmet'),
            part: 'curtain-pelmet',
            position: [0, halfDrop - 0.09, 0.01],
          }),
        );
      }
      break;
    }
  }

  return group;
}

/**
 * Canopy diameter of a potted plant in metres: how much floor (or counter) the
 * foliage spreads over, derived from the pot radius and the plant family.
 */
function canopyOf(plant: PlantSpec): number {
  const slender = plant.kind === 'aspidistra' || plant.kind === 'spider-plant';
  return plant.potRadius * (slender ? 2.2 : 2.6);
}

function buildPlant(
  zone: PropPlanEntry,
  input: FurnitureBuildInput,
  index: number,
): THREE.Group {
  const plant = input.spec.softDecor.plants.find((candidate) => zone.tags.includes(candidate.kind));
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'plant';
  if (!plant) return group;
  const leaf = furnitureMaterial(input.materials, plant.leafSlot);
  const pot = furnitureMaterial(input.materials, plant.potSlot);
  const height = plant.height;
  const radius = plant.potRadius;
  const potHeight = Math.min(height * 0.28, 0.34);
  const foliageBase = potHeight - 0.02;

  group.add(
    cylinderMesh(radius * 0.94, radius * 0.78, potHeight, pot, {
      name: partName(zone.id, 'pot'),
      part: 'plant-pot',
      position: [0, potHeight / 2, 0],
    }, 18),
    torusMesh(radius * 0.92, radius * 0.08, pot, {
      name: partName(zone.id, 'pot-rim'),
      part: 'plant-pot-rim',
      position: [0, potHeight - 0.01, 0],
      rotation: [Math.PI / 2, 0, 0],
    }, 20),
    cylinderMesh(radius * 0.86, radius * 0.86, 0.03, furnitureMaterial(input.materials, 'cork'), {
      name: partName(zone.id, 'soil'),
      part: 'plant-soil',
      position: [0, potHeight - 0.03, 0],
    }, 18),
  );

  const foliage = new THREE.Group();
  foliage.name = `furniture:foliage-${index + 1}`;
  foliage.userData.furnitureKind = 'foliage';
  foliage.position.y = foliageBase;
  const canopy = canopyOf(plant);
  const reach = canopy / 2 - 0.02;

  switch (plant.kind) {
    case 'aspidistra':
    case 'spider-plant': {
      // Arching blades: long, thin and drawn back inside the canopy.
      const blades = plant.kind === 'spider-plant' ? 14 : 10;
      const lean = plant.kind === 'spider-plant' ? 0.5 : 0.34;
      const bladeLength = Math.max(Math.min(height - potHeight, reach * 2.4), 0.18);
      for (let blade = 0; blade < blades; blade += 1) {
        const angle = (blade / blades) * Math.PI * 2 + index;
        const length = bladeLength * (0.78 + ((blade * 7) % 5) * 0.06);
        foliage.add(
          boxMesh([0.05, length, 0.012], leaf, {
            name: partName(zone.id, 'blade'),
            part: 'plant-blade',
            position: [
              Math.cos(angle) * reach * 0.42,
              length * 0.48,
              Math.sin(angle) * reach * 0.42,
            ],
            rotation: [Math.sin(angle) * lean, -angle, -Math.cos(angle) * lean],
            castShadow: true,
          }),
        );
      }
      break;
    }

    case 'monstera':
    case 'rubber-plant':
    case 'olive-tree':
    default: {
      const trunkHeight = (height - potHeight) * 0.55;
      foliage.add(
        cylinderMesh(0.03, 0.045, trunkHeight, furnitureMaterial(input.materials, 'woodDark'), {
          name: partName(zone.id, 'trunk'),
          part: 'plant-trunk',
          position: [0, trunkHeight / 2, 0],
        }, 10),
      );
      const leaves = plant.kind === 'olive-tree' ? 12 : 8;
      const leafLength = canopy * 0.42;
      for (let leafIndex = 0; leafIndex < leaves; leafIndex += 1) {
        const angle = (leafIndex / leaves) * Math.PI * 2 + index * 1.7;
        const radius = canopy * (0.18 + ((leafIndex * 5) % 4) * 0.02);
        const leafY = trunkHeight + ((leafIndex * 3) % 4) * 0.06;
        foliage.add(
          boxMesh([leafLength, 0.045, leafLength * 0.6], leaf, {
            name: partName(zone.id, 'leaf'),
            part: 'plant-leaf',
            position: [Math.cos(angle) * radius, leafY, Math.sin(angle) * radius],
            rotation: [0.14, -angle, 0.1 * ((leafIndex % 3) - 1)],
          }),
        );
      }
      break;
    }
  }

  group.add(foliage);
  group.userData.foliageNode = foliage.name;
  return group;
}

function buildTableDecor(
  zone: PropPlanEntry,
  input: FurnitureBuildInput,
): THREE.Group {
  const item = input.spec.softDecor.tableDecor.find((candidate) => zone.tags.includes(candidate.kind));
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'table-decor';
  if (!item) return group;
  const material = furnitureMaterial(input.materials, item.slot);
  const [width, height, depth] = item.size;

  switch (item.kind) {
    case 'sugar-bowl':
      group.add(
        cylinderMesh(width * 0.42, width * 0.34, height * 0.7, material, {
          name: partName(zone.id, 'bowl'),
          part: 'decor-bowl',
          position: [0, height * 0.35, 0],
        }, 16),
        cylinderMesh(width * 0.46, width * 0.46, 0.012, material, {
          name: partName(zone.id, 'lid'),
          part: 'decor-lid',
          position: [0, height * 0.72, 0],
        }, 16),
      );
      break;

    case 'condiment-set':
    case 'cruet':
      for (const sign of [-1, 1]) {
        group.add(
          cylinderMesh(width * 0.16, width * 0.19, height * 0.86, material, {
            name: partName(zone.id, 'cruet'),
            part: 'decor-cruet',
            position: [sign * width * 0.2, height * 0.43, 0],
          }, 12),
          sphereMesh(width * 0.11, material, {
            name: partName(zone.id, 'cruet-cap'),
            part: 'decor-cruet',
            position: [sign * width * 0.2, height * 0.9, 0],
          }),
        );
      }
      break;

    case 'ketchup-bottle':
    case 'sauce-bottle':
      group.add(
        cylinderMesh(width * 0.3, width * 0.34, height * 0.8, material, {
          name: partName(zone.id, 'bottle'),
          part: 'decor-bottle',
          position: [0, height * 0.4, 0],
        }, 14),
        cylinderMesh(width * 0.12, width * 0.1, height * 0.2, material, {
          name: partName(zone.id, 'cap'),
          part: 'decor-bottle-cap',
          position: [0, height * 0.9, 0],
        }, 10),
      );
      break;

    case 'bud-vase':
    case 'flower-vase': {
      const stems = item.kind === 'bud-vase' ? 1 : 3;
      group.add(
        cylinderMesh(width * 0.4, width * 0.3, height * 0.62, material, {
          name: partName(zone.id, 'vase'),
          part: 'decor-vase',
          position: [0, height * 0.31, 0],
        }, 16),
      );
      for (let stem = 0; stem < stems; stem += 1) {
        const angle = (stem / stems) * Math.PI * 2;
        group.add(
          cylinderMesh(0.005, 0.005, height * 0.34, furnitureMaterial(input.materials, 'foliage'), {
            name: partName(zone.id, 'stem'),
            part: 'decor-stem',
            position: [Math.cos(angle) * 0.02, height * 0.78, Math.sin(angle) * 0.02],
            rotation: [Math.sin(angle) * 0.3, 0, -Math.cos(angle) * 0.3],
          }, 8),
          sphereMesh(width * 0.18, material, {
            name: partName(zone.id, 'flower'),
            part: 'decor-flower',
            position: [Math.cos(angle) * 0.05, height * 0.96, Math.sin(angle) * 0.05],
          }, 12),
        );
      }
      break;
    }

    case 'napkin-holder':
      group.add(
        boxMesh([width, height, depth], material, {
          name: partName(zone.id, 'holder'),
          part: 'decor-holder',
          position: [0, height / 2, 0],
        }),
        boxMesh([width * 0.96, height * 1.5, depth * 0.7], furnitureMaterial(input.materials, 'fabric'), {
          name: partName(zone.id, 'napkins'),
          part: 'decor-napkins',
          position: [0, height * 1.2, 0],
          rotation: [0, 0, 0.05],
        }),
      );
      break;

    case 'menu-card':
      group.add(
        boxMesh([width, height, 0.006], material, {
          name: partName(zone.id, 'menu'),
          part: 'decor-menu',
          position: [0, height / 2, 0],
          rotation: [-0.22, 0, 0],
        }),
        boxMesh([width * 0.9, height * 0.16, 0.008], furnitureMaterial(input.materials, 'accent'), {
          name: partName(zone.id, 'menu-heading'),
          part: 'decor-menu-heading',
          position: [0, height * 0.78, 0.02],
          rotation: [-0.22, 0, 0],
        }),
      );
      break;

    case 'table-number':
      group.add(
        boxMesh([width, height, depth], material, {
          name: partName(zone.id, 'number'),
          part: 'decor-number',
          position: [0, height / 2, 0],
          rotation: [-0.12, 0, 0],
        }),
      );
      break;

    case 'ashtray':
      group.add(
        cylinderMesh(width * 0.44, width * 0.4, height, material, {
          name: partName(zone.id, 'ashtray'),
          part: 'decor-ashtray',
          position: [0, height / 2, 0],
        }, 16),
        cylinderMesh(width * 0.3, width * 0.3, 0.008, furnitureMaterial(input.materials, 'wornMetal'), {
          name: partName(zone.id, 'ashtray-inner'),
          part: 'decor-ashtray-inner',
          position: [0, height * 0.8, 0],
        }, 16),
      );
      break;

    case 'succulent-pot':
      group.add(
        cylinderMesh(width * 0.44, width * 0.34, height * 0.5, furnitureMaterial(input.materials, 'terracotta'), {
          name: partName(zone.id, 'pot'),
          part: 'decor-pot',
          position: [0, height * 0.25, 0],
        }, 14),
        sphereMesh(width * 0.32, furnitureMaterial(input.materials, 'foliage'), {
          name: partName(zone.id, 'rosette'),
          part: 'decor-rosette',
          position: [0, height * 0.66, 0],
        }, 12),
      );
      break;

    case 'water-carafe':
      group.add(
        cylinderMesh(width * 0.4, width * 0.44, height * 0.72, material, {
          name: partName(zone.id, 'carafe'),
          part: 'decor-carafe',
          position: [0, height * 0.36, 0],
        }, 16),
        cylinderMesh(width * 0.16, width * 0.3, height * 0.24, material, {
          name: partName(zone.id, 'neck'),
          part: 'decor-carafe-neck',
          position: [0, height * 0.84, 0],
        }, 12),
      );
      break;

    case 'tea-light':
    default:
      group.add(
        cylinderMesh(width * 0.4, width * 0.4, height * 0.8, material, {
          name: partName(zone.id, 'cup'),
          part: 'decor-tea-light',
          position: [0, height * 0.4, 0],
        }, 14),
        sphereMesh(width * 0.2, furnitureMaterial(input.materials, 'lamp'), {
          name: partName(zone.id, 'flame'),
          part: 'decor-flame',
          position: [0, height * 0.92, 0],
        }, 10),
      );
      break;
  }

  return group;
}

/** Raises the meshes for the planned soft-decor entries. */
export function buildSoftDecor(
  input: FurnitureBuildInput,
  entries: readonly PropPlanEntry[],
): PropBuildResult {
  const group = new THREE.Group();
  group.name = 'furniture-soft-decor';
  const props: PlacedProp[] = [];
  const landmarks: Record<string, THREE.Object3D> = {};
  const rugs = new Set(rugZones(input).map((zone) => zone.id));
  const treatments = new Set(windowTreatmentZones(input).map((zone) => zone.id));
  let foliageIndex = 0;

  for (const entry of entries) {
    let node: THREE.Group | null = null;
    if (rugs.has(entry.id)) {
      node = buildRug({ id: entry.id, center: entry.center, size: entry.size }, input);
    } else if (treatments.has(entry.id)) {
      node = buildWindowTreatment({ id: entry.id, center: entry.center, size: entry.size }, input);
    } else if (entry.kind === 'plant') {
      node = buildPlant(entry, input, foliageIndex);
      foliageIndex += 1;
    } else if (entry.kind === 'table-decor') {
      node = buildTableDecor(entry, input);
    }
    if (!node) continue;

    // Rugs, plants and table-top decor are modelled from their base up; the
    // window treatments are modelled around their mount centre.
    const baseUp = entry.kind === 'rug' || entry.kind === 'plant' || entry.kind === 'table-decor';
    node.position.set(
      entry.center.x,
      baseUp ? entry.center.y - entry.size.y / 2 : entry.center.y,
      entry.center.z,
    );
    node.rotation.y = entry.rotationY;
    group.add(node);
    props.push({ ...entry, node });
    if (entry.kind === 'rug') landmarks[entry.id] = node;
    if (entry.kind === 'plant') landmarks[`plant-${foliageIndex}`] = node;
    if (entry.kind === 'curtain' || entry.kind === 'blind') landmarks[entry.id] = node;
  }

  return { group, props, landmarks, meshCount: countMeshes(group) };
}
