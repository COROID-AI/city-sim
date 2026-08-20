import { useEffect, useRef } from 'react';
import { useSceneStore } from '../state/useSceneStore';
import { AudioManager } from '../audio/AudioManager';

/**
 * Bridges the Zustand store to the procedural AudioManager:
 *  - initializes (unlocks) audio on the first pointer/key gesture
 *  - applies the current era soundscape whenever it changes
 *  - honors mute + volume
 *  - plays a UI tick on slider drag and a transition tone on era change
 */
export function useAudioBridge() {
  const audioRef = useRef<AudioManager | null>(null);
  const lastEraRef = useRef('');

  useEffect(() => {
    const audio = new AudioManager();
    audioRef.current = audio;
    const unlock = () => {
      audio.init();
      const { muted, volume } = useSceneStore.getState();
      audio.setVolume(volume, muted);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      audio.dispose();
      audioRef.current = null;
    };
  }, []);

  // Era / mute / volume subscription.
  useEffect(() => {
    const unsubscribe = useSceneStore.subscribe((state, prev) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (state.muted !== prev.muted || state.volume !== prev.volume) {
        audio.setVolume(state.volume, state.muted);
      }
      if (state.current?.sounding?.tag && state.current.sounding.tag !== lastEraRef.current) {
        const tag = state.current.sounding.tag;
        lastEraRef.current = tag;
        audio.setEra(state.current.sounding);
        audio.playEraTransition();
      }
    });
    return unsubscribe;
  }, []);
}