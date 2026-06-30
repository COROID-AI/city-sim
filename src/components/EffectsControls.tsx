'use client';

/**
 * EffectsControls
 *
 * Bottom-left HUD widget with toggle switches for particle systems and
 * bloom post-processing. Follows the same visual pattern as AudioControls.
 * All state is read from the effects store.
 */
import { useEffectsStore } from '@/store/effectsStore';

export default function EffectsControls() {
  const particlesEnabled = useEffectsStore((s) => s.particlesEnabled);
  const bloomEnabled = useEffectsStore((s) => s.bloomEnabled);
  const toggleParticles = useEffectsStore((s) => s.toggleParticles);
  const toggleBloom = useEffectsStore((s) => s.toggleBloom);

  return (
    <div
      className="pointer-events-auto absolute bottom-6 left-6 z-20 flex items-center gap-3"
      data-testid="effects-controls"
    >
      {/* Particles toggle */}
      <button
        type="button"
        onClick={toggleParticles}
        aria-pressed={particlesEnabled}
        aria-label={
          particlesEnabled
            ? 'Disable particle effects'
            : 'Enable particle effects'
        }
        title={
          particlesEnabled
            ? 'Disable particle effects'
            : 'Enable particle effects'
        }
        className={
          'flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors ' +
          (particlesEnabled
            ? 'border-white/10 bg-black/50 text-amber-300 hover:text-amber-200'
            : 'border-white/10 bg-black/50 text-gray-500 hover:text-gray-300')
        }
        data-testid="particles-toggle"
        data-enabled={particlesEnabled ? 'true' : 'false'}
      >
        {/* Sparkle/particle icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M12 2L14.5 9.5L22 12L14.5 14.5L12 22L9.5 14.5L2 12L9.5 9.5L12 2Z" />
        </svg>
      </button>

      {/* Bloom toggle */}
      <button
        type="button"
        onClick={toggleBloom}
        aria-pressed={bloomEnabled}
        aria-label={
          bloomEnabled ? 'Disable bloom effect' : 'Enable bloom effect'
        }
        title={
          bloomEnabled ? 'Disable bloom effect' : 'Enable bloom effect'
        }
        className={
          'flex h-10 w-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors ' +
          (bloomEnabled
            ? 'border-white/10 bg-black/50 text-violet-300 hover:text-violet-200'
            : 'border-white/10 bg-black/50 text-gray-500 hover:text-gray-300')
        }
        data-testid="bloom-toggle"
        data-enabled={bloomEnabled ? 'true' : 'false'}
      >
        {/* Glow/bloom icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="5" />
          <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </button>

      {/* Label */}
      <span
        className="hidden text-xs text-gray-400 sm:inline"
        data-testid="effects-label"
      >
        FX
      </span>
    </div>
  );
}
