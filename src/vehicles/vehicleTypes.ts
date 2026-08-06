/**
 * Procedural vehicle body definitions.
 *
 * Every vehicle is authored as a list of primitive parts (boxes, cylinders,
 * spheres, cones). A single part list is the "shared geometry" for a vehicle
 * type: all instances of that type reference the same geometries/materials and
 * are drawn through `InstancedMesh`, so a whole era fleet stays cheap to
 * render.
 *
 * Each part carries a `role` that maps to a per-instance colour at draw time,
 * which lets the same body type take on any era palette / two-tone / livery
 * without duplicating geometry.
 */
import * as THREE from 'three';

export type Primitive = 'box' | 'cylinder' | 'sphere' | 'cone';

/** How a part is coloured for a particular vehicle instance. */
export type PartRole =
  | 'body'
  | 'accent'
  | 'glass'
  | 'tire'
  | 'chrome'
  | 'light'
  | 'trim'
  | 'livery';

export interface VehiclePart {
  primitive: Primitive;
  /** Geometry constructor arguments (box: w,h,d / cylinder: rTop,rBot,h,seg ...). */
  args: number[];
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
  role: PartRole;
  /** Fallback / base colour (used for chrome, trim, lights, glass). */
  color: string;
  metalness?: number;
  roughness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}

export type VehicleTypeId =
  | 'sedan'
  | 'pickup'
  | 'wagon'
  | 'muscle'
  | 'hatchback'
  | 'sedan85'
  | 'van'
  | 'suv'
  | 'crossover'
  | 'minivan'
  | 'evSedan'
  | 'evCrossover'
  | 'evVan'
  | 'rideShare'
  | 'roboTaxi';

export interface VehicleInstance {
  id: number;
  type: VehicleTypeId;
  bodyColor: string;
  accentColor: string | null;
  liveryColor?: string | null;
  /** Which road loop this vehicle drives on. */
  loopIndex: number;
  /** Speed in world units / second. */
  speed: number;
  /** 0..1 starting position along the loop. */
  phase: number;
  /** Travel direction around the loop. */
  direction: 1 | -1;
}

// ---------------------------------------------------------------------------
// Part builders
// ---------------------------------------------------------------------------

const wheel = (x: number, z: number, r = 0.34, w = 0.26): VehiclePart => ({
  primitive: 'cylinder',
  args: [r, r, w, 18],
  position: [x, r, z],
  rotation: [0, 0, Math.PI / 2],
  role: 'tire',
  color: '#161616',
  roughness: 0.92,
  metalness: 0,
});

const body = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  role: PartRole = 'body',
  color = '#c8c8c8',
): VehiclePart => ({
  primitive: 'box',
  args: [w, h, d],
  position: [x, y, z],
  role,
  color,
  roughness: 0.45,
  metalness: 0.2,
});

const chrome = (w: number, h: number, d: number, x: number, y: number, z: number): VehiclePart => ({
  primitive: 'box',
  args: [w, h, d],
  position: [x, y, z],
  role: 'chrome',
  color: '#d8dce0',
  roughness: 0.25,
  metalness: 0.9,
});

const glass = (
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rx = 0,
): VehiclePart => ({
  primitive: 'box',
  args: [w, h, d],
  position: [x, y, z],
  rotation: [rx, 0, 0],
  role: 'glass',
  color: '#18222f',
  roughness: 0.15,
  metalness: 0.6,
});

const headlight = (x: number, y: number, z: number): VehiclePart => ({
  primitive: 'sphere',
  args: [0.15, 10, 8],
  position: [x, y, z],
  role: 'light',
  color: '#fff6d8',
  emissive: '#fff6d8',
  emissiveIntensity: 1.8,
  roughness: 0.3,
  metalness: 0.1,
});

const taillight = (x: number, y: number, z: number): VehiclePart => ({
  primitive: 'sphere',
  args: [0.12, 8, 6],
  position: [x, y, z],
  role: 'light',
  color: '#c22a2a',
  emissive: '#ff3b30',
  emissiveIntensity: 1.2,
  roughness: 0.3,
  metalness: 0.1,
});

const ledBar = (w: number, h: number, d: number, x: number, y: number, z: number, color: string): VehiclePart => ({
  primitive: 'box',
  args: [w, h, d],
  position: [x, y, z],
  role: 'light',
  color,
  emissive: color,
  emissiveIntensity: 2,
  roughness: 0.3,
  metalness: 0.1,
});

