export interface Vector2 {
  x: number;
  y: number;
}

export interface Tile {
  x: number;
  y: number;
  zone: string;
}

export interface BuildingDef {
  id: string;
  footprint: { width: number; height: number };
}

export interface CitizenState {
  id: string;
  position: Vector2;
}

export interface VehicleState {
  id: string;
  position: Vector2;
}

export interface CityTime {
  tick: number;
  elapsedMs: number;
}

export interface CityEconomy {
  money: number;
}

export interface CityEvent {
  type: string;
  payload?: unknown;
}

export interface UpdateContext {
  fixedDtMs: number;
  elapsedMs: number;
}
