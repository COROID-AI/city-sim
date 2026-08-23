import { tone, noise, pulseLoop } from '../synth.js';
export const profile = { year: 2025, style: 'lo-fi beat / dusty jazz chords', ambience: { murmur: .28, machine: .2, clatter: .15, source: .3 } };
export function start(ctx, bus) {
  const stops = [], chords = [[220, 261.63, 329.63], [196, 246.94, 293.66]];
  stops.push(pulseLoop(ctx, bus, .5, (now) => { const chord = chords[Math.floor(now / .5) % 2]; chord.forEach((f) => tone(ctx, bus, now, f, .42, { type: 'triangle', level: .045 })); noise(ctx, bus, now, .045, { filter: 'lowpass', frequency: 900, level: .13 }); }));
  stops.push(pulseLoop(ctx, bus, 1.5, (now) => noise(ctx, bus, now, 1.3, { filter: 'highpass', frequency: 5000, level: .012 })));
  return () => stops.forEach((stop) => stop());
}