const fender = (x: number, z: number): VehiclePart => ({
  primitive: 'sphere',
  args: [0.3, 12, 10],
  position: [x, 0.5, z],
  scale: [0.72, 0.55, 0.82],
  role: 'body',
  color: '#c8c8c8',
  roughness: 0.4,
  metalness: 0.25,
});

// ---------------------------------------------------------------------------
// Vehicle type definitions (era-appropriate silhouettes)
// ---------------------------------------------------------------------------

const sedan = (): VehiclePart[] => [
  body(1.8, 0.5, 3.9, 0, 0.62, 0),
  body(1.68, 0.34, 2.0, 0, 0.98, -0.35),
  body(1.42, 0.4, 1.9, 0, 1.26, -0.42),
  glass(1.5, 0.36, 0.06, 0, 1.12, 0.6, -0.4),
  glass(1.36, 0.36, 0.06, 0, 1.12, -1.12, 0.4),
  fender(-0.86, 1.3),
  fender(0.86, 1.3),
  fender(-0.86, -1.3),
  fender(0.86, -1.3),
  wheel(-0.82, 1.35),
  wheel(0.82, 1.35),
  wheel(-0.82, -1.35),
  wheel(0.82, -1.35),
  chrome(1.92, 0.22, 0.14, 0, 0.4, 2.0),
  chrome(1.92, 0.22, 0.14, 0, 0.4, -2.0),
  chrome(1.5, 0.3, 0.1, 0, 0.7, 1.96),
  headlight(-0.55, 0.72, 1.99),
  headlight(0.55, 0.72, 1.99),
  chrome(0.08, 0.16, 0.5, -0.9, 0.6, 0.2),
  chrome(0.08, 0.16, 0.5, 0.9, 0.6, 0.2),
];

const pickup = (): VehiclePart[] => [
  body(1.8, 0.5, 2.6, 0, 0.62, -0.1),
  body(1.7, 0.3, 1.6, 0, 1.0, -0.6),
  glass(1.5, 0.34, 0.06, 0, 1.12, 0.35, -0.5),
  body(1.78, 0.55, 1.5, 0, 0.55, 1.35),
  chrome(0.12, 0.5, 1.5, -0.9, 0.6, 1.35),
  chrome(0.12, 0.5, 1.5, 0.9, 0.6, 1.35),
  wheel(-0.82, 1.2),
  wheel(0.82, 1.2),
  wheel(-0.82, -1.0),
  wheel(0.82, -1.0),
  chrome(1.9, 0.22, 0.14, 0, 0.4, 1.9),
  chrome(1.9, 0.22, 0.14, 0, 0.4, -1.9),
  chrome(1.4, 0.3, 0.1, 0, 0.68, 1.86),
  headlight(-0.5, 0.7, 1.88),
  headlight(0.5, 0.7, 1.88),
];

const wagon = (): VehiclePart[] => [
  body(1.84, 0.5, 4.0, 0, 0.62, 0),
  body(1.7, 0.4, 3.2, 0, 1.0, -0.2),
  body(1.5, 0.35, 2.9, 0, 1.34, -0.2),
  glass(1.5, 0.36, 0.06, 0, 1.14, 0.75, -0.5),
  glass(1.45, 0.3, 0.06, 0, 1.14, -1.5, 0.5),
  chrome(0.06, 0.3, 1.0, -0.88, 0.8, 0.4),
  chrome(0.06, 0.3, 1.0, 0.88, 0.8, 0.4),
  wheel(-0.84, 1.4),
  wheel(0.84, 1.4),
  wheel(-0.84, -1.4),
  wheel(0.84, -1.4),
  chrome(1.94, 0.24, 0.14, 0, 0.42, 2.05),
  chrome(1.94, 0.24, 0.14, 0, 0.42, -2.05),
  chrome(1.5, 0.32, 0.1, 0, 0.72, 2.0),
  headlight(-0.55, 0.72, 2.03),
  headlight(0.55, 0.72, 2.03),
  taillight(-0.7, 0.6, -2.03),
  taillight(0.7, 0.6, -2.03),
];

