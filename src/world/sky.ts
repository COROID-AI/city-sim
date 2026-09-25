/**
 * Sky, atmosphere and aerial detail.
 *
 * A gradient sky dome (era-tinted, lerped during transitions), a sun/moon disc,
 * drifting cloud billboards, star field and city glow for the neon eras, a
 * horizon haze band, circling birds and a banner-towing biplane whose banner
 * copy changes with the era.
 *
 * `applyPalette` lets the transition controller re-tint the dome continuously,
 * so the sky morphs smoothly instead of popping when the era layer swaps.
 */

import * as THREE from 'three';
import { RNG } from '../core/rng';
import type { SkyPalette } from '../config/types';
import type { WorldKit } from './textures';

const DOME_RADIUS = 620;

const DOME_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vWorld = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOME_FRAGMENT = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uBottom;
  uniform vec3 uHorizon;
  uniform float uClarity;
  varying vec3 vWorld;

  void main() {
    vec3 dir = normalize(vWorld);
    float h = clamp(dir.y, -0.2, 1.0);
    vec3 color = mix(uBottom, uTop, smoothstep(-0.02, 0.62 - uClarity * 0.18, h));
    // Horizon glow band, tighter under a clear sky.
    float band = pow(1.0 - clamp(abs(h) * (1.4 + uClarity), 0.0, 1.0), 5.0);
    color = mix(color, uHorizon, band * 0.7);
    gl_FragColor = vec4(color, 1.0);
  }
