/**
 * Shared rig geometry for the vehicles module.
 *
 * Vehicles are built from a small set of shared primitive parts (wheels,
 * body, cabin, trim, lights). Each part is a merged set of boxes (and
 * cylinder wheels) whose geometry is built once per body type, then
 * instanced across the fleet. Per-frame we only update instance matrices,
 * which keeps the traffic cheap.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PartKey, VehicleType } from './vehicles';

function box(
  w: number,
  h: number,
  d: number,
  tx = 0,
  ty = 0,
  tz = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(tx, ty, tz);
  return g;
}

function merge(geoms: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(geoms);
  if (!m) throw new Error('mergeGeometries returned null');
  return m;
}

/** A wheel as a short cylinder rotated so its axis runs along X. */
function wheel(x: number, z: number, r = 0.26, w = 0.2): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, w, 10);
  g.rotateZ(Math.PI / 2);
  g.translate(x, r, z);
  return g;
}

/** Four wheels at the vehicle corners. */
function fourWheels(length: number, width: number): THREE.BufferGeometry {
  const x = width / 2 - 0.12;
  const zf = length / 2 - 0.3;
  const zr = -length / 2 + 0.3;
  return merge([wheel(x, zf), wheel(-x, zf), wheel(x, zr), wheel(-x, zr)]);
}

/** Chrome front + rear bumpers. */
function bumpers(
  length: number,
  width: number,
  trimY: number,
): THREE.BufferGeometry {
  const z = length / 2;
  return merge([
    box(width + 0.04, 0.12, 0.1, 0, trimY, z + 0.04),
    box(width + 0.04, 0.12, 0.1, 0, trimY, -z - 0.04),
  ]);
}

/** Headlights (front, white/amber) and taillights (rear). */
function lights(
  length: number,
  width: number,
  lightsY: number,
): THREE.BufferGeometry {
  const z = length / 2;
  const w = width / 2 - 0.12;
  return merge([
    box(0.14, 0.08, 0.04, -w, lightsY, z + 0.03),
    box(0.14, 0.08, 0.04, w, lightsY, z + 0.03),
    box(0.14, 0.08, 0.04, -w, lightsY, -z - 0.03),
    box(0.14, 0.08, 0.04, w, lightsY, -z - 0.03),
  ]);
}

/** Rounded fender flares over each wheel (1945 / 2005 SUV). */
function fenders(length: number, width: number): THREE.BufferGeometry[] {
  const w = width / 2 - 0.1;
  const zf = length / 2 - 0.32;
  const zr = -length / 2 + 0.32;
  return [
    box(0.56, 0.2, 0.34, w, 0.36, zf),
    box(0.56, 0.2, 0.34, -w, 0.36, zf),
    box(0.56, 0.2, 0.34, w, 0.36, zr),
    box(0.56, 0.2, 0.34, -w, 0.36, zr),
  ];
}

interface CarSpec {
  length: number;
  width: number;
  bodyH: number;
  bodyY: number;
  cabinW: number;
  cabinH: number;
  cabinLen: number;
  cabinY: number;
  cabinZ: number;
  trimY: number;
  lightsY: number;
  bodyExtra?: THREE.BufferGeometry[];
  cabinExtra?: THREE.BufferGeometry[];
}

function buildCar(spec: CarSpec): Record<PartKey, THREE.BufferGeometry> {
  const wheels = fourWheels(spec.length, spec.width);

  const bodyGeoms = [
    box(spec.width, spec.bodyH, spec.length, 0, spec.bodyY, 0),
  ];
  if (spec.bodyExtra) bodyGeoms.push(...spec.bodyExtra);
  const body = merge(bodyGeoms);

  const cabinGeoms = [
    box(spec.cabinW, spec.cabinH, spec.cabinLen, 0, spec.cabinY, spec.cabinZ),
  ];
  if (spec.cabinExtra) cabinGeoms.push(...spec.cabinExtra);
  const cabin = merge(cabinGeoms);

  const trim = bumpers(spec.length, spec.width, spec.trimY);
  const lightsGeom = lights(spec.length, spec.width, spec.lightsY);
  return { wheels, body, cabin, trim, lights: lightsGeom };
}

/** 1945 work truck — cab + flat bed. */
function buildTruck(): Record<PartKey, THREE.BufferGeometry> {
  const length = 1.9;
  const width = 0.84;
  return {
    wheels: fourWheels(length, width),
    body: merge([
      box(0.84, 0.42, 0.8, 0, 0.5, 0.3),
      box(0.84, 0.28, 1.05, 0, 0.4, -0.55),
    ]),
    cabin: box(0.7, 0.2, 0.12, 0, 0.72, 0.3),
    trim: bumpers(length, width, 0.34),
    lights: lights(length, width, 0.5),
  };
}

