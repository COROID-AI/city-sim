/** Small, allocation-light WebAudio building blocks. No audio assets are used. */
export const YEARS = Object.freeze([1945, 1965, 1985, 2005, 2025]);

export function envelope(ctx, destination, now, duration, level = 0.15, attack = 0.01) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.linearRampToValueAtTime(level, now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  gain.connect(destination);
  return gain;
}

export function tone(ctx, destination, now, frequency, duration, options = {}) {
  const osc = ctx.createOscillator();
  const gain = envelope(ctx, destination, now, duration, options.level ?? 0.12, options.attack);
  osc.type = options.type || 'sine';
  osc.frequency.setValueAtTime(frequency, now);
  if (options.detune) osc.detune.setValueAtTime(options.detune, now);
  osc.connect(gain);
  osc.start(now); osc.stop(now + duration + 0.03);
  return osc;
}

export function noiseBuffer(ctx, seconds = 2) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

export function noise(ctx, destination, now, duration, options = {}) {
  const source = ctx.createBufferSource();
  source.buffer = options.buffer || noiseBuffer(ctx, Math.max(1, duration));
  source.loop = Boolean(options.loop);
  const filter = ctx.createBiquadFilter();
  filter.type = options.filter || 'bandpass';
  filter.frequency.value = options.frequency || 1200;
  filter.Q.value = options.q || 0.7;
  const gain = envelope(ctx, destination, now, duration, options.level ?? 0.035, options.attack ?? 0.02);
  source.connect(filter).connect(gain);
  source.start(now); if (!options.loop) source.stop(now + duration + 0.03);
  return { source, gain, filter };
}

export function pulseLoop(ctx, destination, interval, callback) {
  let stopped = false;
  let timer;
  const tick = () => { if (stopped) return; callback(ctx.currentTime); timer = setTimeout(tick, interval * 1000); };
  tick();
  return () => { stopped = true; clearTimeout(timer); };
}

export function stereo(ctx, destination, width = 0.6) {
  const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (panner) { panner.pan.value = width; panner.connect(destination); return panner; }
  return destination;
}
