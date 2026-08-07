import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { EraId } from '../contracts';
import { ERA_IDS } from '../contracts';
import { StreetEnvironment } from '../modules/street';
import './preview.css';

/**
 * Standalone preview harness for the Street & Environment module.
 *
 * Lets you flip through all five eras and toggle day/night to verify the
 * era-correct road surface, street furniture, sky, and lighting mood. This is
 * a dev harness only — integration into the main scene happens in a later
 * phase.
 */
export default function StreetPreview() {
  const [era, setEra] = useState<EraId>(1945);
  const [isNight, setIsNight] = useState(false);

  return (
    <div className="preview">
      <div className="preview-ui">
        {ERA_IDS.map((e) => (
          <button
            key={e}
            type="button"
            className={e === era ? 'active' : ''}
            onClick={() => setEra(e)}
          >
            {e}
          </button>
        ))}
        <button
          type="button"
          className={isNight ? 'active' : ''}
          onClick={() => setIsNight((v) => !v)}
        >
          {isNight ? 'Night' : 'Day'}
        </button>
      </div>
      <Canvas
        shadows
        camera={{ position: [16, 10, 16], fov: 50 }}
        className="preview-canvas"
      >
        <StreetEnvironment era={era} isNight={isNight} />
        <OrbitControls enableDamping makeDefault />
      </Canvas>
    </div>
  );
}