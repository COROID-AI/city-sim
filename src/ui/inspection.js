import * as THREE from '../../public/js/three/lib/three.module.js';
import { findInspectableForHit } from './metadata.js';

/** Install raycast hover/click inspection on the renderer canvas. */
export function createInspection(ctx, opts) {
  const { scene, camera, renderer } = ctx;
  const canvas = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const state = { hovered: null, lifted: [], active: false };

  function activeGroup() {
    const era = opts.getActiveEra();
    return era ? scene.getObjectByName(`era-group:${era.id}`) : null;
  }

  function objectsFor(entry) {
    const root = activeGroup();
    const wanted = String(entry?.object || '').toLowerCase();
    const found = new Set();
    if (!root || !wanted) return [];
    root.traverse((object) => {
      if (!object.name || !String(object.name).toLowerCase().includes(wanted)) return;
      if (object.isMesh) found.add(object);
      else object.traverse((child) => { if (child.isMesh) found.add(child); });
    });
    return [...found];
  }

  function highlight(mesh) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const original of materials) {
      if (!original?.clone) continue;
      const lifted = original.clone();
      if (lifted.emissive?.isColor) {
        lifted.emissive = new THREE.Color(0xffffff);
        lifted.emissiveIntensity = Math.max(Number(lifted.emissiveIntensity) || 0, 0.45);
      } else if (lifted.color?.isColor) {
        lifted.color = lifted.color.clone().lerp(new THREE.Color(0xffffff), 0.2);
      }
      state.lifted.push({ mesh, original });
      mesh.material = materials.length > 1 ? materials.map((_, i) => i === state.lifted.length - 1 ? lifted : materials[i]) : lifted;
    }
    const base = mesh.userData.inspectionScale || mesh.scale.clone();
    mesh.userData.inspectionScale = base;
    mesh.scale.copy(base).multiplyScalar(1.025);
  }

  function clear() {
    for (const item of state.lifted) item.mesh.material = item.original;
    if (state.hovered?.object?.userData.inspectionScale) {
      state.hovered.object.scale.copy(state.hovered.object.userData.inspectionScale);
      delete state.hovered.object.userData.inspectionScale;
    }
    state.lifted = [];
    state.hovered = null;
    canvas.style.cursor = 'default';
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const root = activeGroup();
    if (!root) return null;
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(root, true).find((item) => findInspectableForHit(opts.getActiveEra(), item.object));
    if (!hit) return null;
    return { hit, entry: findInspectableForHit(opts.getActiveEra(), hit.object) };
  }

  function onMove(event) {
    if (state.active || opts.isTransitioning()) { clear(); return; }
    const result = pick(event);
    if (!result) { if (state.hovered) { clear(); opts.onHover?.(null); } return; }
    if (state.hovered?.entry === result.entry) return;
    clear();
    const objects = objectsFor(result.entry);
    objects.forEach(highlight);
    state.hovered = { entry: result.entry, object: objects[0] || result.hit.object };
    canvas.style.cursor = 'pointer';
    opts.onHover?.({ entry: result.entry });
  }

  let down = null;
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', (event) => { down = { x: event.clientX, y: event.clientY }; });
  canvas.addEventListener('pointerup', (event) => {
    if (opts.isTransitioning() || !down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) { down = null; return; }
    if (state.hovered && !state.active) {
      state.active = true;
      opts.onInspect?.({ name: state.hovered.entry.name, story: state.hovered.entry.story, era: opts.getActiveEra() });
    }
    down = null;
  });

  return { clear, reset() { state.active = false; clear(); }, get isOpen() { return state.active; } };
}