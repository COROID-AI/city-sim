import { useMemo } from 'react';
import * as THREE from 'three';
import type { EraSkyConfig } from './eraConfig';

/**
 * Era-correct procedural sky dome.
 *
 * A large back-facing sphere shaded by a custom shader that blends a
 * bottom → horizon → top gradient, draws a soft sun disc + halo along the
 * era's sun direction, and washes everything toward the horizon color by a
 * per-era haze factor (smoggy 80s vs clear 2025). The shader is unlit so the
 * sky always renders correctly regardless of the scene lighting.
 */

const VERTEX = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 bottomColor;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform float sunIntensity;
  uniform float haze;
  varying vec3 vWorldPosition;

  void main() {
    vec3 dir = normalize(vWorldPosition);
    float h = clamp(dir.y, -1.0, 1.0);

    vec3 skyColor;
    if (h > 0.0) {
      skyColor = mix(horizonColor, topColor, pow(h, 0.55));
    } else {
      skyColor = mix(horizonColor, bottomColor, pow(-h, 0.4));
    }

    // Soft sun disc + wide halo along the era's sun direction.
    float sunDot = max(dot(dir, normalize(sunDirection)), 0.0);
    float disc = pow(sunDot, 400.0) * sunIntensity;
    float halo = pow(sunDot, 6.0) * sunIntensity * 0.28;
    skyColor += sunColor * (disc + halo);

    // Haze washes the sky toward the horizon color near the horizon line.
    float horizonMask = 1.0 - smoothstep(0.0, 0.4, max(h, 0.0));
    skyColor = mix(skyColor, horizonColor * (1.0 + haze * 0.2), horizonMask * haze);

    gl_FragColor = vec4(skyColor, 1.0);
  }
`;

export interface SkyDomeProps {
  config: EraSkyConfig;
}

export function SkyDome({ config }: SkyDomeProps) {
  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color(config.topColor) },
      horizonColor: { value: new THREE.Color(config.horizonColor) },
      bottomColor: { value: new THREE.Color(config.bottomColor) },
      sunDirection: {
        value: new THREE.Vector3(...config.sunDirection).normalize(),
      },
      sunColor: { value: new THREE.Color(config.sunColor) },
      sunIntensity: { value: config.sunIntensity },
      haze: { value: config.haze },
    }),
    [config],
  );

  return (
    <mesh>
      <sphereGeometry args={[80, 32, 16]} />
      <shaderMaterial
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}