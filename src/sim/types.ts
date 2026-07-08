import * as THREE from 'three';

export type Era = '1945' | '1965' | '1985' | '2005' | '2025';

export const ERAS: Era[] = ['1945', '1965', '1985', '2005', '2025'];

export type Vec3 = { x: number; y: number; z: number };

export interface BuildingSpec {
  id: string;
  position: THREE.Vector3;
  rotation: number;
  width: number;
  depth: number;
  height: number;
  style: BuildingStyle;
  color: number;
  roofColor: number;
  eraIndex: number;
  storefront: StorefrontSpec | null;
  billboard: BillboardSpec | null;
}

export type BuildingStyle =
  | 'art_deco'
  | 'mid_century'
  | 'brutalist'
  | 'glass_tower'
  | 'modern_green';

export interface StorefrontSpec {
  label: string;
  primaryColor: number;
  accentColor: number;
  signageText: string;
  eraIndex: number;
}

export interface BillboardSpec {
  width: number;
  height: number;
  position: THREE.Vector3;
  adText: string;
  adColor: number;
  eraIndex: number;
}

export type VehicleType =
  | 'sedan_1940s'
  | 'muscle_1960s'
  | 'boxy_1980s'
  | 'suv_2000s'
  | 'ev_2020s';

export interface VehicleSpec {
  id: string;
  type: VehicleType;
  color: number;
  eraIndex: number;
  routeIndex: number;
  progress: number;
  speed: number;
}

export type PedestrianOutfit =
  | 'suit_1940s'
  | 'hippie_1960s'
  | 'punk_1980s'
  | 'casual_2000s'
  | 'streetwear_2020s';

export interface PedestrianSpec {
  id: string;
  outfit: PedestrianOutfit;
  skinColor: number;
  hairColor: number;
  eraIndex: number;
  pathIndex: number;
  progress: number;
  speed: number;
}

export interface StreetLightSpec {
  position: THREE.Vector3;
  style: 'lantern' | 'cobra' | 'led';
  eraIndex: number;
}

export interface TreeSpec {
  position: THREE.Vector3;
  scale: number;
  eraIndex: number;
}

export interface RoadSpec {
  points: THREE.Vector3[];
  width: number;
}

export interface CityLayout {
  roads: RoadSpec[];
  buildingLots: THREE.Vector3[];
  vehicleRoutes: THREE.Vector3[][];
  pedestrianPaths: THREE.Vector3[][];
  streetLights: StreetLightSpec[];
  trees: TreeSpec[];
}

export interface EraTheme {
  skyColor: number;
  fogColor: number;
  fogDensity: number;
  groundColor: number;
  ambientIntensity: number;
  sunIntensity: number;
  sunColor: number;
  sunPosition: THREE.Vector3;
}

export interface SimSnapshot {
  era: Era;
  eraIndex: number;
  buildings: BuildingSpec[];
  vehicles: VehicleSpec[];
  pedestrians: PedestrianSpec[];
  streetLights: StreetLightSpec[];
  trees: TreeSpec[];
}

export interface PathNode {
  position: THREE.Vector3;
  neighbors: number[];
}

export interface PathfindingGraph {
  nodes: PathNode[];
}
