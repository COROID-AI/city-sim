import { useEffect, useState } from 'react';
import { SceneRoot } from './scene/SceneRoot';
import { TimelineSlider } from './components/TimelineSlider';
import { HUD } from './components/HUD';
import { Loader } from './components/Loader';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useKeyboardControls } from './hooks/useKeyboardControls';
import { useTimelapsePlayback } from './hooks/useTimelapsePlayback';
import { useAudioBridge } from './hooks/useAudioBridge';

/**
 * App: composes the WebGL scene, timeline slider, HUD, loader, and audio
 * bridge. The scene loads immediately on mount; overlays sit above it.
 */
export function App() {
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useKeyboardControls();
  useTimelapsePlayback();
  useAudioBridge();

  useEffect(() => {
    // Let the canvas mount and first frames render before hiding the loader.
    const t = setTimeout(() => setLoading(false), 900);
    return () => clearTimeout(t);
  }, [reloadKey]);

  const retry = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  return (
    <ErrorBoundary key={reloadKey}>
      <div className="app">
        <SceneRoot />
        <div className="overlay">
          <TimelineSlider />
          <HUD />
          <div className="hint">
            Drag to orbit · scroll to zoom · right-drag to pan
          </div>
        </div>
        <Loader loading={loading} onRetry={retry} />
      </div>
    </ErrorBoundary>
  );
}