const muscle = (): VehiclePart[] => [
  body(1.9, 0.42, 4.1, 0, 0.55, 0),
  body(1.72, 0.2, 1.5, 0, 0.82, 1.25),
  body(1.5, 0.4, 1.4, 0, 0.98, -0.8),
  body(1.4, 0.14, 1.2, 0, 1.24, -0.8),
  body(0.7, 0.12, 0.5, 0, 0.95, 1.3, 'accent'),
  body(0.12, 0.2, 3.0, -0.95, 0.62, 0, 'accent'),
  body(0.12, 0.2, 3.0, 0.95, 0.62, 0, 'accent'),
  wheel(-0.88, 1.35, 0.4, 0.28),
  wheel(0.88, 1.35, 0.4, 0.28),
  wheel(-0.88, -1.35, 0.4, 0.28),
  wheel(0.88, -1.35, 0.4, 0.28),
  chrome(2.0, 0.2, 0.14, 0, 0.38, 2.1),
  chrome(2.0, 0.2, 0.14, 0, 0.38, -2.1),
  chrome(1.7, 0.26, 0.1, 0, 0.62, 2.06),
  headlight(-0.6, 0.62, 2.08),
  headlight(0.6, 0.62, 2.08),
  taillight(-0.8, 0.5, -2.08),
  taillight(0.8, 0.5, -2.08),
];

const hatchback = (): VehiclePart[] => [
  body(1.72, 0.48, 3.5, 0, 0.6, 0),
  body(1.6, 0.4, 1.9, 0, 0.98, -0.35),
  body(1.5, 0.2, 1.6, 0, 1.24, -0.35),
  glass(1.5, 0.34, 0.05, 0, 1.1, 0.62, -0.55),
  glass(1.45, 0.3, 0.05, 0, 1.1, -1.2, 0.55),
  body(1.7, 0.14, 0.4, 0, 0.55, 1.7, 'trim', '#2a2a2e'),
  body(1.7, 0.12, 0.3, 0, 0.55, -1.75, 'trim', '#2a2a2e'),
  chrome(1.6, 0.1, 0.08, 0, 0.6, 1.72),
  wheel(-0.8, 1.2, 0.32, 0.24),
  wheel(0.8, 1.2, 0.32, 0.24),
  wheel(-0.8, -1.2, 0.32, 0.24),
  wheel(0.8, -1.2, 0.32, 0.24),
  headlight(-0.5, 0.62, 1.76),
  headlight(0.5, 0.62, 1.76),
  taillight(-0.6, 0.58, -1.78),
  taillight(0.6, 0.58, -1.78),
];

const sedan85 = (): VehiclePart[] => [
  body(1.78, 0.46, 4.0, 0, 0.6, 0),
  body(1.62, 0.4, 2.2, 0, 0.96, -0.35),
  body(1.5, 0.16, 2.0, 0, 1.22, -0.35),
  glass(1.5, 0.36, 0.05, 0, 1.08, 0.72, -0.6),
  glass(1.4, 0.3, 0.05, 0, 1.08, -1.35, 0.5),
  body(1.76, 0.16, 0.5, 0, 0.5, 1.85, 'trim', '#2a2a2e'),
  body(1.76, 0.12, 0.4, 0, 0.5, -1.9, 'trim', '#2a2a2e'),
  chrome(1.7, 0.1, 0.06, 0, 0.62, 1.9),
  wheel(-0.82, 1.35, 0.33, 0.24),
  wheel(0.82, 1.35, 0.33, 0.24),
  wheel(-0.82, -1.35, 0.33, 0.24),
  wheel(0.82, -1.35, 0.33, 0.24),
  headlight(-0.5, 0.62, 1.9),
  headlight(0.5, 0.62, 1.9),
  taillight(-0.6, 0.55, -1.92),
  taillight(0.6, 0.55, -1.92),
];

const van = (): VehiclePart[] => [
  body(1.86, 0.9, 4.2, 0, 0.85, 0),
  body(1.8, 0.5, 2.6, 0, 1.45, -0.4),
  glass(1.7, 0.4, 0.06, 0, 1.5, 0.8, -0.6),
  glass(1.5, 0.35, 0.05, 0, 1.5, -1.6, 0.5),
  glass(0.5, 0.3, 0.05, -0.9, 1.4, 0.4),
  glass(0.5, 0.3, 0.05, 0.9, 1.4, 0.4),
  wheel(-0.8, 1.4, 0.34, 0.26),
  wheel(0.8, 1.4, 0.34, 0.26),
  wheel(-0.8, -1.4, 0.34, 0.26),
  wheel(0.8, -1.4, 0.34, 0.26),
  chrome(1.9, 0.2, 0.14, 0, 0.4, 2.1),
  chrome(1.9, 0.2, 0.14, 0, 0.4, -2.1),
  chrome(1.6, 0.3, 0.1, 0, 0.8, 2.06),
  headlight(-0.5, 0.85, 2.08),
  headlight(0.5, 0.85, 2.08),
];

