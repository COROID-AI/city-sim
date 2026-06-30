'use client';

/**
 * AudioControls
 *
 * Bottom-right HUD widget with a mute/unmute toggle for the ambient city
 * audio and a subtle pulse indicator that flashes when the year-change SFX
 * fires. The control is purely presentational — all state is read from the
 * audio store and mutations are dispatched through it.
 */
import { useAudioStore } from '@/store/audioStore';

export default function AudioControls() {
  const muted = useAudioStore((s) => s.muted);
  const unlocked = useAudioStore((s) => s.unlocked);
  const sfxPulse = useAudioStore((s) => s.sfxPulse);
  const toggleMute = useAudioStore((s) => s.toggleMute);

  return (
    <div
      className="pointer-events-auto absolute bottom-6 right-6 z-20 flex items-center gap-3"
      data-testid="audio-controls"
    >
      {/* SFX activation indicator */}
      <span
        className="flex h-3 w-3 items-center justify-center"
        aria-label={sfxPulse ? 'Year change sound active' : 'Audio idle'}
        role="status"
        data-testid="audio-sfx-indicator"
        data-pulse={sfxPulse ? 'true' : 'false'}
      >
        <span
          className={
            'h-2 w-2 rounded-full transition-all duration-300 ' +
            (sfxPulse
              ? 'scale-150 bg-cyan-300 shadow-[0_0_8px_2px_rgba(103,232,249,0.7)]'
              : 'bg-gray-600')
          }
        />
      </span>

      {/* Mute toggle */}
      <button
        type="button"
        onClick={toggleMute}
        aria-pressed={!muted}
        aria-label={muted ? 'Unmute ambient city audio' : 'Mute ambient city audio'}
        title={muted ? 'Unmute ambient city audio' : 'Mute ambient city audio'}
        className={
          'flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors ' +
          (muted
            ? 'border-white/10 bg-black/50 text-gray-500 hover:text-gray-300'
            : 'border-white/10 bg-black/50 text-cyan-300 hover:text-cyan-200')
        }
        data-testid="audio-mute-toggle"
        data-muted={muted ? 'true' : 'false'}
      >
        {muted ? (
          // Muted icon (speaker with X)
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M7 9v6h4l5 5V4l-5 5H7z" />
            <path
              d="M16 9l5 6M21 9l-5 6"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        ) : (
          // Unmuted icon (sound waves)
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-5 w-5"
            aria-hidden="true"
          >
            <path d="M7 9v6h4l5 5V4l-5 5H7z" />
            <path
              d="M16 8a5 5 0 010 8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M18.5 5.5a9 9 0 010 13"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        )}
      </button>

      {/* Subtle hint when audio is locked by autoplay policy */}
      {!unlocked && (
        <span
          className="hidden text-xs text-gray-400 sm:inline"
          data-testid="audio-unlock-hint"
        >
          Click to enable sound
        </span>
      )}
    </div>
  );
}
