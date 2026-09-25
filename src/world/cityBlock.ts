/**
 * Era layer assembly.
 *
 * Builds one complete, self-contained city block for a single year and returns
 * it as an {@link EraLayer}: category groups (roads, buildings, vehicles,
 * storefronts, advertisements, pedestrians, props, sky) that the transition
 * controller can swap independently, plus the counts and period-element tags the
 * tests assert on, plus the per-frame simulation hook.
 *
 * All five layers are built at boot so an era change never has to generate
 * geometry mid-transition - it only has to reveal it.
 */

import * as THREE from 'three';
import {
  CATEGORY_ORDER,
  YEARS,
  type AdSpec,
  type EraCounts,
  type EraDefinition,
  type EraLayer,
  type SceneCategories,
  type Year,
} from '../config/types';
import { ERAS } from '../config/eras';
import { eraSeed } from '../core/rng';
import {
  AmbienceAnimator,
  bannerPlane,
  birdFlock,
  flutterCloth,
  neonFlicker,
  scrollTickers,
  steamPuffs,
  trafficLightAnimator,
} from '../sim/animation';
import { CrowdSim, createSidewalkGraph, sampleRoute, type CrowdMember } from '../sim/crowds';
import { TrafficSim, createLaneGraph } from '../sim/traffic';
import { createBuildings } from './buildings';
import { createPedestrians, type PedestrianAnchor } from './pedestrians';
import { createProps } from './props';
import { createRoads } from './roads';
import { buildSignContent, createAdBoard, createStorefront } from './signage';
import { createSky } from './sky';
import { createTextureFactory, createWorldKit, disposeWorldKit, type TextureFactory, type WorldKit } from './textures';
import { createVehicles } from './vehicles';

export interface CityBlockOptions {
  /** Override the deterministic seed (the determinism test builds twice). */
  seed?: number | string;
  /** Inject a texture factory (headless runs pass one that cannot draw). */
  textures?: TextureFactory;
  /** Pedestrians per layer. */
  pedestrianCount?: number;
}

const DEFAULT_PEDESTRIANS = 48;

/** Period-specific element tags derived from an era definition. */
export function eraPeriodElements(era: EraDefinition): string[] {
  const elements = new Set<string>();

  for (const vehicle of era.vehicles) elements.add(vehicle.kind);
  if (era.props.tramRails) elements.add('tram-rails');
  if (era.props.bikeLane) elements.add('bike-lane');
  if (era.props.telephonePoles) elements.add('telephone-poles');
  if (era.props.busStopShelter) elements.add('bus-stop-shelter');
  if (era.props.newsstands) elements.add('newsstands');
  if (era.props.newspaperBoxes) elements.add('newspaper-boxes');

  const architecture = era.architecture;
  if (architecture.waterTowers) elements.add('water-towers');
  if (architecture.fireEscapes) elements.add('fire-escapes');
  if (architecture.satelliteDishes) elements.add('satellite-dishes');
  if (architecture.roofBillboards) elements.add('roof-billboards');
  if (architecture.setbacks) elements.add('setback-massing');
  if (architecture.windowStyle === 'curtain-wall') elements.add('curtain-wall-glass');
  if (architecture.windowStyle === 'ribbon') elements.add('ribbon-windows');

  elements.add(`${era.props.lampStyle}-lamps`);

  const formats = new Set(era.advertisements.map((ad) => ad.format));
  for (const storefront of era.storefronts) formats.add(storefront.signFormat);
  if (formats.has('painted')) elements.add('painted-ads');
  if (formats.has('poster')) elements.add('posters');
  if (formats.has('neon')) elements.add('neon-signs');
  if (formats.has('billboard')) elements.add('billboards');
  if (formats.has('ticker')) elements.add('led-tickers');
  if (formats.has('led')) {
    elements.add('digital-billboard');
    elements.add('led-facades');
  }
  if (formats.has('media-facade')) elements.add('led-media-facade');

  const diner = era.storefronts.find((storefront) => storefront.category === 'diner');
  if (diner && diner.signFormat === 'neon') elements.add('neon-diner-signs');

  if (era.year >= 2025) elements.add('roof-gardens');
  if (era.outfits.some((outfit) => outfit.accessory === 'phone')) elements.add('handheld-phones');
  if (era.outfits.some((outfit) => outfit.accessory === 'fedora' || outfit.accessory === 'pillbox-hat')) {
    elements.add('hatted-crowd');
  }

  return Array.from(elements);
}

