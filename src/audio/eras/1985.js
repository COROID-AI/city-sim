import { tone, noise, pulseLoop, stereo } from '../synth.js';
export const profile = { year: 1985, style: 'analog synthpop / gated snare', ambience: { murmur: .18, machine: .16, clatter: .12, source: .42 } };
export function start(ctx, bus) {
  const stops = [];
  const pad = ctx.createGain(); pad.gain.value = .025; const wide = stereo(ctx, bus, -.35); pad.connect(wide);
  [220, 277.18, 329.63].forEach((f) => tone(ctx, pad, ctx.currentTime, f, 4, { type: 'sawtooth', level: .1, detune: 6 }));
  stops.push(pulseLoop(ctx, bus, .125, (now) => { const i = Math.floor(now / .125) % 16; tone(ctx, bus, now, [220, 277, 330, 440][i % 4], .1, { type: 'square', level: .055 }); if (i % 4 === 2) noise(ctx, bus, now, .055, { filter: 'bandpass', frequency: 1800, level: .12 }); }));
  return () => stops.forEach((stop) => stop());
}
