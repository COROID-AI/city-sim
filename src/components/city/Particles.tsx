'use client';

/**
 * Particles
 *
 * Era-specific atmospheric particle systems rendered as animated point sprites
 * inside the R3F Canvas. Each era defines distinct particle layers (steam,
 * neon flicker, holographic motes, etc.) that contribute to the mood.
 *
 * Particles are animated via `useFrame` — each particle's position is updated
 * based on its layer's speed, drift, and lifetime. When a particle's age
 * exceeds its lifetime it resets to a new random spawn position.
 *
 * The entire system can be toggled off via the effects store.
 */
import { useRef, useMemo, type FC } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Points } from 'three';
import { useEffectsStore } from '@/store/effectsStore';
import { getParticleLayers, type ParticleLayer } from '@/config/particleConfig';
import type { EraId } from '@/config/years';

/** Simple string hash for seeding. */
function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Returns a function that produces values in [0, 1).
 */
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A single particle layer rendered as a `<points>` cloud.
 */
const ParticleCloud: FC<{ layer: ParticleLayer; era: EraId }> = ({
  layer,
  era,
}) => {
  const pointsRef = useRef<Points>(null);
  const agesRef = useRef<Float32Array | null>(null);

  const { positions, ages, seeds } = useMemo(() => {
    const pos = new Float32Array(layer.count * 3);
    const age = new Float32Array(layer.count);
    const seed = new Float32Array(layer.count);
    const r = seededRandom(hashCode(layer.id + era));
    for (let i = 0; i < layer.count; i++) {
      const angle = r() * Math.PI * 2;
      const radius = r() * layer.spawnRadius;
      pos[i * 3] = layer.spawnX + Math.cos(angle) * radius;
      pos[i * 3 + 1] = layer.spawnY + r() * 5;
      pos[i * 3 + 2] = layer.spawnZ + Math.sin(angle) * radius;
      age[i] = r() * layer.lifetime; // stagger initial ages
      seed[i] = r();
    }
    return { positions: pos, ages: age, seeds: seed };
  }, [layer, era]);

  agesRef.current = ages;

  useFrame((_, delta) => {
    const points = pointsRef.current;
    const ageArr = agesRef.current;
    if (!points || !ageArr) return;

    const posAttr = points.geometry.getAttribute('position') as THREE.BufferAttribute;
    const dt = Math.min(delta, 0.1); // cap to avoid jumps on tab-switch

    const r = seededRandom(42); // deterministic drift

    for (let i = 0; i < layer.count; i++) {
      ageArr[i] += dt;

      // Reset particle when its lifetime expires
      if (ageArr[i] >= layer.lifetime) {
        ageArr[i] = 0;
        const angle = r() * Math.PI * 2;
        const radius = r() * layer.spawnRadius;
        posAttr.setXYZ(
          i,
          layer.spawnX + Math.cos(angle) * radius,
          layer.spawnY,
          layer.spawnZ + Math.sin(angle) * radius,
        );
      } else {
        // Animate: drift + vertical speed
        const particleSeed = seeds[i];
        const driftPhase = ageArr[i] * 2 + particleSeed * 10;
        const dx = Math.sin(driftPhase) * layer.driftX * dt;
        const dz = Math.cos(driftPhase * 0.7) * layer.driftZ * dt;
        const dy = layer.speedY * dt;
        posAttr.setX(i, posAttr.getX(i) + dx);
        posAttr.setY(i, posAttr.getY(i) + dy);
        posAttr.setZ(i, posAttr.getZ(i) + dz);
      }
    }

    posAttr.needsUpdate = true;

    // Flicker: modulate opacity via the material
    if (layer.flicker > 0) {
      const mat = points.material as THREE.PointsMaterial;
      const flick = 1 - layer.flicker * 0.5 * (0.5 + 0.5 * Math.sin(ageArr[0] * 12));
      mat.opacity = layer.opacity * Math.max(0.1, flick);
    }
  });

  return (
    <points ref={pointsRef} data-testid={`particles-${layer.id}`}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={layer.color}
        size={layer.size}
        transparent
        opacity={layer.opacity}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
};

interface ParticlesProps {
  era: EraId;
}

/**
 * Particles — renders all particle layers for the active era.
 */
const Particles: FC<ParticlesProps> = ({ era }) => {
  const particlesEnabled = useEffectsStore((s) => s.particlesEnabled);
  const layers = useMemo(() => getParticleLayers(era), [era]);

  if (!particlesEnabled || layers.length === 0) return null;

  return (
    <group data-testid="particles-group">
      {layers.map((layer) => (
        <ParticleCloud key={layer.id} layer={layer} era={era} />
      ))}
    </group>
  );
};

export default Particles;
