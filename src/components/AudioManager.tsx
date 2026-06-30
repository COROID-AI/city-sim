'use client';

/**
 * AudioManager
 *
 * Headless controller component that bridges the AudioEngine, the audio
 * preference store, and the year store. Responsibilities:
 *
 *  - Unlock the AudioContext on the first user gesture (autoplay policy).
 *  - Start the ambient city drone once audio is unlocked.
 *  - Play the year-change SFX and shift the ambient character whenever the
 *    selected era changes.
 *  - Keep the AudioEngine's mute/volume in sync with the audio store.
 *  - Occasionally trigger ambient vehicle-horn and pedestrian-chatter blips
 *    for liveliness.
 *
 * Renders nothing to the DOM.
 */
import { useEffect, useRef } from 'react';
import { AudioEngine } from '@/audio/AudioEngine';
import { useAudioStore } from '@/store/audioStore';
import { useYearStore } from '@/store/yearStore';

export default function AudioManager() {
  const muted = useAudioStore((s) => s.muted);
  const volume = useAudioStore((s) => s.volume);
  const unlocked = useAudioStore((s) => s.unlocked);
  const setUnlocked = useAudioStore((s) => s.setUnlocked);
  const setSfxPulse = useAudioStore((s) => s.setSfxPulse);

  const targetYear = useYearStore((s) => s.targetYear);

  // Track the previously-seen era so we only fire the SFX on actual changes.
  const prevEraRef = useRef<string | null>(null);
  // Ambient blip scheduler handle.
  const blipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ------------------------------------------------------------------ */
  /* Autoplay unlock: listen for the first user gesture.                */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (unlocked) {
      return;
    }

    const handleGesture = () => {
      const ok = AudioEngine.unlock();
      if (ok) {
        setUnlocked(true);
      }
    };

    // A broad set of gesture types covers mouse, touch, and keyboard users.
    window.addEventListener('pointerdown', handleGesture, { once: true });
    window.addEventListener('keydown', handleGesture, { once: true });

    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
  }, [unlocked, setUnlocked]);

  /* ------------------------------------------------------------------ */
  /* Sync mute / volume from the store into the engine.                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    AudioEngine.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    AudioEngine.setVolume(volume);
  }, [volume]);

  /* ------------------------------------------------------------------ */
  /* Start the ambient drone once unlocked.                             */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (unlocked) {
      AudioEngine.startAmbient(targetYear);
    }
    // We intentionally only depend on `unlocked` here — starting the ambient
    // layer twice is a no-op inside the engine.
  }, [unlocked, targetYear]);

  /* ------------------------------------------------------------------ */
  /* React to era changes: play SFX + morph ambient.                    */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    // Shift the ambient character regardless of unlock state (no-op until
    // the context exists).
    AudioEngine.setEra(targetYear);

    if (prevEraRef.current !== null && prevEraRef.current !== targetYear) {
      // Fire the one-shot transition SFX.
      AudioEngine.playYearChangeSfx();
      // Pulse the UI indicator briefly.
      setSfxPulse(true);
      window.setTimeout(() => setSfxPulse(false), 600);
    }
    prevEraRef.current = targetYear;
  }, [targetYear, setSfxPulse]);

  /* ------------------------------------------------------------------ */
  /* Ambient life blips: horns + chatter at random intervals.           */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!unlocked || muted) {
      return;
    }

    const scheduleBlip = () => {
      const delay = 4000 + Math.random() * 6000;
      blipTimerRef.current = setTimeout(() => {
        // Alternate between horn and chatter for variety.
        if (Math.random() < 0.5) {
          AudioEngine.playHorn();
        } else {
          AudioEngine.playChatter();
        }
        scheduleBlip();
      }, delay);
    };

    scheduleBlip();

    return () => {
      if (blipTimerRef.current) {
        clearTimeout(blipTimerRef.current);
        blipTimerRef.current = null;
      }
    };
  }, [unlocked, muted]);

  // Headless — renders nothing.
  return null;
}
