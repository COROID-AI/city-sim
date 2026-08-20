import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';

/**
 * SkyDome: a large backside sphere with a gradient shader, a sun sprite, and
 * a star field. The gradient, sun color, and star opacity are all driven by
 * the store's dayTime + era palette so the transition is smooth.
 */
export function SkyDome() {
  const domeMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color('#5c87b2') },
          uHorizon: { value: new THREE.Color('#9fc2d8') },
          uBottom: { value: new THREE.Color('#e8d9b0') },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color('#fff0c0') },
          uSunIntensity: { value: 1.0 },
          uStars: { value: 0.0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorldPos;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vWorldPos = wp.xyz;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uTop;
          uniform vec3 uHorizon;
          uniform vec3 uBottom;
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform float uSunIntensity;
          uniform float uStars;
          varying vec3 vWorldPos;
          void main() {
            vec3 dir = normalize(vWorldPos);
            float h = clamp(dir.y + 0.35, 0.0, 1.0);
            vec3 col = mix(uBottom, uHorizon, smoothstep(0.0, 0.45, h));
            col = mix(col, uTop, smoothstep(0.35, 1.0, h));

            // Sun glow disc.
            float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
            col += uSunColor * uSunIntensity * pow(sunDot, 220.0);
            col += uSunColor * uSunIntensity * 0.25 * pow(sunDot, 12.0);

            // Stars in the upper dome.
            vec3 cu = ceil(dir * 140.0);
            float hsh = fract(sin(dot(cu, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            if (dir.y > 0.08 && hsh > 0.985) {
              col += vec3(0.9) * uStars * step(0.4, hsh);
            }
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    [],
  );

  const sunMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: '#fff0c0',
        fog: false,
      }),
    [],
  );
  const sunRef = useRef<THREE.Mesh>(null);
  const starRef = useRef<THREE.Mesh>(null);

  // Star dot mesh (many tiny points baked on a sphere).
  const starGeo = useMemo(() => {
    const N = 500;
    const pos = new Float32Array(N * 3);
    const rnd = mulberry32(0x5eed);
    for (let i = 0; i < N; i++) {
      const u = rnd() * 2 - 1;
      const phi = rnd() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      pos[i * 3] = r * Math.cos(phi) * 120;
      pos[i * 3 + 1] = u * 120;
      pos[i * 3 + 2] = r * Math.sin(phi) * 120;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }, []);

  useFrame(() => {
    const { current, dayTime } = useSceneStore.getState();
    const sun = (dayTime - 0.5) * Math.PI * 2;
    const dayFactor = Math.max(0, Math.sin(sun));
    const night = 1 - dayFactor;
    const sunDir = new THREE.Vector3(
      Math.cos(sun) * 0.5,
      Math.sin(sun),
      Math.sin(sun * 0.7) * 0.25,
    ).normalize();

    domeMat.uniforms.uTop.value.lerp(new THREE.Color(current.palette.skyZenith), 0.15);
    domeMat.uniforms.uHorizon.value.lerp(new THREE.Color(current.palette.sky), 0.15);
    const bottom = new THREE.Color(current.palette.sky).lerp(
      new THREE.Color('#130f26'),
      night * 0.55,
    );
    domeMat.uniforms.uBottom.value.copy(bottom);
    domeMat.uniforms.uSunColor.value.set(current.palette.sun);
    domeMat.uniforms.uSunDir.value.copy(sunDir);
    domeMat.uniforms.uSunIntensity.value = 0.3 + dayFactor * 1.5;
    domeMat.uniforms.uStars.value = Math.max(0, night - 0.15);

    if (sunRef.current) {
      sunRef.current.position.copy(sunDir).multiplyScalar(115);
      const mat = sunRef.current.material as THREE.MeshBasicMaterial;
      mat.color.set(current.palette.sun);
      mat.opacity = Math.max(0, Math.min(1, dayFactor * 1.2));
    }
    if (starRef.current) {
      starRef.current.visible = night > 0.18;
    }
  });

  return (
    <group>
      <mesh material={domeMat}>
        <sphereGeometry args={[120, 48, 32]} />
      </mesh>
      <mesh ref={sunRef} material={sunMat}>
        <sphereGeometry args={[4.5, 24, 18]} />
      </mesh>
      <points ref={starRef} geometry={starGeo}>
        <pointsMaterial color="#ffffff" size={0.5} sizeAttenuation={false} transparent opacity={0.85} />
      </points>
    </group>
  );
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}