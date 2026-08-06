import { useAudioStore } from '../store/useAudioStore';

/**
 * Header audio controls: a mute toggle and a volume slider, wired to the
 * shared audio store (and through it to the Web Audio manager).
 */
export function AudioControls() {
  const volume = useAudioStore((s) => s.volume);
  const muted = useAudioStore((s) => s.muted);
  const setVolume = useAudioStore((s) => s.setVolume);
  const toggleMuted = useAudioStore((s) => s.toggleMuted);

  return (
    <div className="audio-controls" role="group" aria-label="Audio controls">
      <button
        type="button"
        className="mute-button"
        aria-pressed={muted}
        aria-label={muted ? 'Unmute audio' : 'Mute audio'}
        onClick={toggleMuted}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <input
        type="range"
        className="volume-slider"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        disabled={muted}
        aria-label="Volume"
        onChange={(e) => setVolume(parseFloat(e.target.value))}
      />
    </div>
  );
}
