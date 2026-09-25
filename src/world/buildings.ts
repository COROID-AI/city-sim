/**
 * Parametric building generator.
 *
 * Produces highly detailed facades rather than boxes: base massing, instanced
 * window units with mullions and sills, cornices and string courses, pilasters,
 * a recessed ground-floor shop bay, fire escapes (1945/1965), rooftop water
 * towers (1945/1965), rooftop condensers, antenna masts, satellite dishes
 * (1985+), roof billboard frames, art-deco / modern setback massing, and roof
 * gardens with solar arrays for 2025.
 *
 * Silhouette, facade palette and roof furniture all come from the era's
 * {@link ArchitectureSpec}, which is what makes the skyline change wholesale
 * between the five years.
 */

import * as THREE from 'three';
import { STOREY_HEIGHT, eraSubtitle, type FacadeStyle, type Hex } from '../config/types';
import { buildingSlots, type BuildingSlot } from './roads';
import type { TextureKind, WorldKit } from './textures';

export interface BuildingRecord {
  group: THREE.Group;
  slot: BuildingSlot;
  floors: number;
  height: number;
  style: FacadeStyle;
  /** Plausible year the building was put up, used for period micro-copy. */
  builtYear: number;
  label: string;
  /** Facade anchor point facing the street (used for signage and focus). */
  frontage: THREE.Vector3;
  hasWaterTower: boolean;
  hasFireEscape: boolean;
  hasRoofBillboard: boolean;
  hasSolarArray: boolean;
}

export interface BuildingsBuild {
  group: THREE.Group;
  records: BuildingRecord[];
  waterTowers: number;
  fireEscapes: number;
  roofBillboards: number;
  solarArrays: number;
}

const STYLE_TEXTURE: Record<FacadeStyle, TextureKind> = {
  'art-deco': 'stucco',
  brick: 'brick',
  brownstone: 'brownstone',
  stucco: 'stucco',
  'mid-century': 'tile',
  concrete: 'stucco',
  'glass-steel': 'glass',
  'glass-tower': 'glass',
};

const STYLE_LABEL: Record<FacadeStyle, string> = {
  'art-deco': 'art-deco tower',
  brick: 'brick walk-up',
  brownstone: 'brownstone row house',
  stucco: 'stucco apartment block',
  'mid-century': 'mid-century office slab',
  concrete: 'concrete office block',
  'glass-steel': 'glass-and-steel infill tower',
  'glass-tower': 'glass curtain-wall tower',
};

function isGlass(style: FacadeStyle): boolean {
  return style === 'glass-steel' || style === 'glass-tower';
}

function pickStyle(kit: WorldKit, slot: BuildingSlot): FacadeStyle {
  const styles = kit.era.architecture.styles;
  if (slot.landmark) {
    // Landmarks always take the most modern / tallest style of the era.
    return styles[0];
  }
  if (slot.ring === 3) {
    // The outer skyline ring leans modern so the era silhouette is obvious.
    return styles[Math.min(1, styles.length - 1)];
  }
  return kit.rng.pick(styles);
}

/** Window unit geometry keyed by era window style. */
function windowSize(style: FacadeStyle, windowStyle: string): { w: number; h: number } {
  if (windowStyle === 'curtain-wall') return { w: 2.2, h: 2.6 };
  if (windowStyle === 'ribbon') return { w: 2.6, h: 1.5 };
  if (windowStyle === 'awning') return { w: 1.9, h: 1.7 };
  if (isGlass(style)) return { w: 2.1, h: 2.4 };
  return { w: 1.5, h: 1.7 };
}

