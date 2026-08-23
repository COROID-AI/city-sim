import { noise, tone, noiseBuffer, pulseLoop } from '../synth.js';

export const SFX_NAMES = Object.freeze([
  'murmur', 'machine', 'steam', 'clatter', 'door', 'radio-static',
  'jukebox-clunk', 'record-drop', 'cassette', 'tape-hiss', 'click-wheel',
  'smart-chime', 'notification', 'transition-swoosh',
]);

function burst(ctx, destination, frequency, level = .08, duration = .12, type = 'square') {
  tone(ctx, destination, ctx.currentTime, frequency, duration, { type, level });
}

export function playSfx(ctx, destination, name) {
  if (!ctx || !destination) return;
  const now = ctx.currentTime;
  if (name === 'transition-swoosh') {
    const n = noise(ctx, destination, now, 1.1, { filter: 'bandpass', frequency: 400, q: .5, level: .13 });
    n.filter.frequency.setValueAtTime(180, now);
    n.filter.frequency.exponentialRampToValueAtTime(4200, now + .85);
  } else if (name === 'murmur') noise(ctx, destination, now, .35, { frequency: 420, q: 4, level: .045 });
  else if (name === 'machine') noise(ctx, destination, now, .8, { filter: 'highpass', frequency: 1800, level: .055 });
  else if (name === 'steam') noise(ctx, destination, now, .22, { filter: 'highpass', frequency: 3500, level: .1 });
  else if (name === 'clatter') { burst(ctx, destination, 1900, .09, .045); burst(ctx, destination, 2800, .05, .07, 'sine'); }
  else if (name === 'door') { burst(ctx, destination, 784, .08, .18, 'sine'); burst(ctx, destination, 1174, .06, .3, 'sine'); }
  else if (name === 'radio-static' || name === 'tape-hiss') noise(ctx, destination, now, .45, { filter: 'highpass', frequency: 3200, level: .06 });
  else if (name === 'jukebox-clunk' || name === 'record-drop') { burst(ctx, destination, 90, .13, .1, 'square'); burst(ctx, destination, name === 'record-drop' ? 420 : 150, .08, .18, 'triangle'); }
  else if (name === 'cassette') { burst(ctx, destination, 230, .1, .09); burst(ctx, destination, 120, .08, .12); }
  else if (name === 'click-wheel') burst(ctx, destination, 2100, .06, .025);
  else if (name === 'smart-chime') { burst(ctx, destination, 880, .07, .2, 'sine'); burst(ctx, destination, 1320, .05, .3, 'sine'); }
  else if (name === 'notification') { burst(ctx, destination, 1046, .06, .09, 'sine'); burst(ctx, destination, 1318, .05, .12, 'sine'); }
}

export function startAmbient(ctx, destination, weights) {
  const beds = [];
  const stops = [];
  const bed = (filter, frequency, level, weight) => {
    const source = ctx.createBufferSource(); source.buffer = noiseBuffer(ctx, 2); source.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.value = frequency; f.Q.value = 1.5;
    const gain = ctx.createGain(); gain.gain.value = level * (weights[weight] ?? 1);
    source.connect(f).connect(gain).connect(destination); source.start(); beds.push({ source, gain });
  };
  bed('bandpass', 520, .09, 'murmur');
  bed('bandpass', 1100, .035, 'murmur');
  bed('highpass', 2400, .045, 'machine');
  // Intermittent procedural café activity keeps the beds alive without becoming a jingle.
  stops.push(pulseLoop(ctx, destination, 3.7, (now) => noise(ctx, destination, now, .18, { filter: 'highpass', frequency: 3000, level: .025 * (weights.machine ?? 1) })));
  stops.push(pulseLoop(ctx, destination, 5.2, (now) => { tone(ctx, destination, now, 1900, .035, { type: 'square', level: .035 * (weights.clatter ?? 1) }); tone(ctx, destination, now + .04, 2700, .05, { level: .02 }); }));
  return { beds, stop: () => { stops.forEach((stop) => stop()); beds.forEach((b) => { try { b.source.stop(); b.source.disconnect(); } catch {} }); } };
}
