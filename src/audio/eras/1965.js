import { tone, noise, pulseLoop } from '../synth.js';
export const profile = { year: 1965, style: 'dry jukebox pop / AM radio', ambience: { murmur: .2, machine: .2, clatter: .16, source: .36 } };
export function start(ctx, bus) {
  const stops = [];
  const bass = [98, 123.47, 146.83, 130.81];
  stops.push(pulseLoop(ctx, bus, .25, (now) => { const i = Math.floor(now / .25) % 16; if (i % 4 === 0 || i % 4 === 2) noise(ctx, bus, now, .045, { filter: 'highpass', frequency: 2800, level: .11 }); tone(ctx, bus, now, bass[i % 4], .16, { type: 'triangle', level: .1 }); }));
  stops.push(pulseLoop(ctx, bus, 1, (now) => tone(ctx, bus, now, [392, 440, 523.25, 587.33][Math.floor(now) % 4], .35, { type: 'square', level: .07 })));
  return () => stops.forEach((stop) => stop());
}