/** Build every part for a vehicle body type. */
export function buildParts(
  type: VehicleType,
): Record<PartKey, THREE.BufferGeometry> {
  switch (type.id) {
    case 'sedan45':
      return buildCar({
        length: 2.0,
        width: 0.88,
        bodyH: 0.4,
        bodyY: 0.5,
        cabinW: 0.72,
        cabinH: 0.36,
        cabinLen: 1.0,
        cabinY: 0.8,
        cabinZ: -0.05,
        trimY: 0.34,
        lightsY: 0.56,
        bodyExtra: fenders(2.0, 0.88),
      });
    case 'coupe45':
      return buildCar({
        length: 1.85,
        width: 0.84,
        bodyH: 0.34,
        bodyY: 0.45,
        cabinW: 0.66,
        cabinH: 0.3,
        cabinLen: 0.8,
        cabinY: 0.68,
        cabinZ: 0.05,
        trimY: 0.32,
        lightsY: 0.5,
        bodyExtra: fenders(1.85, 0.84),
      });
    case 'truck45':
      return buildTruck();
    case 'sedan65':
      return buildCar({
        length: 2.1,
        width: 0.95,
        bodyH: 0.46,
        bodyY: 0.53,
        cabinW: 0.8,
        cabinH: 0.36,
        cabinLen: 1.05,
        cabinY: 0.82,
        cabinZ: -0.05,
        trimY: 0.38,
        lightsY: 0.58,
      });
    case 'wagon65':
      return buildCar({
        length: 2.15,
        width: 0.95,
        bodyH: 0.46,
        bodyY: 0.53,
        cabinW: 0.8,
        cabinH: 0.38,
        cabinLen: 1.7,
        cabinY: 0.83,
        cabinZ: -0.1,
        trimY: 0.38,
        lightsY: 0.58,
      });
    case 'muscle65':
      return buildCar({
        length: 2.0,
        width: 0.98,
        bodyH: 0.36,
        bodyY: 0.46,
        cabinW: 0.78,
        cabinH: 0.3,
        cabinLen: 0.85,
        cabinY: 0.68,
        cabinZ: 0.1,
        trimY: 0.34,
        lightsY: 0.5,
        bodyExtra: [box(0.3, 0.08, 0.5, 0, 0.68, 0.6)],
      });
    case 'hatch85':
      return buildCar({
        length: 1.9,
        width: 0.9,
        bodyH: 0.42,
        bodyY: 0.5,
        cabinW: 0.74,
        cabinH: 0.34,
        cabinLen: 0.9,
        cabinY: 0.78,
        cabinZ: 0,
        trimY: 0.34,
        lightsY: 0.54,
        bodyExtra: [box(0.9, 0.5, 0.2, 0, 0.55, -0.85)],
      });
    case 'sedan85':
      return buildCar({
        length: 2.05,
        width: 0.9,
        bodyH: 0.4,
        bodyY: 0.5,
        cabinW: 0.72,
        cabinH: 0.32,
        cabinLen: 1.0,
        cabinY: 0.76,
        cabinZ: -0.05,
        trimY: 0.34,
        lightsY: 0.54,
      });
    case 'van85':
      return buildCar({
        length: 2.0,
        width: 0.95,
        bodyH: 0.9,
        bodyY: 0.75,
        cabinW: 0.8,
        cabinH: 0.2,
        cabinLen: 1.6,
        cabinY: 1.1,
        cabinZ: -0.05,
        trimY: 0.4,
        lightsY: 0.6,
      });
    case 'suv05':
      return buildCar({
        length: 2.1,
        width: 0.98,
        bodyH: 0.55,
        bodyY: 0.6,
        cabinW: 0.86,
        cabinH: 0.4,
        cabinLen: 1.2,
        cabinY: 0.95,
        cabinZ: -0.05,
        trimY: 0.42,
        lightsY: 0.62,
        bodyExtra: fenders(2.1, 0.98),
      });
    case 'crossover05':
      return buildCar({
        length: 2.0,
        width: 0.95,
        bodyH: 0.5,
        bodyY: 0.56,
        cabinW: 0.82,
        cabinH: 0.38,
        cabinLen: 1.1,
        cabinY: 0.9,
        cabinZ: -0.05,
        trimY: 0.4,
        lightsY: 0.6,
      });
    case 'minivan05':
      return buildCar({
        length: 2.2,
        width: 0.98,
        bodyH: 0.78,
        bodyY: 0.72,
        cabinW: 0.9,
        cabinH: 0.18,
        cabinLen: 1.9,
        cabinY: 1.12,
        cabinZ: -0.05,
        trimY: 0.42,
        lightsY: 0.62,
      });
    case 'ev25':
      return buildCar({
        length: 2.0,
        width: 0.92,
        bodyH: 0.36,
        bodyY: 0.46,
        cabinW: 0.76,
        cabinH: 0.3,
        cabinLen: 1.1,
        cabinY: 0.7,
        cabinZ: -0.05,
        trimY: 0.34,
        lightsY: 0.5,
      });
    case 'fleet25':
      return buildCar({
        length: 2.0,
        width: 0.95,
        bodyH: 0.5,
        bodyY: 0.55,
        cabinW: 0.82,
        cabinH: 0.36,
        cabinLen: 1.05,
        cabinY: 0.88,
        cabinZ: -0.05,
        trimY: 0.4,
        lightsY: 0.6,
        cabinExtra: [box(0.34, 0.08, 0.22, 0, 1.1, 0)],
      });
    case 'robotaxi25':
      return buildCar({
        length: 1.9,
        width: 0.95,
        bodyH: 0.5,
        bodyY: 0.52,
        cabinW: 0.8,
        cabinH: 0.42,
        cabinLen: 1.4,
        cabinY: 0.9,
        cabinZ: 0,
        trimY: 0.4,
        lightsY: 0.58,
        cabinExtra: [box(0.42, 0.12, 0.42, 0, 1.16, 0)],
      });
    default:
      return buildCar({
        length: 2.0,
        width: 0.9,
        bodyH: 0.4,
        bodyY: 0.5,
        cabinW: 0.74,
        cabinH: 0.34,
        cabinLen: 1.0,
        cabinY: 0.8,
        cabinZ: -0.05,
        trimY: 0.36,
        lightsY: 0.56,
      });
  }
}

/** Build the geometry for a single vehicle part given a body type. */
export function buildPartGeometry(
  type: VehicleType,
  part: PartKey,
): THREE.BufferGeometry {
  return buildParts(type)[part];
}
