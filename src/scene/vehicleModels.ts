import * as THREE from "three";

import type { EraConfig, VehicleShare } from "../era/eraTypes";

/** Vehicle silhouettes added by the procedural era modeler. */
export type VehicleModelStyle =
  | "stock"
  | "tailfin-sedan"
  | "boxy-sedan"
  | "hybrid-sedan"
  | "autonomous-pod";

export interface VehicleModelOptions {
  readonly style?: VehicleModelStyle;
  readonly plateNumber?: number;
  readonly nightMood?: number;
}

export interface VehicleModel {
  readonly group: THREE.Group;
  /** All owned materials and textures are released with this method. */
  dispose(): void;
  setNightMood(mood: number): void;
}

const clamp01 = (value: number): number => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;

/**
 * Generates a detailed, renderer-ready vehicle from era data. Forward is +Z;
 * the caller places and rotates the returned group along its lane.
 */
export function createVehicleModel(
  era: EraConfig,
  share: VehicleShare,
  options: VehicleModelOptions = {},
): VehicleModel {
  const group = new THREE.Group();
  const { style = "stock", plateNumber = 1 } = options;
  const kind = style === "autonomous-pod" ? "autonomous-pod" : share.kind;
  group.name = `${era.id}-${kind}-${plateNumber}`;
  group.userData.era = era.id;
  group.userData.vehicleClass = kind;
  group.userData.modelStyle = style;
  group.userData.engineSound = share.engineSound;

  const ownedMaterials = new Set<THREE.Material>();
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const ownedTextures = new Set<THREE.Texture>();
  const addBox = (
    name: string,
    size: readonly [number, number, number],
    position: readonly [number, number, number],
    material: THREE.Material,
    target = group,
  ): THREE.Mesh => {
    const geometry = new THREE.BoxGeometry(...size);
    ownedGeometries.add(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    target.add(mesh);
    return mesh;
  };
  const material = (parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial => {
    const result = new THREE.MeshStandardMaterial(parameters);
    ownedMaterials.add(result);
    return result;
  };

  const paintMap = makePaintTexture(share.bodyColor, era.id, style);
  const plateMap = makePlateTexture(era.year, plateNumber);
  if (paintMap) ownedTextures.add(paintMap);
  if (plateMap) ownedTextures.add(plateMap);

  const bodyMat = material({
    color: 0xffffff,
    map: paintMap,
    metalness: era.vehicles.chromeLevel * 0.26,
    roughness: style === "autonomous-pod" ? 0.22 : 0.48,
  });
  const roofMat = material({ color: share.roofColor, metalness: 0.16, roughness: 0.42 });
  const glassMat = material({ color: 0x8ec9dd, metalness: 0.18, roughness: 0.14, transparent: true, opacity: 0.72 });
  const chromeMat = material({ color: 0xd4d5cf, metalness: 0.92, roughness: 0.19 });
  const rubberMat = material({ color: 0x191b1c, roughness: 0.9 });
  const hubMat = material({ color: era.vehicles.wheels === "whitewall-steel" ? 0xe6dec7 : 0xb6bdc1, metalness: 0.8, roughness: 0.3 });
  const plateMat = material({ color: 0xffffff, map: plateMap, roughness: 0.7 });
  const headMat = material({ color: 0xfff2c4, emissive: 0xffdfa0, emissiveIntensity: 0, roughness: 0.15 });
  const tailMat = material({ color: 0x8d1715, emissive: 0xf21f12, emissiveIntensity: 0.35, roughness: 0.2 });

  const length = share.length;
  const width = share.width;
  const height = share.height;
  const chassisY = Math.max(0.38, height * 0.28);
  const bodyLength = kind === "truck" ? length * 0.52 : kind === "streetcar" || kind === "bus" ? length * 0.9 : length * 0.72;
  const bodyZ = kind === "truck" ? -length * 0.18 : 0;
  addBox("painted-body", [width, Math.max(0.55, height * 0.42), bodyLength], [0, chassisY, bodyZ], bodyMat);

  const isCommercial = kind === "truck" || kind === "bus" || kind === "streetcar" || kind === "van"
    || kind === "delivery-van";
  const cabinHeight = isCommercial ? height * 0.52 : height * 0.42;
  const cabinLength = isCommercial ? length * 0.58 : length * 0.4;
  const cabinZ = isCommercial ? length * 0.02 : -length * 0.05;
  const cabin = addBox("glazed-cabin", [width * 0.83, cabinHeight, cabinLength], [0, chassisY + height * 0.39, cabinZ], glassMat);
  cabin.material = glassMat;
  addBox("painted-roof", [width * 0.81, Math.max(0.12, height * 0.1), cabinLength * 0.88],
    [0, chassisY + height * 0.39 + cabinHeight * 0.5, cabinZ], roofMat);

  if (style === "tailfin-sedan") {
    for (const side of [-1, 1]) {
      const fin = addBox("tail-fin", [0.1, height * 0.48, length * 0.16],
        [side * width * 0.39, chassisY + height * 0.29, -length * 0.43], bodyMat);
      fin.rotation.x = -0.17;
    }
    addBox("chrome-grille", [width * 0.7, 0.12, 0.08], [0, chassisY, length * 0.37], chromeMat);
  }
  if (style === "boxy-sedan") {
    addBox("squared-hood", [width * 0.91, height * 0.16, length * 0.3], [0, chassisY + height * 0.22, length * 0.31], bodyMat);
    addBox("rear-deck", [width * 0.87, height * 0.14, length * 0.19], [0, chassisY + height * 0.23, -length * 0.35], roofMat);
  }
  if (style === "hybrid-sedan") {
    addBox("hybrid-roof-panel", [width * 0.42, 0.035, cabinLength * 0.55],
      [0, chassisY + height * 0.39 + cabinHeight * 0.5 + height * 0.052, cabinZ], chromeMat);
  }
  if (style === "autonomous-pod") {
    const sensor = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.12, 12), chromeMat);
    ownedGeometries.add(sensor.geometry);
    sensor.name = "lidar-sensor";
    sensor.position.set(0, height * 0.91, -length * 0.05);
    group.add(sensor);
    addBox("pod-undertray", [width * 0.66, 0.13, length * 0.58], [0, 0.2, 0], chromeMat);
  }

  // Bumpers and chrome belt-line make the trim legible at block scale.
  const trimY = chassisY + height * 0.18;
  addBox("front-chrome-bumper", [width * 0.92, 0.1, 0.12], [0, trimY, length * 0.49], chromeMat);
  addBox("rear-chrome-bumper", [width * 0.92, 0.1, 0.12], [0, trimY, -length * 0.49], chromeMat);
  for (const side of [-1, 1]) {
    addBox("chrome-belt-trim", [0.035, 0.055, bodyLength * 0.78], [side * width * 0.505, chassisY + height * 0.34, bodyZ], chromeMat);
  }

  const wheelZ = Math.min(length * 0.38, bodyLength * 0.4);
  const wheelY = Math.max(0.28, chassisY - height * 0.17);
  const wheelRadius = Math.min(0.42, height * 0.24);
  for (const xSide of [-1, 1]) {
    for (const zSide of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.2, 16), rubberMat);
      ownedGeometries.add(wheel.geometry);
      wheel.name = "rubber-wheel";
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(xSide * (width * 0.48), wheelY, zSide * wheelZ);
      wheel.castShadow = true;
      group.add(wheel);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(wheelRadius * 0.43, wheelRadius * 0.43, 0.22, 12), hubMat);
      ownedGeometries.add(hub.geometry);
      hub.name = "wheel-hub";
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      hub.position.x += xSide * 0.025;
      group.add(hub);
    }
  }

  const lampY = chassisY + height * 0.13;
  for (const xSide of [-1, 1]) {
    addBox("emissive-headlight", [0.28, 0.16, 0.09], [xSide * width * 0.34, lampY, length * 0.5], headMat);
    addBox("emissive-taillight", [0.25, 0.2, 0.08], [xSide * width * 0.34, lampY, -length * 0.5], tailMat);
  }
  if (era.vehicles.chromeLevel > 0.35) {
    addBox("front-license-plate", [width * 0.34, 0.16, 0.025], [0, chassisY * 0.72, length * 0.505], plateMat);
  }
  addBox("rear-license-plate", [width * 0.34, 0.16, 0.025], [0, chassisY * 0.72, -length * 0.505], plateMat);

  const headlightLights: THREE.PointLight[] = [];
  for (const xSide of [-1, 1]) {
    const light = new THREE.PointLight(0xffe7b3, 0, Math.max(3, length * 0.8), 2);
    light.name = "headlight-beam";
    light.position.set(xSide * width * 0.31, lampY, length * 0.52);
    group.add(light);
    headlightLights.push(light);
  }

  const setNightMood = (mood: number): void => {
    const value = clamp01(mood);
    headMat.emissiveIntensity = value * 2.4;
    tailMat.emissiveIntensity = 0.35 + value * 1.4;
    for (const light of headlightLights) light.intensity = value * 1.7;
    group.userData.nightMood = value;
  };
  setNightMood(options.nightMood ?? 0);

  return {
    group,
    setNightMood,
    dispose() {
      for (const geometry of ownedGeometries) geometry.dispose();
      for (const material of ownedMaterials) material.dispose();
      for (const texture of ownedTextures) texture.dispose();
      group.clear();
    },
  };
}

