import { tone, noise, pulseLoop, stereo } from '../synth.js';
export const profile = { year: 2005, style: 'pop-punk / indie pluck', ambience: { murmur: .24, machine: .22, clatter: .18, source: .34 } };
export function start(ctx, bus) {
  const stops = [], wide = stereo(ctx, bus, .45);
  stops.push(pulseLoop(ctx, wide, .25, (now) => { const i = Math.floor(now / .25) % 8; tone(ctx, wide, now, [146.83, 196, 220, 246.94][i % 4], .18, { type: 'sawtooth', level: .1 }); if (i % 4 === 0 || i % 4 === 2) noise(ctx, wide, now, .04, { filter: 'highpass', frequency: 3600, level: .13 }); }));
  return () => stops.forEach((stop) => stop());
}