/** Rotation so the group's local +Z points away from the block centre. */
function facingRotation(facing: 'x' | 'z', facingSign: 1 | -1): number {
  if (facing === 'x') return (facingSign * Math.PI) / 2;
  return facingSign > 0 ? 0 : Math.PI;
}

function collectEmissives(root: THREE.Object3D, limit = 220): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (found.length >= limit) return;
    const mesh = object as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
    const material = mesh.material as THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
    const list = Array.isArray(material) ? material : [material];
    for (const entry of list) {
      if (entry && 'emissive' in entry && entry.emissive && entry.emissiveIntensity > 0.9) {
        found.push(mesh);
        break;
      }
    }
  });
  return found;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh & { isInstancedMesh?: boolean };
    if ((mesh as unknown as { isMesh?: boolean }).isMesh) {
      mesh.geometry?.dispose?.();
      const material = mesh.material as THREE.Material | THREE.Material[];
      const list = Array.isArray(material) ? material : [material];
      for (const entry of list) entry?.dispose?.();
    }
  });
}

/** Build one complete era layer. */
export function buildEraLayer(era: EraDefinition, options: CityBlockOptions = {}): EraLayer {
  const textures = options.textures ?? createTextureFactory();
  const kit: WorldKit = createWorldKit(era, { seed: options.seed ?? eraSeed(era.year), textures });

  const group = new THREE.Group();
  group.name = `era-${era.year}`;
  const categories = {} as SceneCategories;

  // ---- roads ---------------------------------------------------------------
  const roads = createRoads(kit);
  categories.roads = roads.group;

  // ---- buildings -----------------------------------------------------------
  const buildings = createBuildings(kit);
  categories.buildings = buildings.group;

  // ---- storefronts ---------------------------------------------------------
  const storefrontGroup = new THREE.Group();
  storefrontGroup.name = 'storefronts';
  const frontRow = buildings.records
    .filter((record) => record.slot.ring === 1)
    .sort((a, b) => Math.hypot(a.slot.x, a.slot.z) - Math.hypot(b.slot.x, b.slot.z));
  era.storefronts.forEach((spec, index) => {
    const anchor = frontRow[index % Math.max(1, frontRow.length)] ?? buildings.records[0];
    if (!anchor) return;
    const bay = createStorefront(kit, spec, {
      position: anchor.frontage.clone().setY(0),
      facing: anchor.slot.facing,
      facingSign: anchor.slot.facingSign,
      width: anchor.slot.width - 1,
    });
    bay.userData.focus = {
      kind: 'storefront',
      id: spec.id,
      label: spec.name,
      detail: `${spec.name} (${spec.category}); window reads "${spec.display}".`,
      period: `${era.year} · ${spec.signFormat} signage`,
    };
    storefrontGroup.add(bay);
  });
  categories.storefronts = storefrontGroup;

  // ---- advertisements ------------------------------------------------------
  const adGroup = new THREE.Group();
  adGroup.name = 'advertisements';
  const tallBuildings = buildings.records.slice().sort((a, b) => b.height - a.height);
  const contents = buildSignContent(era).filter((content) => content.source === 'advertisement');
  era.advertisements.forEach((ad: AdSpec, index) => {
    const content = contents[index] ?? contents[0];
    if (!content) return;
    const anchor = tallBuildings[index % Math.max(1, tallBuildings.length)];
    const rotationY = anchor ? facingRotation(anchor.slot.facing, anchor.slot.facingSign) : 0;
    let position: THREE.Vector3;
    let height = content.height;
    let width = content.width;
    if (ad.placement === 'rooftop') {
      height = 3.4;
      width = Math.min(anchor ? anchor.slot.width + 6 : 18, 20);
      position = new THREE.Vector3(
        anchor ? anchor.group.position.x : 0,
        anchor ? anchor.height + 2.6 : 20,
        anchor ? anchor.group.position.z : 0,
      );
    } else if (ad.placement === 'facade') {
      height = Math.min(11, (anchor?.height ?? 30) * 0.45);
      width = 8.5;
      const offset = anchor ? anchor.slot.depth / 2 + 0.6 : 0;
      position = new THREE.Vector3(
        anchor ? anchor.group.position.x + (anchor.slot.facing === 'z' ? 0 : anchor.slot.facingSign * (anchor.slot.width / 2 + 0.6)) : offset,
        anchor ? anchor.height * 0.55 : 12,
        anchor ? anchor.group.position.z + (anchor.slot.facing === 'z' ? anchor.slot.facingSign * offset : 0) : 0,
      );
    } else if (ad.placement === 'storefront') {
      const bay = storefrontGroup.children[index % Math.max(1, storefrontGroup.children.length)] as THREE.Object3D | undefined;
      position = bay ? bay.position.clone().setY(5.4) : new THREE.Vector3(0, 5.4, 0);
      height = 1.5;
      width = 6.5;
    } else {
      const offset = anchor ? anchor.slot.depth / 2 + 0.55 : 0;
      position = new THREE.Vector3(
        anchor ? anchor.group.position.x + (anchor.slot.facing === 'z' ? 0 : anchor.slot.facingSign * (anchor.slot.width / 2 + 0.55)) : 0,
        9.5,
        anchor ? anchor.group.position.z + (anchor.slot.facing === 'z' ? anchor.slot.facingSign * offset : 0) : 0,
      );
      height = Math.min(6, height * 1.6);
      width = Math.min(14, width);
    }
    const board = createAdBoard(kit, content, { position, rotationY, width, height });
    board.userData.focus = {
      kind: 'advertisement',
      id: ad.id,
      label: `${ad.format} advertisement`,
      detail: `"${ad.copy}" - a ${ad.format} panel ${ad.placement === 'rooftop' ? 'hoisted onto the roofline' : 'worked into the street wall'}.`,
      period: `${era.year} · ${ad.format}`,
    };
    adGroup.add(board);
  });
  categories.advertisements = adGroup;

  // ---- vehicles ------------------------------------------------------------
  const lanes = createLaneGraph();
  const vehicles = createVehicles(kit, lanes);
  for (const entry of vehicles.all) {
    entry.group.userData.focus = {
      kind: 'vehicle',
      id: entry.spec.id,
      label: entry.spec.label,
      detail: `${entry.spec.label} - ${entry.moving ? 'rolling through the block' : 'parked at the kerb'}; ${entry.spec.length.toFixed(1)} m long.`,
      period: `${era.year} · ${entry.moving ? 'in service' : 'kerbside'}`,
    };
  }
  categories.vehicles = vehicles.group;

  // ---- pedestrians ---------------------------------------------------------
  const routes = createSidewalkGraph();
  const pedestrianCount = options.pedestrianCount ?? DEFAULT_PEDESTRIANS;
  const anchors: PedestrianAnchor[] = [];
  for (let i = 0; i < pedestrianCount; i += 1) {
    const routeIndex = i % routes.length;
    const route = routes[routeIndex];
    const distance = (i / pedestrianCount) * route.length + kit.rng.range(0, route.length * 0.08);
    const sample = sampleRoute(route, distance);
    anchors.push({ x: sample.x, z: sample.z, facing: sample.heading, routeIndex, distance });
  }
  const pedestrians = createPedestrians(kit, anchors);
  categories.pedestrians = pedestrians.group;

  // ---- props ---------------------------------------------------------------
  const props = createProps(kit);
  for (const record of props.records) {
    record.group.userData.focus = {
      kind: 'prop',
      id: `${record.category}:${record.position.x}:${record.position.z}`,
      label: record.label,
      detail: `${record.label} - street furniture of the ${era.year} block.`,
      period: `${era.year} · ${record.category}`,
    };
  }
  categories.props = props.group;

  // ---- sky -----------------------------------------------------------------
  const sky = createSky(kit);
  categories.sky = sky.group;

  for (const category of CATEGORY_ORDER) {
    const categoryGroup = categories[category];
    if (categoryGroup && categoryGroup.parent !== group) group.add(categoryGroup);
  }

  // ---- simulation ----------------------------------------------------------
  const trafficSim = new TrafficSim(vehicles.traffic);
  const members: CrowdMember[] = pedestrians.rigs.map((entry, index) => ({
    rig: entry.rig,
    outfit: entry.outfit,
    routeIndex: anchors[index]?.routeIndex ?? 0,
    distance: anchors[index]?.distance ?? 0,
    speed: 1.05 * era.crowdPace * kit.rng.range(0.85, 1.15),
    idle: 0,
    paused: false,
  }));
  const crowdSim = new CrowdSim(members, routes, 1);
  const animator = new AmbienceAnimator();

  if (era.year <= 2005 && props.manholes.length > 0) {
    animator.add(
      steamPuffs(categories.props, props.manholes.slice(0, 3), {
        color: era.year <= 1965 ? '#e0d6c2' : '#c8ccd0',
        puffsPerOrigin: era.year <= 1945 ? 6 : 4,
      }),
    );
  }
  animator.add(
    flutterCloth([
      ...props.flags.map((flag, index) => ({ object: flag, axis: 'y' as const, amplitude: 0.22, speed: 2.6, phase: index })),
      ...storefrontGroup.children.flatMap((bay, index) => {
        const awning = bay.getObjectByName('awning');
        return awning ? [{ object: awning, axis: 'z' as const, amplitude: 0.035, speed: 1.6, phase: index * 0.7 }] : [];
      }),
    ]),
  );

  const flickerTargets: { object: THREE.Object3D; material: THREE.MeshStandardMaterial; base: number; phase: number }[] = [];
  const tickerTargets: { rows: THREE.Object3D[]; speed: number }[] = [];
  adGroup.traverse((object) => {
    const rows = object.userData.tickerRows as THREE.Object3D[] | undefined;
    if (rows && rows.length > 0) tickerTargets.push({ rows, speed: 2.4 });
    const mesh = object as THREE.Mesh;
    if ((mesh as unknown as { isMesh?: boolean }).isMesh && !Array.isArray(mesh.material)) {
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (material && 'emissive' in material && material.emissiveIntensity > 0.9) {
        flickerTargets.push({ object: mesh, material, base: material.emissiveIntensity, phase: flickerTargets.length * 0.9 });
      }
    }
  });
  if (flickerTargets.length > 0 && era.year >= 1965) animator.add(neonFlicker(flickerTargets.slice(0, 24)));
  if (tickerTargets.length > 0) animator.add(scrollTickers(tickerTargets));
  animator.add(trafficLightAnimator(props.trafficLights, () => trafficSim.signals));
  animator.add(birdFlock(sky.birds));
  animator.add(bannerPlane(sky.banner));

  const emissives = collectEmissives(group);

  const counts: EraCounts = {
    buildings: buildings.records.length,
    vehicles: vehicles.total,
    movingVehicles: vehicles.moving,
    pedestrians: pedestrians.rigs.length,
    storefronts: storefrontGroup.children.length,
    advertisements: adGroup.children.length,
    propCategories: props.categories.length,
    props: props.records.length,
  };

  const layer: EraLayer = {
    year: era.year,
    definition: era,
    group,
    categories,
    counts,
    emissives,
    periodElements: eraPeriodElements(era),
    ambienceTags: era.audio.ambience.map((entry) => entry.id),
    update(dt: number) {
      trafficSim.update(dt);
      crowdSim.update(dt, trafficSim.signals);
      animator.update(dt);
    },
    dispose() {
      disposeTree(group);
      disposeWorldKit(kit);
    },
  };

  group.userData.layer = layer;
  group.userData.traffic = trafficSim;
  group.userData.trafficVehicles = vehicles.all;
  group.userData.crowd = crowdSim;
  group.userData.ambience = animator;

  return layer;
}

/** Build all five era layers (sequentially; the caller reports progress). */
export function buildAllEraLayers(
  options: CityBlockOptions & { onProgress?: (ratio: number, year: Year) => void } = {},
): Map<Year, EraLayer> {
  const layers = new Map<Year, EraLayer>();
  YEARS.forEach((year, index) => {
    layers.set(year, buildEraLayer(ERAS[year], options));
    options.onProgress?.((index + 1) / YEARS.length, year);
  });
  return layers;
}

/** Deep-ish structural signature used to prove seeded generation is stable. */
export function layerSignature(layer: EraLayer): string {
  const parts: string[] = [String(layer.year), String(layer.counts.buildings), String(layer.counts.vehicles)];
  let meshes = 0;
  let checksum = 0;
  layer.group.traverse((object) => {
    if ((object as unknown as { isMesh?: boolean }).isMesh) meshes += 1;
    checksum += object.position.x * 3.1 + object.position.y * 1.7 + object.position.z * 0.9;
  });
  parts.push(String(meshes), checksum.toFixed(3));
  return parts.join('|');
}
