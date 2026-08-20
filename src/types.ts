export interface BuildingDatum {
  id: number;
  cx: number;
  cz: number;
  w: number;
  d: number;
  /** base height at time of construction */
  h: number;
  /** 0..1 modernism: drives glass, window density, neon */
  modern: number;
  /** calendar year built */
  built: number;
  /** landmark flag: label + bigger mutators */
  landmark?: boolean;
  /** landmark label text */
  label?: string;
  /** facade color (hex) */
  color: string;
  /** accent color (hex, e.g. roof) */
  accent: string;
  /** neon color, empty if none */
  neon?: string;
}

export interface RoadRect {
  cx: number;
  cz: number;
  w: number;
  d: number;
}

export interface LampDatum {
  x: number;
  z: number;
}

export interface TreeDatum {
  x: number;
  z: number;
  s: number;
}

export interface CityLayout {
  buildings: BuildingDatum[];
  /** rects for asphalt road surfaces */
  roads: RoadRect[];
  /** sidewalk strips (just outside the road rects) */
  sidewalks: RoadRect[];
  /** central park footprint */
  park: { cx: number; cz: number; w: number; d: number };
  lamps: LampDatum[];
  trees: TreeDatum[];
}