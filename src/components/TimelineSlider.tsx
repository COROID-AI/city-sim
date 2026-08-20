import { useCallback } from 'react';
import { useSceneStore } from '../state/useSceneStore';
import { TIME_PERIODS, ERA_COUNT } from '../state/timePeriods';

/**
 * TimelineSlider: the primary era control, pinned to the top of the viewport.
 * Scrubbing writes a fractional position into the store; every scene system
 * lerps between the two adjacent eras, so the city transforms smoothly
 * instead of hard-cutting. Clicking a tick jumps to that era, and the auto
 * play button toggles the looping timelapse.
 */
export function TimelineSlider() {
  const position = useSceneStore((s) => s.position);
  const playing = useSceneStore((s) => s.playing);
  const muted = useSceneStore((s) => s.muted);
  const volume = useSceneStore((s) => s.volume);
  const scrubTo = useSceneStore((s) => s.scrubTo);
  const togglePlayback = useSceneStore((s) => s.togglePlayback);
  const toggleMute = useSceneStore((s) => s.toggleMute);
  const setVolume = useSceneStore((s) => s.setVolume);

  const pct = (position / (ERA_COUNT - 1)) * 100;

  const onChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      scrubTo((v / 100) * (ERA_COUNT - 1));
    },
    [scrubTo],
  );

  return (
    <div className="timeline-shell">
      <div className="timeline-inner">
        <div className="timeline-year">{TIME_PERIODS[Math.round(position)]?.shortLabel ?? ''}</div>
        <div className="timeline-track">
          <div className="timeline-ticks">
            {TIME_PERIODS.map((p) => (
              <button
                key={p.id}
                className={`tick ${Math.round(position) === TIME_PERIODS.indexOf(p) ? 'active' : ''}`}
                style={{ left: `${(p.progress * 100).toFixed(1)}%` }}
                title={p.label}
                onClick={() => scrubTo(TIME_PERIODS.indexOf(p))}
                aria-label={p.label}
              >
                <span className="tick-label">{p.shortLabel}</span>
              </button>
            ))}
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={pct}
            onChange={onChange}
            aria-label="Time period timeline"
            className="timeline-range"
          />
        </div>
        <div className="timeline-controls">
          <button
            className="control-btn"
            onClick={togglePlayback}
            title={playing ? 'Pause timelapse (Space)' : 'Play timelapse (Space)'}
          >
            {playing ? '❚❚' : '▶'}
          </button>
          <button
            className="control-btn"
            onClick={toggleMute}
            title={muted ? 'Unmute (M)' : 'Mute (M)'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            aria-label="Volume"
            className="volume-range"
          />
        </div>
      </div>
    </div>
  );
}