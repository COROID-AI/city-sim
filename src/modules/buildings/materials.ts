import * as THREE from 'three';
import type { EraBuildingConfig } from './eraConfig';

/**
 * The set of PBR materials shared across every building of a single era.
 *
 * These are created once (per era) in the Buildings component and passed
 * down to each Building, so all facades share the same material instances —
 * this keeps draw-call / shader overhead low across the whole block.
 */
export interface EraMaterials {
  /** Primary facade (brick / concrete / steel / cladding). */
  wall: THREE.MeshStandardMaterial;
  /** Secondary accent (cladding bands, storefront sign, parapet). */
  accent: THREE.MeshStandardMaterial;
  /** Trim / cornice / quoins. */
  trim: THREE.MeshStandardMaterial;
  /** Window glass (emissive-tinted per era for lit / smart glazing). */
  glass: THREE.MeshStandardMaterial;
  /** Window frame / mullion / fire-escape metal. */
  frame: THREE.MeshStandardMaterial;
  /** Roof. */
  roof: THREE.MeshStandardMaterial;
  /** Greenery / foliage (2025). */
  green: THREE.MeshStandardMaterial;
  /** LED media facade (2025). */
  led: THREE.MeshStandardMaterial;
}

/** Build the shared era material set from the era config. */
export function createEraMaterials(config: EraBuildingConfig): EraMaterials {
  const m = config.materials;
  return {
    wall: new THREE.MeshStandardMaterial({
      color: m.wall,
      metalness: m.metalness,
      roughness: m.roughness,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: m.accent,
      metalness: m.metalness,
      roughness: m.roughness,
    }),
    trim: new THREE.MeshStandardMaterial({
      color: m.trim,
      metalness: 0.1,
      roughness: 0.6,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: m.glass,
      metalness: m.glassMetalness,
      roughness: m.glassRoughness,
      emissive: m.glassEmissive,
      emissiveIntensity: m.glassEmissiveIntensity,
    }),
    frame: new THREE.MeshStandardMaterial({
      color: m.frame,
      metalness: 0.4,
      roughness: 0.5,
    }),
    roof: new THREE.MeshStandardMaterial({
      color: m.roof,
      metalness: 0.1,
      roughness: 0.9,
    }),
    green: new THREE.MeshStandardMaterial({
      color: m.green,
      metalness: 0,
      roughness: 0.85,
    }),
    led: new THREE.MeshStandardMaterial({
      color: m.led,
      emissive: m.led,
      emissiveIntensity: 2.2,
    }),
  };
}