const suv = (): VehiclePart[] => [
  body(1.9, 0.6, 4.3, 0, 0.7, 0),
  body(1.8, 0.5, 3.0, 0, 1.2, -0.2),
  body(1.7, 0.3, 2.6, 0, 1.55, -0.2),
  glass(1.7, 0.4, 0.06, 0, 1.35, 0.85, -0.55),
  glass(1.6, 0.35, 0.05, 0, 1.35, -1.5, 0.5),
  body(1.9, 0.2, 0.4, 0, 0.55, 2.15, 'trim', '#2e3a45'),
  body(1.9, 0.2, 0.4, 0, 0.55, -2.15, 'trim', '#2e3a45'),
  chrome(1.7, 0.14, 0.08, 0, 0.75, 2.17),
  wheel(-0.86, 1.5, 0.38, 0.3),
  wheel(0.86, 1.5, 0.38, 0.3),
  wheel(-0.86, -1.5, 0.38, 0.3),
  wheel(0.86, -1.5, 0.38, 0.3),
  headlight(-0.6, 0.78, 2.18),
  headlight(0.6, 0.78, 2.18),
  taillight(-0.75, 0.7, -2.18),
  taillight(0.75, 0.7, -2.18),
];

const crossover = (): VehiclePart[] => [
  body(1.86, 0.55, 4.1, 0, 0.68, 0),
  body(1.76, 0.48, 2.8, 0, 1.15, -0.2),
  body(1.66, 0.26, 2.5, 0, 1.48, -0.2),
  glass(1.66, 0.38, 0.06, 0, 1.3, 0.8, -0.55),
  glass(1.56, 0.32, 0.05, 0, 1.3, -1.45, 0.5),
  body(1.86, 0.18, 0.4, 0, 0.55, 2.05, 'trim', '#3a3a3a'),
  body(1.86, 0.18, 0.4, 0, 0.55, -2.05, 'trim', '#3a3a3a'),
  wheel(-0.84, 1.4, 0.36, 0.28),
  wheel(0.84, 1.4, 0.36, 0.28),
  wheel(-0.84, -1.4, 0.36, 0.28),
  wheel(0.84, -1.4, 0.36, 0.28),
  headlight(-0.55, 0.72, 2.07),
  headlight(0.55, 0.72, 2.07),
  taillight(-0.7, 0.66, -2.07),
  taillight(0.7, 0.66, -2.07),
];

const minivan = (): VehiclePart[] => [
  body(1.9, 0.85, 4.4, 0, 0.85, 0),
  body(1.84, 0.55, 3.4, 0, 1.5, -0.15),
  body(1.76, 0.4, 3.0, 0, 1.9, -0.15),
  glass(1.74, 0.42, 0.06, 0, 1.6, 0.9, -0.55),
  glass(1.6, 0.4, 0.05, 0, 1.6, -1.7, 0.5),
  glass(0.6, 0.35, 0.05, -0.9, 1.5, 0.4),
  glass(0.6, 0.35, 0.05, 0.9, 1.5, 0.4),
  glass(0.6, 0.35, 0.05, -0.9, 1.5, -0.9),
  glass(0.6, 0.35, 0.05, 0.9, 1.5, -0.9),
  body(1.9, 0.2, 0.4, 0, 0.6, 2.2, 'trim', '#3a3a3a'),
  body(1.9, 0.2, 0.4, 0, 0.6, -2.2, 'trim', '#3a3a3a'),
  wheel(-0.82, 1.5, 0.34, 0.26),
  wheel(0.82, 1.5, 0.34, 0.26),
  wheel(-0.82, -1.5, 0.34, 0.26),
  wheel(0.82, -1.5, 0.34, 0.26),
  headlight(-0.6, 0.85, 2.22),
  headlight(0.6, 0.85, 2.22),
];

