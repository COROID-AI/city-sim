import { useMemo } from 'react';
import * as THREE from 'three';
import type { EraStreetConfig } from './eraConfig';

/**
 * Procedural, era-correct sky dome.
 *
 * A large back-facing sphere shaded with a custom gradient shader:
 *  - vertical gradient from `horizonColor` (near the horizon) to
 *    `topColor` (near the zenith),
 *  - a soft haze band that thickens toward the horizon (drives the
 *    1985 smoggy look),
 *  - a directional glow centred on the era's sun.
 *
 * No external skybox assets are required.
 */
export function ProceduralSky({ config }: { config: EraStreetConfig }) {
  const material = useMemo(() => {
    const sunDirection = new THREE.Vector3(
      ...config.sun.position,
    ).normalize();

    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(config.sky.topColor) },
        horizonColor: { value: new THREE.Color(config.sky.horizonColor) },
        sunColor: { value: new THREE.Color(config.sky.sunColor) },
        sunDirection: { value: sunDirection },
        sunIntensity: { value: config.sun.intensity },
        haze: { value: config.sky.haze },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        uniform float sunIntensity;
        uniform float haze;
        varying vec3 vWorldPosition;

        void main() {
          vec3 dir = normalize(vWorldPosition);
          float t = max(dir.y, 0.0);

          // Vertical gradient: horizon -> zenith.
          vec3 color = mix(horizonColor, topColor, pow(t, 0.6));

          // Haze / smog thickening toward the horizon.
          float hazeFactor = pow(1.0 - t, 2.2) * haze;
          vec3 hazeColor = horizonColor * 0.92;
          color = mix(color, hazeColor, clamp(hazeFactor, 0.0, 0.85));

          // Sun glow.
          float sunDot = max(dot(dir, normalize(sunDirection)), 0.0);
          float glow = pow(sunDot, 64.0) * sunIntensity;
          color += sunColor * glow;

          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
  }, [config]);

  return (
    <mesh material={material}>
      <sphereGeometry args={[80, 32, 32]} />
    </mesh>
  );
}