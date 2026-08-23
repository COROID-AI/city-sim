/**
 * Placeholder era — registered for all five years so the slider → registry →
 * scene swap works end-to-end before real era content lands.
 *
 * Clearly labeled "UNDER CONSTRUCTION" in the HUD and as an in-scene floating
 * sign so it can never be mistaken for real content.
 */
import * as THREE from '../../public/js/three/build/three.module.js';

const YEARS = [1945, 1965, 1985, 2005, 2025];

export function createPlaceholderEra(year) {
  return {
    id: `placeholder-${year}`,
    label: String(year),
    year,
    hudText: 'UNDER CONSTRUCTION',
    assets: [],
    build(ctx) {
      const group = new THREE.Group();
      group.name = `placeholder-era:${year}`;

      const anchor = ctx.shellMeta?.labelPosition?.() ?? new THREE.Vector3(0, 1.8, 4.0);
      const sign = makeBillboard(`Cafe ${year} · UNDER CONSTRUCTION`);
      sign.position.copy(anchor);
      group.add(sign);

      // A faint "real era coming here" placeholder cube so the swap is visible
      // from any camera angle.
      const cubeMat = new THREE.MeshStandardMaterial({
        color: 0x44586b,
        roughness: 0.7,
        metalness: 0.1,
        transparent: true,
        opacity: 0.35,
        emissive: 0x223344,
        emissiveIntensity: 0.15,
        wireframe: true,
      });
      const cube = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), cubeMat);
      cube.position.set(0, 1.5, 3.6);
      group.add(cube);

      return group;
    },
    enter() {},
    exit() {},
  };
}

function makeBillboard(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx2d = canvas.getContext('2d');

  ctx2d.fillStyle = 'rgba(18, 28, 38, 0.92)';
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  ctx2d.strokeStyle = 'rgba(240, 196, 90, 0.9)';
  ctx2d.lineWidth = 10;
  ctx2d.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

  ctx2d.fillStyle = '#f7f2e6';
  ctx2d.font = 'bold 104px sans-serif';
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  ctx2d.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 56);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;

  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
    })
  );
  sprite.scale.set(4.2, 1.05, 1);
  return sprite;
}

export function registerAllPlaceholderEras() {
  return YEARS.map(createPlaceholderEra);
}