const evSedan = (): VehiclePart[] => [
  body(1.82, 0.5, 4.2, 0, 0.62, 0),
  body(1.72, 0.42, 2.4, 0, 1.0, -0.3),
  body(1.6, 0.2, 2.1, 0, 1.28, -0.3),
  glass(1.62, 0.38, 0.05, 0, 1.12, 0.78, -0.6),
  glass(1.5, 0.32, 0.05, 0, 1.12, -1.4, 0.5),
  body(1.8, 0.14, 0.3, 0, 0.55, 2.08, 'trim', '#2a2c30'),
  body(1.8, 0.12, 0.3, 0, 0.55, -2.1, 'trim', '#2a2c30'),
  ledBar(1.4, 0.06, 0.1, 0, 0.66, 2.1, '#e8fbff'),
  ledBar(1.3, 0.06, 0.1, 0, 0.6, -2.12, '#ff3b30'),
  wheel(-0.84, 1.4, 0.37, 0.26),
  wheel(0.84, 1.4, 0.37, 0.26),
  wheel(-0.84, -1.4, 0.37, 0.26),
  wheel(0.84, -1.4, 0.37, 0.26),
  headlight(-0.55, 0.66, 2.1),
  headlight(0.55, 0.66, 2.1),
];

const evCrossover = (): VehiclePart[] => [
  body(1.88, 0.56, 4.2, 0, 0.7, 0),
  body(1.78, 0.48, 2.9, 0, 1.18, -0.2),
  body(1.68, 0.24, 2.6, 0, 1.5, -0.2),
  glass(1.68, 0.4, 0.06, 0, 1.32, 0.82, -0.55),
  glass(1.58, 0.34, 0.05, 0, 1.32, -1.5, 0.5),
  body(1.86, 0.16, 0.35, 0, 0.58, 2.1, 'trim', '#2a2c30'),
  body(1.86, 0.16, 0.35, 0, 0.58, -2.12, 'trim', '#2a2c30'),
  ledBar(1.5, 0.06, 0.1, 0, 0.7, 2.12, '#e8fbff'),
  ledBar(1.4, 0.06, 0.1, 0, 0.64, -2.14, '#ff3b30'),
  wheel(-0.86, 1.45, 0.38, 0.28),
  wheel(0.86, 1.45, 0.38, 0.28),
  wheel(-0.86, -1.45, 0.38, 0.28),
  wheel(0.86, -1.45, 0.38, 0.28),
  headlight(-0.55, 0.72, 2.12),
  headlight(0.55, 0.72, 2.12),
];

const evVan = (): VehiclePart[] => [
  body(1.9, 0.95, 4.6, 0, 0.9, 0),
  body(1.84, 0.55, 3.0, 0, 1.55, -0.3),
  glass(1.74, 0.42, 0.06, 0, 1.6, 0.85, -0.6),
  glass(0.6, 0.35, 0.05, -0.9, 1.5, 0.2),
  glass(0.6, 0.35, 0.05, 0.9, 1.5, 0.2),
  body(1.9, 0.3, 0.5, 0, 1.2, 0.5, 'livery', '#e8e8e8'),
  wheel(-0.84, 1.5, 0.36, 0.28),
  wheel(0.84, 1.5, 0.36, 0.28),
  wheel(-0.84, -1.5, 0.36, 0.28),
  wheel(0.84, -1.5, 0.36, 0.28),
  body(1.9, 0.2, 0.4, 0, 0.6, 2.3, 'trim', '#2a2c30'),
  body(1.9, 0.2, 0.4, 0, 0.6, -2.3, 'trim', '#2a2c30'),
  ledBar(1.6, 0.06, 0.1, 0, 0.85, 2.32, '#e8fbff'),
  headlight(-0.5, 0.9, 2.32),
  headlight(0.5, 0.9, 2.32),
];

const rideShare = (): VehiclePart[] => [
  body(1.8, 0.5, 4.1, 0, 0.62, 0),
  body(1.7, 0.42, 2.3, 0, 1.0, -0.3),
  body(1.58, 0.2, 2.0, 0, 1.28, -0.3),
  glass(1.6, 0.38, 0.05, 0, 1.12, 0.76, -0.6),
  glass(1.48, 0.32, 0.05, 0, 1.12, -1.38, 0.5),
  body(1.78, 0.14, 0.3, 0, 0.55, 2.05, 'trim', '#2a2c30'),
  body(1.78, 0.12, 0.3, 0, 0.55, -2.08, 'trim', '#2a2c30'),
  body(0.7, 0.08, 0.5, 0, 1.42, -0.3, 'livery', '#e8e8e8'),
  body(0.5, 0.16, 0.3, 0, 1.38, -0.3, 'light', '#e8fbff'),
  wheel(-0.82, 1.35, 0.36, 0.26),
  wheel(0.82, 1.35, 0.36, 0.26),
  wheel(-0.82, -1.35, 0.36, 0.26),
  wheel(0.82, -1.35, 0.36, 0.26),
  ledBar(1.4, 0.06, 0.1, 0, 0.64, 2.07, '#e8fbff'),
  ledBar(1.3, 0.06, 0.1, 0, 0.58, -2.1, '#ff3b30'),
  headlight(-0.5, 0.64, 2.07),
  headlight(0.5, 0.64, 2.07),
];

