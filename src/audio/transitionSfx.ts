import type { EraId } from '../contracts';
import { ERA_IDS } from '../contracts';

/**
 * A tasteful "time-shift" transition sound: a whooshing filtered-noise
 * sweep paired with a rising/falling pitch sweep. The sweep direction is
 * derived from whether the timeline is moving forward or backward in time.
 */

const SWEEP_DURATION = 1.1;

/** Generate a short looping white-noise buffer for the whoosh. */
function createWhooshNoise(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.5);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * Play the era-transition sound effect into `destination`.
 *
 * `fromEra`/`toEra` control the sweep direction: moving forward in time
 * sweeps up, moving backward sweeps down.
 */
export function playTransitionSfx(
  ctx: AudioContext,
  fromEra: EraId,
  toEra: EraId,
  destination: AudioNode,
  volume: number,
): void {
  const now = ctx.currentTime;
  const duration = SWEEP_DURATION;
  const forward = ERA_IDS.indexOf(toEra) >= ERA_IDS.indexOf(fromEra);

  // Whoosh — band-passed noise sweeping up then down.
  const src = ctx.createBufferSource();
  src.buffer = createWhooshNoise(ctx);
  src.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 1.4;
  filter.frequency.setValueAtTime(220, now);
  filter.frequency.exponentialRampToValueAtTime(4200, now + duration * 0.5);
  filter.frequency.exponentialRampToValueAtTime(320, now + duration);
  const whooshGain = ctx.createGain();
  whooshGain.gain.setValueAtTime(0, now);
  whooshGain.gain.linearRampToValueAtTime(0.5 * volume, now + duration * 0.15);
  whooshGain.gain.linearRampToValueAtTime(0.35 * volume, now + duration * 0.5);
  whooshGain.gain.linearRampToValueAtTime(0, now + duration);
  src.connect(filter).connect(whooshGain).connect(destination);
  src.start(now);
  src.stop(now + duration + 0.1);

  // Pitch sweep — the "shift" tone that sells the time jump.
  const startFreq = forward ? 280 : 1400;
  const endFreq = forward ? 1400 : 280;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(startFreq, now);
  osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
  const oscGain = ctx.createGain();
  oscGain.gain.setValueAtTime(0, now);
  oscGain.gain.linearRampToValueAtTime(0.22 * volume, now + duration * 0.2);
  oscGain.gain.linearRampToValueAtTime(0, now + duration);
  osc.connect(oscGain).connect(destination);
  osc.start(now);
  osc.stop(now + duration + 0.1);
}
