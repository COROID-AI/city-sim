'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import LoadingScreen from './ui/LoadingScreen';

// react-three-fiber requires the browser (WebGL). Load the scene client-side only.
const TimeCityScene = dynamic(() => import('./TimeCityScene'), {
  ssr: false,
});

/**
 * TimeCitySceneClient
 *
 * Wraps the dynamically-imported 3D scene with a loading screen that stays
 * visible until the Canvas has mounted and reported its first frame. The
 * `onCreated` callback on the inner Canvas flips the readiness flag.
 */
export default function TimeCitySceneClient() {
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);

  // Simulate asset-initialisation progress while the Canvas mounts. The actual
  // readiness signal comes from the Canvas `onCreated` callback below.
  useEffect(() => {
    if (ready) return;
    let frame = 0;
    const interval = setInterval(() => {
      frame += 1;
      setProgress(Math.min(0.9, frame * 0.08));
    }, 120);
    return () => clearInterval(interval);
  }, [ready]);

  return (
    <>
      <TimeCityScene onReady={() => setReady(true)} />
      <LoadingScreen ready={ready} progress={progress} />
    </>
  );
}