const roboTaxi = (): VehiclePart[] => [
  body(1.9, 0.55, 4.2, 0, 0.66, 0),
  body(1.8, 0.5, 3.0, 0, 1.16, -0.2),
  body(1.7, 0.24, 2.7, 0, 1.5, -0.2),
  glass(1.7, 0.4, 0.06, 0, 1.3, 0.8, -0.55),
  glass(1.6, 0.36, 0.05, 0, 1.3, -1.5, 0.5),
  body(1.5, 0.18, 0.3, 0, 1.72, -0.2, 'livery', '#00a0e0'),
  {
    primitive: 'sphere',
    args: [0.22, 12, 10],
    position: [0, 1.86, -0.2],
    role: 'light',
    color: '#00e0ff',
    emissive: '#00e0ff',
    emissiveIntensity: 2.4,
    roughness: 0.2,
    metalness: 0.2,
  },
  body(1.88, 0.16, 0.35, 0, 0.58, 2.1, 'trim', '#e8e8e8'),
  body(1.88, 0.16, 0.35, 0, 0.58, -2.12, 'trim', '#e8e8e8'),
  ledBar(1.6, 0.06, 0.1, 0, 0.7, 2.12, '#e8fbff'),
  ledBar(1.5, 0.06, 0.1, 0, 0.62, -2.14, '#ff3b30'),
  body(1.6, 0.12, 0.06, 0, 0.8, 2.14, 'livery', '#00a0e0'),
  wheel(-0.86, 1.45, 0.38, 0.28),
  wheel(0.86, 1.45, 0.38, 0.28),
  wheel(-0.86, -1.45, 0.38, 0.28),
  wheel(0.86, -1.45, 0.38, 0.28),
  headlight(-0.55, 0.68, 2.1),
  headlight(0.55, 0.68, 2.1),
];

export const VEHICLE_TYPES: Record<VehicleTypeId, VehiclePart[]> = {
  sedan: sedan(),
  pickup: pickup(),
  wagon: wagon(),
  muscle: muscle(),
  hatchback: hatchback(),
  sedan85: sedan85(),
  van: van(),
  suv: suv(),
  crossover: crossover(),
  minivan: minivan(),
  evSedan: evSedan(),
  evCrossover: evCrossover(),
  evVan: evVan(),
  rideShare: rideShare(),
  roboTaxi: roboTaxi(),
};

// ---------------------------------------------------------------------------
// Geometry / material / colour factories (shared across instances)
// ---------------------------------------------------------------------------

export function createPartGeometry(part: VehiclePart): THREE.BufferGeometry {
  switch (part.primitive) {
    case 'box':
      return new THREE.BoxGeometry(part.args[0], part.args[1], part.args[2]);
    case 'cylinder':
      return new THREE.CylinderGeometry(
        part.args[0],
        part.args[1],
        part.args[2],
        part.args[3] ?? 16,
      );
    case 'sphere':
      return new THREE.SphereGeometry(part.args[0], part.args[1] ?? 12, part.args[2] ?? 10);
    case 'cone':
      return new THREE.ConeGeometry(part.args[0], part.args[1], part.args[2] ?? 16);
  }
}

/** Material base colour is white; per-instance colour is applied via instanceColor. */
export function createPartMaterial(part: VehiclePart): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: part.metalness ?? 0.3,
    roughness: part.roughness ?? 0.6,
    emissive: part.emissive ?? '#000000',
    emissiveIntensity: part.emissiveIntensity ?? 0,
  });
}

/** Map a part's role to the concrete colour for a specific vehicle instance. */
export function resolvePartColor(part: VehiclePart, vehicle: VehicleInstance): string {
  switch (part.role) {
    case 'body':
      return vehicle.bodyColor;
    case 'accent':
      return vehicle.accentColor ?? vehicle.bodyColor;
    case 'livery':
      return vehicle.liveryColor ?? vehicle.accentColor ?? vehicle.bodyColor;
    case 'glass':
      return '#18222f';
    case 'tire':
      return '#161616';
    case 'chrome':
      return '#d8dce0';
    case 'light':
    case 'trim':
    default:
      return part.color;
  }
}
