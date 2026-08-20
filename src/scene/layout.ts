import { useMemo } from 'react';
import { ROAD_HALF_W } from './constants';

/**
 * Deterministic layout data for the static city block. All positions are
 * generated once at module load (stable across renders) using a seeded PRNG
 * so the scene never shuffles on re-render. Geometric constants come from
 * constants.ts to keep one source of truth for the block shape.
 */

export type BuildingStyle = 'brick' | 'stone' | 'deco' | 'glass' | 'modern' | 'arena';

export interface BuildingLayout {
  id: number;
  x: number;
  z: number;
  rot: number;
  baseW: number;
  baseD: number;
  baseH: number;
  floors: number;
  style: BuildingStyle;
  /** Window lit fraction at night, 0-1. */
  lit: number;
  antenna: boolean;
  waterTower: boolean;
  billboard: boolean;
}

export interface VehicleLayout {
  id: number;
  lane: 'xPlus' | 'xMinus' | 'zPlus' | 'zMinus';
  speed: number;
  startPhase: number;
  kind: 'car' | 'bus' | 'truck' | 'taxi' | 'limo' | 'van';
}

export interface PedestrianLayout {
  id: number;
  start: [number, number];
  dirX: number;
  dirZ: number;
  speed: number;
  phase: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CELL = 6.4;
const SIDE_CELLS = 4;

function generateBuildings(): BuildingLayout[] {
  const rnd = mulberry32(0x51c0ffee);
  const list: BuildingLayout[] = [];
  let id = 0;
  const styles: BuildingStyle[] = [
    'brick',
    'brick',
    'stone',
    'deco',
    'glass',
    'modern',
    'arena',
  ];
  for (let gx = -SIDE_CELLS; gx <= SIDE_CELLS; gx++) {
    for (let gz = -SIDE_CELLS; gz <= SIDE_CELLS; gz++) {
      const cx = gx * CELL;
      const cz = gz * CELL;
      // Skip building on road intersection cells and central crossroads.
      const onRoad =
        Math.abs(cx) < ROAD_HALF_W + 1.9 || Math.abs(cz) < ROAD_HALF_W + 1.9;
      if (onRoad) continue;
      if (Math.abs(cx) < 4.8 && Math.abs(cz) < 4.8) continue;
      if (!rnd()) continue; // leave gaps for plazas / parks
      const style = styles[Math.floor(rnd() * styles.length)] as BuildingStyle;
      const w = 3.4 + rnd() * 3.0;
      const d = 3.4 + rnd() * 3.0;
      const floors = 2 + Math.floor(rnd() * 9); // 2..10
      const isTower = rnd() < 0.2;
      const baseH = isTower ? 2.8 + rnd() * 2.4 : 1.4 + rnd() * 2.0;
      list.push({
        id: id++,
        x: cx + (rnd() - 0.5) * 1.4,
        z: cz + (rnd() - 0.5) * 1.4,
        rot: Math.floor(rnd() * 4) * (Math.PI / 2),
        baseW: w,
        baseD: d,
        baseH,
        floors,
        style,
        lit: 0.3 + rnd() * 0.55,
        antenna: isTower && rnd() < 0.55,
        waterTower: style === 'brick' && rnd() < 0.14,
        billboard: rnd() < 0.16 && !isTower,
      });
    }
  }
  return list;
}

const BUILDINGS: BuildingLayout[] = generateBuildings();

export function useBuildingLayouts(): BuildingLayout[] {
  return useMemo(() => BUILDINGS, []);
}

function generateVehicles(): VehicleLayout[] {
  const rnd = mulberry32(0xbeef9012);
  const lanes: VehicleLayout['lane'][] = ['xPlus', 'xMinus', 'zPlus', 'zMinus'];
  const kinds: VehicleLayout['kind'][] = ['car', 'car', 'car', 'taxi', 'bus', 'truck', 'limo', 'van'];
  const list: VehicleLayout[] = [];
  for (let i = 0; i < 14; i++) {
    list.push({
      id: i,
      lane: lanes[i % lanes.length] as VehicleLayout['lane'],
      speed: 0.05 + rnd() * 0.045,
      startPhase: rnd() * 100,
      kind: kinds[Math.floor(rnd() * kinds.length)] as VehicleLayout['kind'],
    });
  }
  return list;
}

const VEHICLES: VehicleLayout[] = generateVehicles();

export function useVehicleLayouts(): VehicleLayout[] {
  return useMemo(() => VEHICLES, []);
}

function generatePedestrians(): PedestrianLayout[] {
  const rnd = mulberry32(0xa11ce);
  const list: PedestrianLayout[] = [];
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let i = 0; i < 48; i++) {
    const dir = dirs[Math.floor(rnd() * dirs.length)] as [number, number];
    const start: [number, number] = [
      (rnd() - 0.5) * 46,
      (rnd() - 0.5) * 46,
    ];
    list.push({
      id: i,
      start,
      dirX: dir[0],
      dirZ: dir[1],
      speed: 1.1 + rnd() * 1.6,
      phase: rnd() * Math.PI * 2,
    });
  }
  return list;
}

const PEDESTRIANS: PedestrianLayout[] = generatePedestrians();

export function usePedestrianLayouts(): PedestrianLayout[] {
  return useMemo(() => PEDESTRIANS, []);
}