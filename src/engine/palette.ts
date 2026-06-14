/**
 * Single source of truth for the city simulation color palette.
 *
 * Every color used by the renderer (and any other engine consumer) is
 * resolved through this module. Renderer code MUST NOT hardcode hex
 * strings — it must look them up here. This keeps the visual identity
 * consistent across the ground, road, building, and (future) citizen
 * layers and makes the palette trivially swappable for theming.
 *
 * The values are aligned with the Tailwind v4 design tokens declared in
 * the global stylesheet (see `tailwind_v4_tokens` discovery): surface,
 * ground, road, building, citizen, accent, warning. We use hex strings
 * rather than CSS custom properties so this module is consumable from
 * any canvas 2D context without needing DOM access at draw time.
 */

export interface CityPalette {
  /** Page / canvas background behind the world. */
  readonly background: string;
  /** Bare ground tiles (grass, dirt). */
  readonly ground: string;
  /** Slightly darker ground accent for subtle tile variation. */
  readonly groundAlt: string;
  /** Roads and streets. */
  readonly road: string;
  /** Road lane markings / centerline. */
  readonly roadMarking: string;
  /** Water tiles (rivers, lakes). */
  readonly water: string;
  /** Park / leisure tiles. */
  readonly park: string;
  /** Lot tiles (vacant developable land). */
  readonly lot: string;
  /** Default building fill when no `BuildingDef.color` matches. */
  readonly building: string;
  /** Building shadow / depth tint. */
  readonly buildingShadow: string;
  /** Building roof accent (a small horizontal band drawn on top). */
  readonly buildingRoof: string;
  /** Citizen body color. */
  readonly citizen: string;
  /** Citizen outline / selection ring. */
  readonly citizenOutline: string;
  /** Generic UI accent (selection box, hover halo). */
  readonly accent: string;
  /** Warning / error highlight. */
  readonly warning: string;
  /** Debug grid line color. */
  readonly grid: string;
}

/**
 * Default dark-theme palette. Matches the spec section 6.1 visual reference
 * (Gemini mockup) — muted night-time city tones with a cool blue building
 * roof accent.
 */
export const DEFAULT_PALETTE: CityPalette = Object.freeze({
  background: '#0b1220',
  ground: '#1f2a3a',
  groundAlt: '#243047',
  road: '#2c3445',
  roadMarking: '#f5d76e',
  water: '#2a5a8a',
  park: '#2e6b4a',
  lot: '#3a3f4b',
  building: '#5a6478',
  buildingShadow: '#3a4254',
  buildingRoof: '#3aa0ff',
  citizen: '#f5d76e',
  citizenOutline: '#0b1220',
  accent: '#3aa0ff',
  warning: '#e74c3c',
  grid: 'rgba(255, 255, 255, 0.04)',
});

/**
 * Resolve a tile kind to a palette color. Centralises the tile→color
 * mapping so the renderer never has to switch on `TileKind` itself.
 */
export function colorForTile(
  palette: CityPalette,
  kind:
    | 'ground'
    | 'road'
    | 'water'
    | 'park'
    | 'lot',
): string {
  switch (kind) {
    case 'ground':
      return palette.ground;
    case 'road':
      return palette.road;
    case 'water':
      return palette.water;
    case 'park':
      return palette.park;
    case 'lot':
      return palette.lot;
  }
}
