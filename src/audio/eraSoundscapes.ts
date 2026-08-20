import { TIME_PERIODS } from '../state/timePeriods';
import type { EraSoundscape } from '../state/types';

/**
 * Era soundscape helpers: resolve the interpolated soundscape coefficients
 * for a fractional era position (0..ERA_COUNT-1) and produce descriptive tags
 * used by the HUD.
 */
export function soundscapeForPosition(position: number): EraSoundscape {
  const clamped = Math.min(TIME_PERIODS.length - 1, Math.max(0, position));
  const idx = Math.min(TIME_PERIODS.length - 2, Math.floor(clamped));
  const t = clamped - idx;
  const from = TIME_PERIODS[idx]?.sounding ?? TIME_PERIODS[0]!.sounding;
  const to = TIME_PERIODS[idx + 1]?.sounding ?? from;
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    level: lerp(from.level, to.level),
    tag: t < 0.5 ? from.tag : to.tag,
    wind: lerp(from.wind, to.wind),
    birds: lerp(from.birds, to.birds),
    crowd: lerp(from.crowd, to.crowd),
    traffic: lerp(from.traffic, to.traffic),
    hum: lerp(from.hum, to.hum),
    tonal: lerp(from.tonal, to.tonal),
    sweeps: lerp(from.sweeps, to.sweeps),
    weather: lerp(from.weather, to.weather),
    mode: Math.round(lerp(from.mode, to.mode)),
    lfoRate: lerp(from.lfoRate, to.lfoRate),
  };
}

/** Year label for a fractional position (for HUD readouts). */
export function yearForPosition(position: number): number {
  const years = TIME_PERIODS.map((p) => p.year);
  const clamped = Math.min(TIME_PERIODS.length - 1, Math.max(0, position));
  const idx = Math.min(TIME_PERIODS.length - 2, Math.floor(clamped));
  const t = clamped - idx;
  const a = years[idx] ?? years[0]!;
  const b = years[idx + 1] ?? a;
  return Math.round(a + (b - a) * t);
}