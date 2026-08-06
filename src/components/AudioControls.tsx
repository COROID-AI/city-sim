import { useState } from 'react';
import { audioManager } from '../audio';

/**
 * Volume + mute controls wired to the shared {@link AudioManager}.
 *
 * The slider maps 0..1 onto the master volume; the mute button toggles
 * muting. Interacting with these controls also counts as a user gesture,
 * so the underlying audio context is unlocked on first use.
 */
export function AudioControls() {
  const [volume, setVolumeState] = useState(0.8);
  const [muted, setMutedState] = useState(false);

  const handleVolume = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setVolumeState(value);
    audioManager.setVolume(value);
    if (muted && value > 0) {
      setMutedState(false);
      audioManager.setMuted(false);
    }
  };

  const handleMute = () => {
    const next = !muted;
    setMutedState(next);
    audioManager.setMuted(next);
  };

  return (
    <div className="audio-controls" aria-label="Audio controls">
      <button
        type="button"
        className="audio-mute"
        onClick={handleMute}
        aria-pressed={muted}
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? '🔇' : '🔊'}
      </button>
      <input
        type="range"
        className="audio-volume"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={handleVolume}
        aria-label="Volume"
      />
    </div>
  );
}
