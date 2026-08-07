import { useEffect, useState } from 'react';
import { audioManager } from '../audio';

/**
 * Volume + mute controls wired to the shared {@link audioManager}.
 */
export function AudioControls() {
  const [volume, setVolume] = useState(audioManager.getVolume());
  const [muted, setMuted] = useState(audioManager.isMuted());

  useEffect(() => {
    setVolume(audioManager.getVolume());
    setMuted(audioManager.isMuted());
  }, []);

  const handleVolume = (event: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(event.target.value);
    setVolume(v);
    audioManager.setVolume(v);
  };

  const toggleMute = () => {
    if (audioManager.isMuted()) {
      audioManager.unmute();
      setMuted(false);
    } else {
      audioManager.mute();
      setMuted(true);
    }
  };

  return (
    <div className="audio-controls" role="group" aria-label="Audio controls">
      <button
        type="button"
        className="audio-mute"
        onClick={toggleMute}
        aria-pressed={muted}
        aria-label={muted ? 'Unmute audio' : 'Mute audio'}
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
        aria-label="Master volume"
      />
    </div>
  );
}
