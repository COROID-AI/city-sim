import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { EraId } from '../contracts';
import { ERA_IDS } from '../contracts';
import { Buildings } from '../modules/buildings';
import './preview.css';

/**
 * Standalone preview harness for the Buildings module.
 *
 * Lets you flip through all five eras and toggle day/night to verify the
 * era-correct architecture, materials, and window patterns. This is a dev
 * harness only — integration into the main scene happens in a later phase.
 */
export default function BuildingsPreview() {
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
        camera={{ position: [12, 9, 14], fov: 50 }}
        className="preview-canvas"
      >
        <color attach="background" args={[isNight ? '#04060b' : '#aac6da']} />
        <Buildings era={era} isNight={isNight} />
        <OrbitControls enableDamping makeDefault />
      </Canvas>
    </div>
  );
}