function addWindowGrid(
  kit: WorldKit,
  group: THREE.Group,
  params: {
    width: number;
    depth: number;
    floors: number;
    color: Hex;
    style: FacadeStyle;
    litRatio: number;
  },
): void {
  const { width, depth, floors, color, style, litRatio } = params;
  const size = windowSize(style, kit.era.architecture.windowStyle);
  const colsX = Math.max(2, Math.floor(width / 3.2));
  const colsZ = Math.max(2, Math.floor(depth / 3.2));
  const spacingX = width / colsX;
  const spacingZ = depth / colsZ;
  const perBuilding = (colsX * 2 + colsZ * 2) * floors;
  if (perBuilding <= 0) return;

  const lit = kit.rng.chance(litRatio);
  const windowMaterial = lit
    ? kit.library.neon(color, 0.5 + kit.rng.next() * 0.4)
    : kit.library.glass(color, isGlass(style) ? 0.5 : 0.42);
  const geometry = kit.geometry.box(size.w, size.h, 0.22);
  const mesh = new THREE.InstancedMesh(geometry, windowMaterial, perBuilding);
  mesh.name = 'windows';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3(1, 1, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const sideRotation = new THREE.Quaternion().setFromAxisAngle(yAxis, Math.PI / 2);
  let index = 0;
  const groundFloor = floors > 1 ? 1 : 0;
  for (let floor = groundFloor; floor < floors; floor += 1) {
    const y = floor * STOREY_HEIGHT + STOREY_HEIGHT * 0.55;
    for (let c = 0; c < colsX; c += 1) {
      const x = -width / 2 + spacingX * (c + 0.5);
      // Front (+Z) and back (-Z) faces.
      position.set(x, y, depth / 2 + 0.02);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      index += 1;
      position.set(x, y, -depth / 2 - 0.02);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(index, matrix);
      index += 1;
    }
    for (let r = 0; r < colsZ; r += 1) {
      const z = -depth / 2 + spacingZ * (r + 0.5);
      position.set(width / 2 + 0.02, y, z);
      matrix.compose(position, sideRotation, scale);
      mesh.setMatrixAt(index, matrix);
      index += 1;
      position.set(-width / 2 - 0.02, y, z);
      matrix.compose(position, sideRotation, scale);
      mesh.setMatrixAt(index, matrix);
      index += 1;
    }
  }
  mesh.count = index;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.category = 'windows';
  group.add(mesh);
}

function addFireEscape(kit: WorldKit, group: THREE.Group, width: number, height: number, facingZ: number): void {
  const material = kit.library.metal('#3c3a36', 0.65);
  const floors = Math.max(2, Math.floor(height / STOREY_HEIGHT) - 1);
  for (let floor = 1; floor < floors; floor += 1) {
    const platform = new THREE.Mesh(kit.geometry.box(width * 0.42, 0.1, 1.1), material);
    platform.position.set(0, floor * STOREY_HEIGHT, facingZ);
    platform.castShadow = true;
    group.add(platform);
    const railing = new THREE.Mesh(kit.geometry.box(width * 0.42, 0.5, 0.06), material);
    railing.position.set(0, floor * STOREY_HEIGHT + 0.35, facingZ + 0.55);
    group.add(railing);
    const ladder = new THREE.Mesh(kit.geometry.box(0.1, STOREY_HEIGHT, 0.1), material);
    ladder.position.set(-width * 0.16, floor * STOREY_HEIGHT - STOREY_HEIGHT / 2, facingZ + 0.4);
    ladder.rotation.z = 0.32;
    group.add(ladder);
  }
}

function addWaterTower(kit: WorldKit, group: THREE.Group, top: number, width: number): void {
  const wood = kit.library.flat('#6a5340', { roughness: 0.95 });
  const metal = kit.library.metal('#4d4a45', 0.6);
  const tank = new THREE.Mesh(kit.geometry.cylinder(2.1, 2.4, 3.4, 14), wood);
  tank.position.set(width * 0.16, top + 4.4, 0);
  tank.castShadow = true;
  const roof = new THREE.Mesh(kit.geometry.cylinder(0.2, 2.5, 1.1, 14), wood);
  roof.position.set(width * 0.16, top + 6.6, 0);
  const base = new THREE.Mesh(kit.geometry.box(4.4, 0.3, 4.4), metal);
  base.position.set(width * 0.16, top + 2.6, 0);
  group.add(tank, roof, base);
  for (const [dx, dz] of [
    [-1.4, -1.4],
    [1.4, -1.4],
    [-1.4, 1.4],
    [1.4, 1.4],
  ]) {
    const leg = new THREE.Mesh(kit.geometry.box(0.22, 2.6, 0.22), metal);
    leg.position.set(width * 0.16 + dx, top + 1.3, dz);
    group.add(leg);
  }
}

function addRoofKit(
  kit: WorldKit,
  group: THREE.Group,
  top: number,
  width: number,
  depth: number,
): { waterTower: boolean; solarArray: boolean; roofGarden: boolean } {
  const architecture = kit.era.architecture;
  const metal = kit.library.metal('#6d7076', 0.45);
  const rng = kit.rng;
  let waterTower = false;
  let solarArray = false;
  let roofGarden = false;

  if (architecture.roofAc) {
    const units = rng.int(1, 3);
    for (let i = 0; i < units; i += 1) {
      const box = new THREE.Mesh(kit.geometry.box(1.4, 0.9, 1.4), metal);
      box.position.set(rng.range(-width / 2 + 1.4, width / 2 - 1.4), top + 0.5, rng.range(-depth / 2 + 1.4, depth / 2 - 1.4));
      box.castShadow = true;
      group.add(box);
    }
  }
  if (architecture.antennas) {
    const mast = new THREE.Mesh(kit.geometry.cylinder(0.06, 0.09, rng.range(3, 7), 6), metal);
    mast.position.set(rng.range(-width / 3, width / 3), top + 2.2, rng.range(-depth / 3, depth / 3));
    group.add(mast);
    const dish = new THREE.Mesh(kit.geometry.sphere(0.5, 10, 6), metal);
    dish.scale.set(1, 1, 0.35);
    dish.position.set(0, 1.2, 0);
    mast.add(dish);
  }
  if (architecture.satelliteDishes) {
    const count = rng.int(1, 2);
    for (let i = 0; i < count; i += 1) {
      const dish = new THREE.Mesh(kit.geometry.sphere(0.9, 12, 8), kit.library.flat('#cfcabd', { roughness: 0.7 }));
      dish.scale.set(1, 0.35, 1);
      dish.position.set(rng.range(-width / 3, width / 3), top + rng.range(0.6, 1.8), rng.range(-depth / 3, depth / 3));
      dish.rotation.z = rng.range(0.3, 0.8);
      group.add(dish);
    }
  }
  if (kit.era.year >= 2025) {
    // Roof garden + solar array instead of water tanks.
    roofGarden = true;
    solarArray = true;
    const soil = kit.library.flat('#3f5238', { roughness: 1 });
    const bed = new THREE.Mesh(kit.geometry.box(width * 0.5, 0.6, depth * 0.25), soil);
    bed.position.set(-width * 0.18, top + 0.35, 0);
    group.add(bed);
    const foliage = kit.library.flat('#4f7f4a', { roughness: 1, flatShading: true });
    for (let i = 0; i < 6; i += 1) {
      const bush = new THREE.Mesh(kit.geometry.sphere(0.5, 8, 6), foliage);
      bush.position.set(-width * 0.18 + rng.range(-width * 0.22, width * 0.22), top + 0.8, rng.range(-depth * 0.1, depth * 0.1));
      group.add(bush);
    }
    const panel = new THREE.Mesh(kit.geometry.box(width * 0.4, 0.12, depth * 0.35), kit.library.flat('#1d2733', { roughness: 0.3, metalness: 0.7 }));
    panel.position.set(width * 0.24, top + 1.1, 0);
    panel.rotation.x = -0.42;
    panel.castShadow = true;
    group.add(panel);
    for (const dx of [-width * 0.14, width * 0.14]) {
      const strut = new THREE.Mesh(kit.geometry.box(0.12, 1.1, 0.12), metal);
      strut.position.set(width * 0.24 + dx, top + 0.55, 0);
      group.add(strut);
    }
  } else if (architecture.waterTowers && kit.rng.chance(0.55)) {
    addWaterTower(kit, group, top, width);
    waterTower = true;
  }
  return { waterTower, solarArray, roofGarden };
}

function addRoofBillboard(kit: WorldKit, group: THREE.Group, top: number, width: number): void {
  const metal = kit.library.metal('#4a4a4f', 0.55);
  const frame = new THREE.Mesh(kit.geometry.box(width * 0.9, 2.6, 0.3), metal);
  frame.position.set(0, top + 2.6, 0);
  frame.rotation.y = kit.rng.chance(0.5) ? 0 : Math.PI / 2;
  group.add(frame);
  for (const dx of [-width * 0.38, width * 0.38]) {
    const leg = new THREE.Mesh(kit.geometry.box(0.2, 3.2, 0.2), metal);
    leg.position.set(frame.rotation.y === 0 ? dx : 0, top + 1.6, frame.rotation.y === 0 ? 0 : dx);
    group.add(leg);
  }
}

/** Build every building plot of the block. */
export function createBuildings(kit: WorldKit): BuildingsBuild {
  const group = new THREE.Group();
  group.name = 'buildings';
  const architecture = kit.era.architecture;
  const records: BuildingRecord[] = [];
  let waterTowers = 0;
  let fireEscapes = 0;
  let roofBillboards = 0;
  let solarArrays = 0;

  for (const slot of buildingSlots()) {
    const style = pickStyle(kit, slot);
    const floors = slot.landmark
      ? architecture.maxFloors
      : slot.ring === 3
        ? Math.round(architecture.maxFloors * kit.rng.range(0.6, 0.95))
        : kit.rng.int(architecture.minFloors, architecture.maxFloors);
    const height = floors * STOREY_HEIGHT;
    const color = kit.rng.pick(architecture.facadeColors);
    const building = new THREE.Group();
    building.name = `building:${slot.x}:${slot.z}`;
    building.position.set(slot.x, 0, slot.z);

    const textureKind = STYLE_TEXTURE[style];
    const repeat: [number, number] = [Math.max(1, Math.round(slot.width / 6)), Math.max(1, Math.round(height / 6))];
    const wallMaterial = isGlass(style)
      ? kit.library.glass(color, 0.62)
      : kit.library.wall(color, textureKind, repeat);

    // Main massing.
    const body = new THREE.Mesh(kit.geometry.box(slot.width, height, slot.depth), wallMaterial);
    body.position.y = height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    building.add(body);

    // Setback crown for art-deco and modern towers.
    if (architecture.setbacks && height > STOREY_HEIGHT * 6) {
      const crownHeight = height * 0.18;
      const crown = new THREE.Mesh(kit.geometry.box(slot.width * 0.68, crownHeight, slot.depth * 0.68), wallMaterial);
      crown.position.y = height + crownHeight / 2;
      crown.castShadow = true;
      building.add(crown);
      const crown2 = new THREE.Mesh(kit.geometry.box(slot.width * 0.38, crownHeight * 0.7, slot.depth * 0.38), wallMaterial);
      crown2.position.y = height + crownHeight + crownHeight * 0.35;
      crown2.castShadow = true;
      building.add(crown2);
      const spire = new THREE.Mesh(kit.geometry.cylinder(0.05, 0.35, 5, 6), kit.library.metal('#8f9297', 0.3));
      spire.position.y = height + crownHeight * 1.7 + 2.5;
      building.add(spire);
    }

    // Cornice / parapet.
    const corniceMaterial = isGlass(style) ? kit.library.metal('#9aa4ae', 0.35) : kit.library.flat('#6f6558', { roughness: 0.9 });
    const cornice = new THREE.Mesh(kit.geometry.box(slot.width + 0.9, 0.55, slot.depth + 0.9), corniceMaterial);
    cornice.position.y = height + 0.2;
    cornice.castShadow = true;
    building.add(cornice);

    // String course mid-height.
    const band = new THREE.Mesh(kit.geometry.box(slot.width + 0.35, 0.28, slot.depth + 0.35), corniceMaterial);
    band.position.y = Math.max(STOREY_HEIGHT * 2.2, height * 0.55);
    building.add(band);

    // Windows.
    const litRatio = kit.era.year >= 1985 ? 0.45 : 0.22;
    addWindowGrid(kit, building, {
      width: slot.width,
      depth: slot.depth,
      floors,
      color: isGlass(style) ? '#cfe4f2' : '#f2e2b8',
      style,
      litRatio,
    });

    // Ground-floor shop bay on the facing side.
    const bayMaterial = kit.library.flat('#2a2b2e', { roughness: 0.85 });
    const bay = new THREE.Mesh(kit.geometry.box(slot.width - 0.6, STOREY_HEIGHT * 0.92, 0.4), bayMaterial);
    if (slot.facing === 'x') {
      bay.rotation.y = Math.PI / 2;
      bay.position.set((slot.facingSign * slot.width) / 2 + slot.facingSign * 0.25, STOREY_HEIGHT * 0.46, 0);
    } else {
      bay.position.set(0, STOREY_HEIGHT * 0.46, (slot.facingSign * slot.depth) / 2 + slot.facingSign * 0.25);
    }
    building.add(bay);

    // Facade pilasters for the pre-war styles.
    if (!isGlass(style) && kit.era.year <= 1965) {
      const pilasterMaterial = kit.library.flat('#6a5c4c', { roughness: 0.92 });
      for (const side of [-1, 1]) {
        const pilaster = new THREE.Mesh(kit.geometry.box(0.5, height * 0.98, 0.5), pilasterMaterial);
        const lateral = side * (slot.width / 2 - 0.3);
        if (slot.facing === 'x') pilaster.position.set(0, height / 2, lateral);
        else pilaster.position.set(lateral, height / 2, 0);
        building.add(pilaster);
      }
    }

    let hasFireEscape = false;
    if (kit.era.architecture.fireEscapes && !isGlass(style) && height > STOREY_HEIGHT * 3) {
      addFireEscape(kit, building, slot.width, height, (slot.depth / 2) * 0.9);
      hasFireEscape = true;
    }

    const top = height + 0.45;
    const roofKit = addRoofKit(kit, building, top, slot.width, slot.depth);
    const hasWaterTower = roofKit.waterTower;
    const hasSolarArray = roofKit.solarArray;

    let hasRoofBillboard = false;
    if (kit.era.architecture.roofBillboards && kit.rng.chance(0.3)) {
      addRoofBillboard(kit, building, top, slot.width);
      hasRoofBillboard = true;
    }

    const builtYear = Math.max(1850, kit.era.year - kit.rng.int(0, isGlass(style) ? 12 : 55));
    const record: BuildingRecord = {
      group: building,
      slot,
      floors,
      height,
      style,
      builtYear,
      label: STYLE_LABEL[style],
      frontage: new THREE.Vector3(
        slot.x + (slot.facing === 'x' ? (slot.facingSign * (slot.width / 2 + 0.4)) : 0),
        STOREY_HEIGHT * 1.6,
        slot.z + (slot.facing === 'z' ? (slot.facingSign * (slot.depth / 2 + 0.4)) : 0),
      ),
      hasWaterTower,
      hasFireEscape,
      hasRoofBillboard,
      hasSolarArray,
    };
    const buildingId = `${slot.x}:${slot.z}`;
    const roofFurniture = [
      hasWaterTower ? 'a cedar water tower' : null,
      hasFireEscape ? 'cast-iron fire escapes' : null,
      hasRoofBillboard ? 'a hoisted billboard' : null,
      hasSolarArray ? 'roof gardens and solar panels' : null,
    ].filter((entry): entry is string => entry !== null);
    building.userData.focus = {
      kind: 'building',
      id: buildingId,
      label: record.label,
      detail:
        `${floors} storeys of ${record.label} put up around ${builtYear}, ` +
        (isGlass(style)
          ? 'sheathed in curtain-wall glazing'
          : `punched ${kit.era.architecture.windowStyle} windows`) +
        `${slot.landmark ? ', the tallest address on the block' : ''}` +
        `${roofFurniture.length > 0 ? `, carrying ${roofFurniture.join(' and ')}` : ''}.`,
      period: `${kit.era.year} · ${eraSubtitle(kit.era)}`,
    };
    if (hasWaterTower) waterTowers += 1;
    if (hasFireEscape) fireEscapes += 1;
    if (hasRoofBillboard) roofBillboards += 1;
    if (hasSolarArray) solarArrays += 1;

    records.push(record);
    group.add(building);
  }

  return { group, records, waterTowers, fireEscapes, roofBillboards, solarArrays };
}