`;

export interface SkyBuild {
  group: THREE.Group;
  dome: THREE.Mesh;
  sun: THREE.Mesh;
  clouds: THREE.Object3D[];
  stars: THREE.Points | null;
  birds: THREE.Object3D[];
  banner: THREE.Object3D | null;
  haze: THREE.Mesh;
  applyPalette(palette: SkyPalette): void;
}

export function createSky(kit: WorldKit): SkyBuild {
  const { era } = kit;
  const group = new THREE.Group();
  group.name = 'sky';
  const rng = new RNG(`sky:${era.year}`);

  const uniforms = {
    uTop: { value: new THREE.Color(era.palette.skyTop) },
    uBottom: { value: new THREE.Color(era.palette.skyBottom) },
    uHorizon: { value: new THREE.Color(era.palette.horizon) },
    uClarity: { value: era.palette.clarity },
  };

  const domeGeometry = new THREE.SphereGeometry(DOME_RADIUS, 32, 20);
  const domeMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: DOME_VERTEX,
    fragmentShader: DOME_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(domeGeometry, domeMaterial);
  dome.name = 'sky-dome';
  dome.frustumCulled = false;
  group.add(dome);

  // Sun / moon disc.
  const sunDirection = new THREE.Vector3(...era.palette.sunPosition).normalize();
  const sunMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(era.palette.sun), fog: false, transparent: true, opacity: 0.95 });
  const sun = new THREE.Mesh(new THREE.CircleGeometry(16, 24), sunMaterial);
  sun.position.copy(sunDirection).multiplyScalar(DOME_RADIUS * 0.62);
  sun.lookAt(0, sun.position.y, 0);
  sun.frustumCulled = false;
  group.add(sun);

  // Horizon haze band.
  const hazeMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(era.palette.horizon),
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  const haze = new THREE.Mesh(new THREE.CylinderGeometry(DOME_RADIUS * 0.95, DOME_RADIUS * 0.95, 90, 32, 1, true), hazeMaterial);
  haze.position.y = 24;
  haze.frustumCulled = false;
  group.add(haze);

  // Drifting cloud billboards.
  const cloudMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(era.palette.clarity > 0.7 ? '#ffffff' : '#d8d2c4'),
    transparent: true,
    opacity: era.palette.clarity > 0.7 ? 0.5 : 0.72,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
  });
  const clouds: THREE.Object3D[] = [];
  const cloudCount = era.year <= 1965 ? 9 : 12;
  for (let i = 0; i < cloudCount; i += 1) {
    const puff = new THREE.Group();
    for (let lobe = 0; lobe < 3; lobe += 1) {
      const plate = new THREE.Mesh(new THREE.CircleGeometry(rng.range(16, 34), 12), cloudMaterial);
      plate.position.set(rng.range(-24, 24), rng.range(-4, 6), lobe * 0.5);
      puff.add(plate);
    }
    puff.position.set(rng.range(-420, 420), rng.range(120, 260), rng.range(-420, 420));
    puff.rotation.y = rng.range(0, Math.PI * 2);
    puff.userData.drift = rng.range(0.6, 2.4);
    clouds.push(puff);
    group.add(puff);
  }

  // Stars + city glow for the electric eras.
  let stars: THREE.Points | null = null;
  if (era.year >= 1985) {
    const count = era.year >= 2005 ? 420 : 180;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const theta = rng.range(0, Math.PI * 2);
      const phi = rng.range(0.06, Math.PI / 2 - 0.12);
      const radius = DOME_RADIUS * 0.94;
      positions[i * 3] = Math.cos(phi) * Math.cos(theta) * radius;
      positions[i * 3 + 1] = Math.sin(phi) * radius;
      positions[i * 3 + 2] = Math.cos(phi) * Math.sin(theta) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starMaterial = new THREE.PointsMaterial({
      color: new THREE.Color(era.year >= 2005 ? '#dfeaff' : '#ffd9a8'),
      size: 3.2,
      sizeAttenuation: false,
      transparent: true,
      opacity: era.year >= 2005 ? 0.85 : 0.55,
      depthWrite: false,
      fog: false,
    });
    stars = new THREE.Points(geometry, starMaterial);
    stars.frustumCulled = false;
    group.add(stars);
  }

  // Circling birds.
  const birds: THREE.Object3D[] = [];
  const birdMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(era.year <= 1945 ? '#3a3630' : '#2f3338'), side: THREE.DoubleSide, fog: true });
  for (let i = 0; i < era.birds; i += 1) {
    const bird = new THREE.Group();
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), birdMaterial);
    wing.name = 'wing';
    bird.add(wing);
    bird.userData.orbit = rng.range(60, 130);
    bird.userData.speed = rng.range(0.16, 0.3) * (rng.chance(0.5) ? 1 : -1);
    bird.userData.phase = rng.range(0, Math.PI * 2);
    bird.userData.height = rng.range(38, 74);
    birds.push(bird);
    group.add(bird);
  }

  // Banner plane with era-specific copy.
  let banner: THREE.Object3D | null = null;
  {
    const plane = new THREE.Group();
    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 7), kit.library.flat('#c9c4b8', { roughness: 0.5 }));
    const wing = new THREE.Mesh(new THREE.BoxGeometry(12, 0.16, 1.8), kit.library.flat('#d9d4c8', { roughness: 0.6 }));
    wing.position.y = 0.7;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(4, 0.14, 1), kit.library.flat('#d9d4c8', { roughness: 0.6 }));
    tail.position.set(0, 0.6, -3.4);
    const bannerCloth = new THREE.Mesh(
      new THREE.PlaneGeometry(26, 3.4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(era.advertisements[0]?.colors[1] ?? '#e8dcc2'), side: THREE.DoubleSide, fog: true }),
    );
    bannerCloth.name = 'banner-cloth';
    bannerCloth.position.set(0, -1.6, -20);
    plane.add(fuselage, wing, tail, bannerCloth);
    plane.userData.copy = era.bannerText;
    plane.userData.radius = 210;
    plane.userData.height = 96;
    plane.userData.speed = 0.055;
    plane.position.set(-210, 96, 0);
    banner = plane;
    group.add(plane);
  }

  const applyPalette = (palette: SkyPalette): void => {
    uniforms.uTop.value.set(palette.skyTop);
    uniforms.uBottom.value.set(palette.skyBottom);
    uniforms.uHorizon.value.set(palette.horizon);
    uniforms.uClarity.value = palette.clarity;
    sunMaterial.color.set(palette.sun);
    hazeMaterial.color.set(palette.horizon);
  };

  group.userData.applyPalette = applyPalette;
  group.userData.birds = birds;
  group.userData.clouds = clouds;
  group.userData.banner = banner;

  return { group, dome, sun, clouds, stars, birds, banner, haze, applyPalette };
}
