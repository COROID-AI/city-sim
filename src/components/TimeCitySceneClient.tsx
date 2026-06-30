'use client';

import dynamic from 'next/dynamic';

// react-three-fiber requires the browser (WebGL). Load the scene client-side only.
const TimeCityScene = dynamic(() => import('./TimeCityScene'), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-screen items-center justify-center text-lg text-gray-400">
      Loading 3D city…
    </div>
  ),
});

export default function TimeCitySceneClient() {
  return <TimeCityScene />;
}
