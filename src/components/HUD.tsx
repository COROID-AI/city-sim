import { useSceneStore } from '../state/useSceneStore';
import { TIME_PERIODS } from '../state/timePeriods';
import { soundscapeForPosition, yearForPosition } from '../audio/eraSoundscapes';

/**
 * HUD: DOM overlay with the current era, interpolated year, soundscape tag,
 * clock/day-phase, playback badge, and keyboard help. Purely presentational.
 */
export function HUD() {
  const position = useSceneStore((s) => s.position);
  const dayTime = useSceneStore((s) => s.dayTime);
  const playing = useSceneStore((s) => s.playing);
  const muted = useSceneStore((s) => s.muted);
  const volume = useSceneStore((s) => s.volume);

  const year = yearForPosition(position);
  const sound = soundscapeForPosition(position);
  const eraIdx = Math.min(TIME_PERIODS.length - 1, Math.max(0, Math.round(position)));
  const era = TIME_PERIODS[eraIdx] ?? TIME_PERIODS[0]!;

  const sun = (dayTime - 0.5) * Math.PI * 2;
  const dayFactor = Math.max(0, Math.sin(sun));

  const clock = dayTime * 24;
  const hh = Math.floor(clock);
  const mm = Math.round((clock - hh) * 60);
  const timeStr = `${String(hh).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`;

  return (
    <div className="hud">
      <div className="hud-top">
        <div className="hud-title">
          <span className="hud-kicker">City Time Period</span>
          <span className="hud-era">{era.label}</span>
        </div>
        <div className="hud-year">
          <span className="hud-year-num">{year}</span>
          <span className="hud-tag">{sound.tag}</span>
        </div>
        <div className="hud-clock">
          <span className="clock-icon">☀</span>
          <span>{timeStr}</span>
          <span className="hud-daynight">
            {dayFactor > 0.55 ? 'Day' : dayFactor > 0.18 ? 'Dusk' : 'Night'}
          </span>
        </div>
      </div>
      <div className="hud-status">
        <span className={`badge ${playing ? 'badge-live' : ''}`}>
          {playing ? '● TIMELAPSE' : 'MANUAL'}
        </span>
        <span className={`badge ${muted ? 'badge-muted' : ''}`}>
          {muted ? 'MUTED' : 'AUDIO'}
        </span>
        <span className="badge badge-dim">VOL {Math.round(volume * 100)}%</span>
      </div>
      <div className="hud-help">
        <span>← → era</span>
        <span>Space play</span>
        <span>R reset</span>
        <span>M mute</span>
        <span>↑ ↓ sun</span>
      </div>
    </div>
  );
}