import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface EraCrossfadeProps {
  /**
   * Morph progress 0..1. The outgoing layer fades out at `1 - progress`
   * while the incoming layer fades in at `progress`.
   */
  progress: number;
  /**
   * Outgoing era content. Omit when idle so only the incoming era renders.
   */
  from?: ReactNode;
  /** Incoming era content (always rendered). */
  to: ReactNode;
}

/** Original material flags captured on first fade, restored afterwards. */
interface OriginalMaterialState {
  transparent: boolean;
  depthWrite: boolean;
}

const originalMaterialState = new WeakMap<THREE.Material, OriginalMaterialState>();
const originalCastShadow = new WeakMap<THREE.Object3D, boolean>();

/**
 * Apply an opacity to every material under a group, toggling transparency and
 * depth writes so the two crossfaded layers can see through each other
 * without z-fighting artifacts. Shadows are disabled for transparent layers
 * (three's shadow pass ignores alpha, so an invisible era would otherwise cast
 * ghost shadows). Material programs are recompiled only when a flag actually
 * changes; original flags are restored once the layer returns to full opacity.
 */
function applyLayerOpacity(root: THREE.Object3D | null, opacity: number): void {
  if (!root) return;
  const transparent = opacity < 0.999;

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    if (transparent) {
      if (!originalCastShadow.has(mesh)) {
        originalCastShadow.set(mesh, mesh.castShadow);
      }
      mesh.castShadow = false;
    } else {
      const prevShadow = originalCastShadow.get(mesh);
      if (prevShadow !== undefined) {
        mesh.castShadow = prevShadow;
        originalCastShadow.delete(mesh);
      }
    }

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      material.opacity = opacity;

      if (transparent) {
        if (!originalMaterialState.has(material)) {
          originalMaterialState.set(material, {
            transparent: material.transparent,
            depthWrite: material.depthWrite,
          });
        }
        const wasTransparent = material.transparent;
        material.transparent = true;
        material.depthWrite = false;
        if (!wasTransparent) material.needsUpdate = true;
      } else {
        const prev = originalMaterialState.get(material);
        if (prev) {
          const changed =
            material.transparent !== prev.transparent || material.depthWrite !== prev.depthWrite;
          material.transparent = prev.transparent;
          material.depthWrite = prev.depthWrite;
          originalMaterialState.delete(material);
          if (changed) material.needsUpdate = true;
        }
      }
    }
  });
}

/**
 * Crossfades two eras of a scene layer: the outgoing era dissolves out while
 * the incoming era emerges, driven by a 0..1 progress value. When idle
 * (`from` omitted) only the incoming era renders at full opacity.
 */
export function EraCrossfade({ progress, from, to }: EraCrossfadeProps) {
  const fromRef = useRef<THREE.Group>(null);
  const toRef = useRef<THREE.Group>(null);
  const progressRef = useRef(progress);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useFrame(() => {
    const p = progressRef.current;
    applyLayerOpacity(fromRef.current, 1 - p);
    applyLayerOpacity(toRef.current, p);
  });

  return (
    <group>
      {from != null && <group ref={fromRef}>{from}</group>}
      <group ref={toRef}>{to}</group>
    </group>
  );
}
