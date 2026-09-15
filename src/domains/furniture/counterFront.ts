/**
 * Counter frontage — the era's dress for the service counter the environment
 * shell raises.
 *
 * The environment owns the counter's volume and worksurface; this module owns
 * everything the customer sees: the panelled or slatted front, its stiles, the
 * plinth and kick recess, the top capping and nosing, the foot rail and — in
 * 2005 — the raised bar ledge that turns the frontage into bar-height seating.
 *
 * Placement rules
 * ---------------
 * The frontage hangs on the counter's service face and stops 2 mm proud of it,
 * so it never intrudes into the counter volume. The counter-length nosing stays
 * behind the service lane; the 2005 bar ledge is split either side of the lane
 * so the barista's path to the counter survives the era change, and the foot
 * rail sits close enough to the face (60 mm) to stay clear of the stool
 * footprints.
 */

import * as THREE from 'three';
import type { RoomPoint } from '../../contracts/period';
import type { FurnitureBuildInput, FurniturePlanInput, PlacedProp, PropBuildResult, PropPlanEntry, PropSize } from './FurnitureModule';
import { boxMesh, cylinderMesh, furnitureMaterial } from './materials';
import { countMeshes } from './tables';

/** Clearance kept between the frontage and the counter's service face. */
const FACE_GAP = 0.002;
/**
 * Depth of the frontage's bounding box: the panelling sits against the service
 * face, and the capping, plinth and fielded edges stand proud of it into the
 * room. The whole box stays behind the service lane and clear of the counter.
 */
const FRONTAGE_DEPTH = 0.1;
/** How far the 2005 bar ledge reaches into the room. */
const LEDGE_DEPTH = 0.32;
/** Half width of the lane the bar ledge must leave open. */
const LEDGE_LANE_GAP = 0.1;
/** Distance of the foot rail in front of the service face. */
const FOOT_RAIL_OFFSET = 0.06;

