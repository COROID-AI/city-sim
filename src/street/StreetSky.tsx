import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { SkyConfig } from './streetConfig';

/** Radius of the sky dome. The dome hugs the camera so it never clips. */
const SKY_RADIUS = 160;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPosition.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  uniform float sunIntensity;
  uniform float haze;
  varying vec3 vWorldPosition;

  void main() {
    vec3 dir = normalize(vWorldPosition);
    float h = clamp(dir.y, 0.0, 1.0);

    // Vertical gradient from horizon to zenith.
    vec3 sky = mix(horizonColor, topColor, pow(h, 0.55));

    // Sun disc + soft halo, placed along the era's sun direction.
    float sunDot = clamp(dot(dir, normalize(sunDirection)), 0.0, 1.0);
    float sunDisc = pow(sunDot, 96.0) * sunIntensity;
    float sunHalo = pow(sunDot, 5.0) * sunIntensity * 0.18;

    vec3 color = sky + sunColor * (sunDisc + sunHalo);

    // Atmospheric haze / smog washes the sky toward the horizon color.
    color = mix(color, horizonColor, haze * (1.0 - h));

    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * Era-variant procedural sky dome rendered with a custom shader.
 * Colors, sun direction/intensity, and haze all come from the era config.
 */
export function StreetSky({ config }: { config: SkyConfig }) {
  const meshRef = useRef<THREE.Mesh>(null);

  const uniforms = useMemo(
    () => ({
      topColor: { value: new THREE.Color(config.topColor) },
      horizonColor: { value: new THREE.Color(config.horizonColor) },
      sunColor: { value: new THREE.Color(config.sunColor) },
      sunDirection: {
        value: new THREE.Vector3(...config.sunDirection).normalize(),
      },
      sunIntensity: { value: config.sunIntensity },
      haze: { value: config.haze },
    }),
    [config],
  );

  // Keep the dome centered on the active camera so it always encloses the view.
  useFrame(({ camera }) => {
    if (meshRef.current) {
      meshRef.current.position.copy(camera.position);
    }
  });

  return (
    <mesh ref={meshRef} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[SKY_RADIUS, 32, 24]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={uniforms}
      />
    </mesh>
  );
}
