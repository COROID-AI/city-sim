import { tone, noise, pulseLoop } from '../synth.js';
export const profile = { year: 1945, style: 'mellow big-band swing', ambience: { murmur: .22, machine: .18, clatter: .12, source: .3 } };
export function start(ctx, bus) {
  const stops = [];
  const bass = [110, 130.81, 146.83, 130.81, 98, 116.54, 130.81, 116.54];
  const lead = [440, 523.25, 493.88, 392, 349.23, 392, 440, 329.63];
  stops.push(pulseLoop(ctx, bus, .34, (now) => { const i = Math.floor(now / .34) % bass.length; tone(ctx, bus, now, bass[i], .25, { type: 'triangle', level: .13 }); if (i % 2 === 0) tone(ctx, bus, now + .08, lead[i], .18, { type: 'square', level: .07, detune: -8 }); }));
  stops.push(pulseLoop(ctx, bus, 1.36, (now) => noise(ctx, bus, now, 1.2, { filter: 'highpass', frequency: 4500, level: .012, loop: false })));
  return () => stops.forEach((stop) => stop());
}
