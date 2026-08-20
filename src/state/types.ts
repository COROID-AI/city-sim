/**
 * Era configuration for the City Time Period Timelapse.
 *
 * Each era defines the visual identity of the city block at that point in
 * history. The six eras are data-driven — add, remove, or reorder entries here
 * and every scene system, the timeline slider, the HUD, and the audio manager
 * will follow automatically.
 */

export type EraId = '1900' | '1920' | '1950' | '1980' | '2010' | '2050';

export interface VehicleStyle {
  /** Fill color of the vehicle body. */
  color: string;
  /** Accent color (fenders / roof / trim). */
  accent: string;
  /** Emission color used for headlights/taillights at night. */
  light: string;
  /** Roughness of the body material. */
  roughness: number;
}

export interface EraPalette {
  /** General daylight sky gradient color (horizon). */
  sky: string;
  /** Sky gradient zenith color. */
  skyZenith: string;
  /** Sun color while it is above the horizon. */
  sun: string;
  /** Ambient fill color of the scene. */
  ambient: string;
  /** Soft fill from the opposite side of the sun. */
  fill: string;
  /** Building facade base tint applied to the lit materials. */
  facade: string;
  /** Roof / parapet tint. */
  roof: string;
  /** Sidewalk color. */
  sidewalk: string;
  /** Asphalt road color. */
  asphalt: string;
  /** Lane-marking paint color. */
  lanePaint: string;
  /** Crosswalk stripe paint color. */
  crosswalk: string;
}

export interface EraSoundscape {
  /** Relative mix level in [0, 1]; audio uses it for gain staging. */
  level: number;
  /** Short human tag shown in the HUD ("steam & soot", ...). */
  tag: string;
  /** Coefficient controlling low-frequency wind layers. */
  wind: number;
  /** Coefficient controlling bird chirp density. */
  birds: number;
  /** Coefficient controlling distant crowd murmur. */
  crowd: number;
  /** Coefficient controlling road traffic noise. */
  traffic: number;
  /** Coefficient controlling electrical / neon hum. */
  hum: number;
  /** Coefficient controlling tonal bed (organ / pad). */
  tonal: number;
  /** Coefficient controlling ethereal sweeps. */
  sweeps: number;
  /** Coefficient controlling rain / storm noise. */
  weather: number;
  /** Musical mode for the pad (0 minor, 1 major, 2 pentatonic). */
  mode: number;
  /** Rate multiplier for slow LFOs inside the soundscape. */
  lfoRate: number;
}

export interface TimePeriod {
  id: string;
  label: string;
  shortLabel: string;
  year: number;
  description: string;
  /** Blend weight used for smooth interpolation between eras. */
  progress: number;
  /** Organized / city-planning feel (0 = chaotic, 1 = grid-perfect). */
  order: number;
  /** Density of street lamps. */
  lampDensity: number;
  /** Building window glow intensity (night). */
  windowGlow: number;
  /** Brightness of the air / fog. */
  haze: number;
  /** Neon saturation of signage. */
  neon: number;
  /** Billboard count. */
  billboards: number;
  /** Tree count (indexes into a static canopy grid). */
  trees: number;
  /** Per-axis city scale multiplier. */
  scale: [number, number, number];
  /** Material UV tiling factor for facades. */
  facadeTile: number;
  palette: EraPalette;
  vehicles: VehicleStyle;
  sounding: EraSoundscape;
  /** Landmarks / street furniture added in this era only. */
  eraOnly?: {
    kind: 'waterTower' | 'park' | 'glassAtrium' | 'droneLights';
  };
}