import { useFrame } from '@react-three/fiber';
import { useSim, yearFromT, eraLabel } from './sim';
import { audioEngine } from './audio';

/**
 * Advances the simulated timeline (era t) and clock (hour) each rendered frame.
 * Runs inside the Canvas render loop so playback is decoupled from React state
 * reconciliation - scene systems read the latest values imperatively.
 */
export default function SimClock() {
  useFrame((_, delta) => {
    const s = useSim.getState();
    if (!s.playing) return;
    const dt = Math.min(delta, 0.1);
    const nextT = Math.min(1, s.t + dt * 0.018 * s.speed);
    // simulated clock: 24h cycle every ~90s of replay at 1x
    let nextHour = s.hour + dt * 0.26 * s.speed;
    if (nextHour >= 24) nextHour -= 24;
    useSim.setState({ t: nextT, hour: nextHour });
    void yearFromT(nextT);
    void eraLabel(nextT);

    // ambient wind SFX tied to day/night
    if (s.soundEnabled && !s.muted) {
      const daylight = Math.min(1, Math.max(0, (nextHour - 5) / 13));
      audioEngine.wind(daylight, 0.9);
    }
  });
  return null;
}