export interface CounterFrontZone {
  readonly id: string;
  /** Floor centre of the panelling, in front of the service face. */
  readonly center: RoomPoint;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface CounterFixtureZone {
  readonly id: string;
  readonly center: RoomPoint;
  readonly size: PropSize;
  readonly kind: 'nosing' | 'foot-rail' | 'bar-ledge';
}

/** The panelled frontage of the era's counter. */
export function counterFrontZone(input: FurniturePlanInput): CounterFrontZone {
  const { counter } = input.layout;
  const depth = FRONTAGE_DEPTH;
  return {
    id: 'furniture:counter-front',
    center: {
      x: counter.center.x,
      y: 0,
      z: counter.serviceFaceZ + FACE_GAP + depth / 2,
    },
    width: counter.width,
    height: input.spec.counterFront.kind === 'stainless-bar' ? counter.baseHeight + 0.06 : counter.baseHeight,
    depth,
  };
}

/** Nosing, foot rail and bar ledge: the fixtures screwed to the frontage. */
export function counterFixtureZones(input: FurniturePlanInput): readonly CounterFixtureZone[] {
  const { counter } = input.layout;
  const { counterFront } = input.spec;
  const zones: CounterFixtureZone[] = [
    {
      id: 'furniture:counter-nosing',
      center: {
        x: counter.center.x,
        y: counter.surfaceHeight - 0.012,
        z: counter.serviceFaceZ + 0.055,
      },
      size: { x: counter.width - 0.04, y: 0.035, z: 0.11 },
      kind: 'nosing',
    },
  ];

  if (counterFront.footRail) {
    zones.push({
      id: 'furniture:counter-foot-rail',
      center: {
        x: counter.center.x,
        y: 0.22,
        z: counter.serviceFaceZ + FOOT_RAIL_OFFSET,
      },
      size: { x: counter.width - 0.3, y: 0.035, z: 0.05 },
      kind: 'foot-rail',
    });
  }

  if (counterFront.barHeight) {
    // Two ledges, one either side of the service lane.
    const laneHalf = Math.max(input.layout.serviceLane.width / 2 + LEDGE_LANE_GAP, 0.1);
    const outer = Math.max(counter.width / 2 - 0.12, laneHalf + 0.4);
    const segment = (outer - laneHalf) / 2;
    for (const sign of [-1, 1]) {
      zones.push({
        id: `furniture:counter-bar-ledge-${sign > 0 ? 'right' : 'left'}`,
        center: {
          x: sign * ((outer + laneHalf) / 2),
          y: counter.surfaceHeight + 0.06,
          z: counter.serviceFaceZ + LEDGE_DEPTH / 2 + FACE_GAP,
        },
        size: { x: segment, y: 0.05, z: LEDGE_DEPTH },
        kind: 'bar-ledge',
      });
    }
  }

  return zones;
}

/** Every counter frontage placement of one era. */
export function planCounterFront(input: FurniturePlanInput): readonly PropPlanEntry[] {
  const zone = counterFrontZone(input);
  const { counterFront } = input.spec;
  const entries: PropPlanEntry[] = [
    {
      id: zone.id,
      kind: 'counter-front',
      group: 'counterFront',
      label: counterFront.style,
      center: { x: zone.center.x, y: zone.height / 2, z: zone.center.z },
      size: { x: zone.width, y: zone.height, z: zone.depth },
      rotationY: 0,
      support: 'floor',
      tags: [counterFront.kind, counterFront.barHeight ? 'bar-height' : 'counter-height'],
    },
  ];

  for (const fixture of counterFixtureZones(input)) {
    entries.push({
      id: fixture.id,
      kind: 'counter-front',
      group: 'counterFront',
      label: fixture.kind,
      center: fixture.center,
      size: fixture.size,
      rotationY: 0,
      support: 'elevated',
      tags: [fixture.kind],
    });
  }

  return entries;
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

function partName(id: string, part: string): string {
  return `${id}:${part}`;
}

/** Back plane of the frontage, local to the facade group (against the counter). */
const PANEL_BACK = FRONTAGE_DEPTH / 2;

/** The panelled or slatted front, its plinth, stiles and top capping. */
export function buildCounterFront(
  input: FurnitureBuildInput,
  entries: readonly PropPlanEntry[],
): PropBuildResult {
  const group = new THREE.Group();
  group.name = 'furniture-counter-front';
  const props: PlacedProp[] = [];
  const landmarks: Record<string, THREE.Object3D> = {};
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  const zone = counterFrontZone(input);
  const entry = byId.get(zone.id);
  if (!entry) throw new Error('Missing the planned counter frontage entry.');

  const front = input.spec.counterFront;
  const panel = furnitureMaterial(input.materials, front.panelSlot);
  const panelAccent = furnitureMaterial(input.materials, front.panelAccentSlot);
  const trim = furnitureMaterial(input.materials, front.trimSlot);
  const nosing = furnitureMaterial(input.materials, front.nosingSlot);

  const facade = new THREE.Group();
  facade.name = zone.id;
  facade.userData.furnitureKind = 'counter-front';
  facade.position.set(zone.center.x, 0, zone.center.z);

  const kickHeight = Math.min(front.kickHeight, zone.height * 0.3);
  const capHeight = Math.min(front.topBandHeight, zone.height * 0.2);
  const panelTop = zone.height - capHeight;
  const slatted = front.kind === 'reclaimed-timber-slats';

  facade.add(
    // Plinth and kick recess: the frontage stands on a shadow gap.
    boxMesh([zone.width, kickHeight, 0.09], trim, {
      name: partName(zone.id, 'plinth'),
      part: 'counter-plinth',
      position: [0, kickHeight / 2, -PANEL_BACK + 0.045],
    }),
    boxMesh([zone.width - 0.02, capHeight, FRONTAGE_DEPTH], trim, {
      name: partName(zone.id, 'capping'),
      part: 'counter-capping',
      position: [0, panelTop + capHeight / 2, 0],
    }),
    boxMesh([zone.width, 0.02, 0.05], furnitureMaterial(input.materials, 'wornMetal'), {
      name: partName(zone.id, 'kick'),
      part: 'counter-kick',
      position: [0, 0.05, 0.01],
    }),
  );

  if (slatted) {
    // 2025: vertical reclaimed slats of varying tone over a recessed panel.
    const slatWidth = 0.075;
    const slats = Math.max(Math.round((zone.width - 0.06) / (slatWidth + 0.012)), 4);
    const pitch = (zone.width - 0.06) / slats;
    facade.add(
      boxMesh([zone.width - 0.06, panelTop - kickHeight, 0.02], panelAccent, {
        name: partName(zone.id, 'slat-backer'),
        part: 'counter-panel',
        position: [0, (panelTop + kickHeight) / 2, -PANEL_BACK + 0.01],
      }),
    );
    for (let index = 0; index < slats; index += 1) {
      const x = -zone.width / 2 + 0.03 + pitch * (index + 0.5);
      const height = panelTop - kickHeight;
      facade.add(
        boxMesh([slatWidth, height, 0.07], index % 3 === 0 ? panelAccent : panel, {
          name: partName(zone.id, 'slat'),
          part: 'counter-slat',
          position: [x, kickHeight + height / 2, 0],
        }),
      );
    }
  } else {
    const panels = Math.max(Math.round(zone.width / Math.max(front.panelWidth, 0.3)), 2);
    const pitch = zone.width / panels;
    const panelHeight = panelTop - kickHeight;
    for (let index = 0; index < panels; index += 1) {
      const x = -zone.width / 2 + pitch * (index + 0.5);
      facade.add(
        boxMesh([Math.max(pitch - 0.05, 0.1), panelHeight, 0.07], index % 2 === 0 ? panel : panelAccent, {
          name: partName(zone.id, 'panel'),
          part: 'counter-panel',
          position: [x, kickHeight + panelHeight / 2, -PANEL_BACK + 0.035],
        }),
        // A fielded edge on every panel: four thin rails, era joinery detail.
        boxMesh([Math.max(pitch - 0.05, 0.1) - 0.09, 0.02, 0.012], trim, {
          name: partName(zone.id, 'panel-field'),
          part: 'counter-panel-field',
          position: [x, kickHeight + panelHeight * 0.16, 0.025],
        }),
        boxMesh([Math.max(pitch - 0.05, 0.1) - 0.09, 0.02, 0.012], trim, {
          name: partName(zone.id, 'panel-field'),
          part: 'counter-panel-field',
          position: [x, panelTop - panelHeight * 0.16, 0.025],
        }),
      );
      if (index < panels - 1) {
        facade.add(
          boxMesh([0.05, panelHeight, 0.085], trim, {
            name: partName(zone.id, 'stile'),
            part: 'counter-stile',
            position: [-zone.width / 2 + pitch * (index + 1), kickHeight + panelHeight / 2, 0],
          }),
        );
      }
    }
  }

  // Banding: a chrome or steel line under the capping reads as the era's trim.
  facade.add(
    boxMesh([zone.width, 0.03, 0.03], nosing, {
      name: partName(zone.id, 'trade-band'),
      part: 'counter-trade-band',
      position: [0, panelTop - 0.03, 0.04],
    }),
  );

  group.add(facade);
  props.push({ ...entry, node: facade });
  landmarks['counter-front'] = facade;

  /* -- fixtures screwed to the frontage ------------------------------------ */

  for (const fixture of counterFixtureZones(input)) {
    const fixtureEntry = byId.get(fixture.id);
    if (!fixtureEntry) continue;
    const node = new THREE.Group();
    node.name = fixture.id;
    node.position.set(fixture.center.x, 0, fixture.center.z);
    node.userData.furnitureKind = fixture.kind;

    if (fixture.kind === 'nosing') {
      node.add(
        boxMesh([fixture.size.x, fixture.size.y, fixture.size.z], nosing, {
          name: partName(fixture.id, 'nosing'),
          part: 'counter-nosing',
          position: [0, fixture.center.y, 0],
        }),
      );
    } else if (fixture.kind === 'foot-rail') {
      node.add(
        cylinderMesh(0.016, 0.016, fixture.size.x, nosing, {
          name: partName(fixture.id, 'foot-rail'),
          part: 'counter-foot-rail',
          position: [0, fixture.center.y, 0],
          rotation: [0, 0, Math.PI / 2],
        }),
      );
      const brackets = Math.max(Math.round(fixture.size.x / 1.1), 2);
      for (let index = 0; index < brackets; index += 1) {
        const t = brackets === 1 ? 0.5 : index / (brackets - 1);
        const x = -fixture.size.x / 2 + fixture.size.x * t;
        node.add(
          cylinderMesh(0.011, 0.011, 0.09, trim, {
            name: partName(fixture.id, 'bracket'),
            part: 'counter-foot-rail-bracket',
            position: [x + 0.03, fixture.center.y + 0.02, -0.04],
            rotation: [Math.PI / 2.4, 0, 0],
          }),
        );
      }
    } else {
      // The 2005 bar ledge: a thick timber top with two steel supports.
      node.add(
        boxMesh([fixture.size.x, fixture.size.y, fixture.size.z], nosing, {
          name: partName(fixture.id, 'ledge'),
          part: 'counter-bar-ledge',
          position: [0, fixture.center.y, 0],
        }),
        boxMesh([fixture.size.x, 0.02, fixture.size.z - 0.08], trim, {
          name: partName(fixture.id, 'ledge-underside'),
          part: 'counter-bar-ledge-support',
          position: [0, fixture.center.y - 0.035, 0],
        }),
      );
    }

    group.add(node);
    props.push({ ...fixtureEntry, node });
    landmarks[fixture.kind] = node;
  }

  return { group, props, landmarks, meshCount: countMeshes(group) };
}