function makePaintTexture(color: number, era: string, style: VehicleModelStyle): THREE.Texture | null {
  const canvas = makeCanvas(128, 64);
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return null;
  context.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  context.fillRect(0, 0, 128, 64);
  const accent = era === "1985" ? "#37d5da" : era === "2025" ? "#ddfff1" : "#e2d6b7";
  if (style === "tailfin-sedan" || style === "boxy-sedan") {
    context.fillStyle = accent;
    context.fillRect(0, 46, 128, 3);
  }
  if (style === "autonomous-pod") {
    context.fillStyle = "rgba(255,255,255,.55)";
    context.fillRect(12, 6, 104, 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makePlateTexture(year: number, number: number): THREE.Texture | null {
  const canvas = makeCanvas(128, 40);
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return null;
  context.fillStyle = year < 1960 ? "#e8e2c9" : "#f4f1df";
  context.fillRect(0, 0, 128, 40);
  context.strokeStyle = "#30383a";
  context.lineWidth = 3;
  context.strokeRect(2, 2, 124, 36);
  context.fillStyle = "#172126";
  context.font = "bold 20px monospace";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(`${String(year).slice(-2)} CC ${String(number).padStart(3, "0")}`, 64, 21);
  return new THREE.CanvasTexture(canvas);
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === "undefined" || typeof CanvasRenderingContext2D === "undefined") return null;
  if (typeof window !== "undefined" && /jsdom/i.test(window.navigator.userAgent)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
