/**
 * Storefront and street: everything the café shows to the road, plus the sliver
 * of street visible through the glass.
 *
 * `buildStorefront` raises four more named nodes into the environment group:
 *
 *  - `environment-storefront-glazing` — the glazing panes filling the openings
 *    cut out of the front wall, the period mullion grid, the window dressing and
 *    the awning.
 *  - `environment-entrance-door` — the entrance leaf, its frame, push bar, kick
 *    plate and glass panel, sitting in the reserved entrance bay.
 *  - `environment-street-sliver` — pavement, kerb, road, the facade across the
 *    street and two street lamps: just enough depth for the view through the
 *    glass.
 *  - `environment-signage-bracket` — the exterior bracket and the period blade
 *    carrying the café's name (painted here with the built-in bitmap font, so no
 *    web font or image is ever fetched).
 *
 * The mullion grid, the window dressing, the awning and the signage blade are
 * profile driven detail: `applyStorefrontEra` rebuilds them for a new era and
 * releases the geometries it replaces, while the structural nodes stay put.
 */

import * as THREE from 'three';
import type { RoomBounds } from '../../contracts/period';
import type { EnvironmentSpec } from './data/years';
import { boxMaterialMesh, releaseGeometry, type ShellParts } from './architecture';
import type { MaterialSet } from './materials';
import { SHELL_NODE_NAMES, SIGNAGE_MOUNT_HEIGHT } from './roomBounds';

/** The storefront nodes plus the groups `applyStorefrontEra` rebuilds. */
export interface StorefrontParts {
  readonly glazing: THREE.Group;
  readonly entranceDoor: THREE.Group;
  readonly streetSliver: THREE.Group;
  readonly signageBracket: THREE.Group;
  /** Rebuilt per era: the glazing mullion grid. */
  readonly mullions: THREE.Group;
  /** Rebuilt per era: the window dressing. */
  readonly dressing: THREE.Group;
  /** Rebuilt per era: the awning above the glazing (empty when the era has none). */
  readonly awning: THREE.Group;
  /** Rebuilt per era: the signage blade and its lettering. */
  readonly blade: THREE.Group;
  /** Era currently applied. */
  currentSpec: EnvironmentSpec;
}

export interface StorefrontBuildOptions {
  readonly spec: EnvironmentSpec;
  readonly materials: MaterialSet;
}

/** Width of a signage blade derived from the length of its lettering. */
export function signageBladeWidth(lettering: string): number {
  return Math.min(Math.max(lettering.length * 0.17 + 0.5, 1.4), 4.4);
}

function subGroup(parent: THREE.Object3D, name: string): THREE.Group {
  const group = new THREE.Group();
  group.name = name;
  parent.add(group);
  return group;
}

/* -------------------------------------------------------------------------- */
/* Glazing                                                                    */
/* -------------------------------------------------------------------------- */

function buildGlazingPanes(parts: ShellParts, spec: EnvironmentSpec): THREE.Group {
  const { layout, bounds } = parts;
  const group = new THREE.Group();
  group.name = SHELL_NODE_NAMES.storefrontGlazing;
  const z = bounds.depth / 2 - 0.012;

  for (const zone of layout.glazingZones) {
    group.add(
      boxMaterialMesh(
        new THREE.PlaneGeometry(zone.width, zone.height),
        'glass',
        `${SHELL_NODE_NAMES.storefrontGlazing}-pane-${zone.id}`,
        'glazing-pane',
        { position: [zone.position.x, zone.sillHeight + zone.height / 2, z] },
      ),
    );
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(zone.width + 0.08, 0.05, 0.14),
        'trim',
        `${SHELL_NODE_NAMES.storefrontGlazing}-sill-${zone.id}`,
        'glazing-sill',
        { position: [zone.position.x, zone.sillHeight, bounds.depth / 2 - 0.06] },
      ),
    );
  }
  return group;
}

function rebuildMullions(parts: ShellParts, storefront: StorefrontParts, spec: EnvironmentSpec): void {
  const group = storefront.mullions;
  releaseGeometry(group);
  const { layout, bounds } = parts;
  const z = bounds.depth / 2 - 0.03;
  const bar = Math.max(spec.glazing.mullionWidth, 0.02);

  for (const zone of layout.glazingZones) {
    const left = zone.position.x - zone.width / 2;
    const right = zone.position.x + zone.width / 2;
    const bottom = zone.sillHeight;
    const top = zone.sillHeight + zone.height;
    const frame = (name: string, width: number, height: number, x: number, y: number): void => {
      group.add(
        boxMaterialMesh(
          new THREE.BoxGeometry(width, height, bar * 1.6),
          'frame',
          `${SHELL_NODE_NAMES.storefrontGlazing}-mullion-${zone.id}-${name}`,
          'glazing-mullion',
          { position: [x, y, z] },
        ),
      );
    };
    frame('left', bar, zone.height, left + bar / 2, zone.sillHeight + zone.height / 2);
    frame('right', bar, zone.height, right - bar / 2, zone.sillHeight + zone.height / 2);
    frame('bottom', zone.width, bar, zone.position.x, bottom + bar / 2);
    frame('top', zone.width, bar, zone.position.x, top - bar / 2);

    const columns = Math.max(spec.glazing.paneColumns, 1);
    for (let index = 1; index < columns; index += 1) {
      const x = left + (zone.width * index) / columns;
      frame(`column-${index}`, bar * 0.8, zone.height, x, zone.sillHeight + zone.height / 2);
    }
    const rows = Math.max(spec.glazing.paneRows, 1);
    for (let index = 1; index < rows; index += 1) {
      const y = bottom + (zone.height * index) / rows;
      frame(`row-${index}`, zone.width, bar * 0.8, zone.position.x, y);
    }
    if (spec.glazing.transom && rows === 1) {
      frame('transom', zone.width, bar * 0.8, zone.position.x, bottom + zone.height * 0.72);
    }
  }
}

function rebuildDressing(parts: ShellParts, storefront: StorefrontParts, spec: EnvironmentSpec): void {
  const group = storefront.dressing;
  releaseGeometry(group);
  const { layout, bounds } = parts;
  const dressing = spec.windowDressing;
  const z = bounds.depth / 2 - 0.1;

  layout.glazingZones.forEach((zone, index) => {
    const span = zone.width * Math.min(Math.max(dressing.span, 0.2), 1);
    const drop = zone.height * Math.min(Math.max(dressing.coverage, 0.05), 1);
    const top = zone.sillHeight + zone.height;

    switch (dressing.kind) {
      case 'venetian-blinds':
      case 'valance-and-blinds': {
        if (dressing.kind === 'valance-and-blinds') {
          group.add(
            boxMaterialMesh(
              new THREE.BoxGeometry(span, 0.09, 0.05),
              'dressing',
              `${SHELL_NODE_NAMES.storefrontGlazing}-valance-${zone.id}`,
              'dressing-valance',
              { position: [zone.position.x, top - 0.06, z] },
            ),
          );
        }
        const slats = Math.max(dressing.slatCount, 2);
        for (let slat = 0; slat < slats; slat += 1) {
          const y = top - ((slat + 0.5) * drop) / slats;
          group.add(
            boxMaterialMesh(
              new THREE.BoxGeometry(span, 0.022, 0.012),
              'dressing',
              `${SHELL_NODE_NAMES.storefrontGlazing}-blind-${zone.id}-${slat + 1}`,
              'dressing-slat',
              { position: [zone.position.x, y, z], rotation: [0.32, 0, 0] },
            ),
          );
        }
        if (dressing.kind === 'valance-and-blinds' && index === 0) {
          group.add(
            boxMaterialMesh(
              new THREE.PlaneGeometry(zone.width * 0.6, 0.34),
              'lamp',
              `${SHELL_NODE_NAMES.storefrontGlazing}-window-sign`,
              'dressing-sign',
              { position: [zone.position.x, zone.sillHeight + zone.height * 0.55, z + 0.06] },
            ),
          );
        }
        break;
      }
      case 'frost-film': {
        group.add(
          boxMaterialMesh(
            new THREE.PlaneGeometry(span, drop),
            'dressing',
            `${SHELL_NODE_NAMES.storefrontGlazing}-film-${zone.id}`,
            'dressing-panel',
            { position: [zone.position.x, zone.sillHeight + zone.height * 0.55, z] },
          ),
        );
        group.add(
          boxMaterialMesh(
            new THREE.PlaneGeometry(span * 0.92, 0.14),
            'trim',
            `${SHELL_NODE_NAMES.storefrontGlazing}-film-band-${zone.id}`,
            'dressing-band',
            { position: [zone.position.x, zone.sillHeight + zone.height * 0.55, z + 0.01] },
          ),
        );
        break;
      }
      case 'linen-scrim': {
        group.add(
          boxMaterialMesh(
            new THREE.PlaneGeometry(span, drop),
            'dressing',
            `${SHELL_NODE_NAMES.storefrontGlazing}-scrim-${zone.id}`,
            'dressing-panel',
            { position: [zone.position.x, top - drop / 2, z] },
          ),
        );
        if (index === 1) {
          group.add(
            boxMaterialMesh(
              new THREE.PlaneGeometry(zone.width * 0.34, 0.24),
              'trim',
              `${SHELL_NODE_NAMES.storefrontGlazing}-decal-${zone.id}`,
              'dressing-decal',
              { position: [zone.position.x, zone.sillHeight + zone.height * 0.6, z + 0.01] },
            ),
          );
        }
        break;
      }
      case 'lace-net':
      default: {
        group.add(
          boxMaterialMesh(
            new THREE.PlaneGeometry(span, drop),
            'dressing',
            `${SHELL_NODE_NAMES.storefrontGlazing}-net-${zone.id}`,
            'dressing-panel',
            { position: [zone.position.x, zone.sillHeight + drop / 2 + 0.04, z] },
          ),
        );
        group.add(
          boxMaterialMesh(
            new THREE.BoxGeometry(span, 0.07, 0.05),
            'trim',
            `${SHELL_NODE_NAMES.storefrontGlazing}-pelmet-${zone.id}`,
            'dressing-pelmet',
            { position: [zone.position.x, top - 0.04, z] },
          ),
        );
        break;
      }
    }
  });
}

function rebuildAwning(parts: ShellParts, storefront: StorefrontParts, spec: EnvironmentSpec): void {
  const group = storefront.awning;
  releaseGeometry(group);
  if (!spec.windowDressing.awning) return;
  const { bounds } = parts;
  const width = bounds.width * 0.86;
  const projection = bounds.depth * 0.08 + 0.7;
  const z = bounds.depth / 2 + projection / 2;
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(width, 0.04, projection),
      'awning',
      `${SHELL_NODE_NAMES.storefrontGlazing}-awning-canopy`,
      'awning-canopy',
      { position: [0, bounds.height * 0.93, z], rotation: [-0.26, 0, 0], castShadow: true },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(width, 0.22, 0.05),
      'awning',
      `${SHELL_NODE_NAMES.storefrontGlazing}-awning-valance`,
      'awning-valance',
      { position: [0, bounds.height * 0.93 - 0.12, bounds.depth / 2 + projection] },
    ),
  );
  for (const side of [-1, 1]) {
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(0.05, 0.05, projection),
        'frame',
        `${SHELL_NODE_NAMES.storefrontGlazing}-awning-arm-${side < 0 ? 'left' : 'right'}`,
        'awning-arm',
        { position: [width / 2 - 0.06, bounds.height * 0.92, z] },
      ),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Entrance door                                                              */
/* -------------------------------------------------------------------------- */

function buildEntranceDoor(parts: ShellParts, spec: EnvironmentSpec): THREE.Group {
  const { layout, bounds } = parts;
  const entrance = layout.entrance;
  const group = new THREE.Group();
  group.name = SHELL_NODE_NAMES.entranceDoor;
  const z = bounds.depth / 2 - 0.04;
  const leafWidth = entrance.width - 0.16;
  const leafHeight = entrance.height - 0.08;

  for (const side of [-1, 1]) {
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(0.08, entrance.height, 0.16),
        'frame',
        `${SHELL_NODE_NAMES.entranceDoor}-jamb-${side < 0 ? 'left' : 'right'}`,
        'door-jamb',
        { position: [entrance.position.x + (entrance.width / 2 + 0.04) * side, entrance.height / 2, z] },
      ),
    );
  }
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(entrance.width + 0.16, 0.09, 0.16),
      'frame',
      `${SHELL_NODE_NAMES.entranceDoor}-head`,
      'door-head',
      { position: [entrance.position.x, entrance.height + 0.02, z] },
    ),
  );

  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(leafWidth, leafHeight, 0.07),
      'door',
      `${SHELL_NODE_NAMES.entranceDoor}-leaf`,
      'door-leaf',
      { position: [entrance.position.x, leafHeight / 2 + 0.02, z] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.PlaneGeometry(leafWidth * 0.66, leafHeight * 0.5),
      'glass',
      `${SHELL_NODE_NAMES.entranceDoor}-leaf-glass`,
      'door-glass',
      { position: [entrance.position.x, leafHeight * 0.6, z + 0.045] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.CylinderGeometry(0.022, 0.022, leafWidth * 0.8, 10),
      'metal',
      `${SHELL_NODE_NAMES.entranceDoor}-push-bar`,
      'door-push-bar',
      { position: [entrance.position.x, entrance.height * 0.45, z + 0.07], rotation: [0, 0, Math.PI / 2] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(leafWidth, 0.22, 0.02),
      'metal',
      `${SHELL_NODE_NAMES.entranceDoor}-kick-plate`,
      'door-kick-plate',
      { position: [entrance.position.x, 0.16, z + 0.05] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(entrance.width + 0.24, 0.035, 0.32),
      'trim',
      `${SHELL_NODE_NAMES.entranceDoor}-threshold`,
      'door-threshold',
      { position: [entrance.position.x, 0.017, z - 0.06] },
    ),
  );
  return group;
}

/* -------------------------------------------------------------------------- */
/* Street sliver                                                              */
/* -------------------------------------------------------------------------- */

function buildStreetSliver(bounds: RoomBounds): THREE.Group {
  const group = new THREE.Group();
  group.name = SHELL_NODE_NAMES.streetSliver;
  const halfDepth = bounds.depth / 2;
  const pavementWidth = bounds.width * 1.6;

  group.add(
    boxMaterialMesh(
      new THREE.PlaneGeometry(pavementWidth, 5),
      'street',
      `${SHELL_NODE_NAMES.streetSliver}-pavement`,
      'street-pavement',
      { position: [0, -0.01, halfDepth + 2.5], rotation: [-Math.PI / 2, 0, 0] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(pavementWidth, 0.14, 0.24),
      'kerb',
      `${SHELL_NODE_NAMES.streetSliver}-kerb`,
      'street-kerb',
      { position: [0, 0.06, halfDepth + 5.12] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.PlaneGeometry(pavementWidth + 2, 4.6),
      'road',
      `${SHELL_NODE_NAMES.streetSliver}-road`,
      'street-road',
      { position: [0, -0.16, halfDepth + 7.5], rotation: [-Math.PI / 2, 0, 0] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.PlaneGeometry(pavementWidth + 2, 2),
      'street',
      `${SHELL_NODE_NAMES.streetSliver}-far-pavement`,
      'street-pavement',
      { position: [0, 0, halfDepth + 10.8], rotation: [-Math.PI / 2, 0, 0] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(pavementWidth + 2, 7.4, 0.4),
      'streetFacade',
      `${SHELL_NODE_NAMES.streetSliver}-facade`,
      'street-facade',
      { position: [0, 3.4, halfDepth + 12] },
    ),
  );
  for (const side of [-1, 1]) {
    group.add(
      boxMaterialMesh(
        new THREE.CylinderGeometry(0.05, 0.07, 3.6, 10),
        'metal',
        `${SHELL_NODE_NAMES.streetSliver}-lamp-post-${side < 0 ? 'left' : 'right'}`,
        'street-lamp-post',
        { position: [side * (pavementWidth / 2 - 0.6), 1.8, halfDepth + 4.9] },
      ),
    );
    group.add(
      boxMaterialMesh(
        new THREE.SphereGeometry(0.16, 14, 10),
        'lamp',
        `${SHELL_NODE_NAMES.streetSliver}-lamp-head-${side < 0 ? 'left' : 'right'}`,
        'street-lamp-head',
        { position: [side * (pavementWidth / 2 - 0.6), 3.62, halfDepth + 4.9] },
      ),
    );
  }
  return group;
}

/* -------------------------------------------------------------------------- */
/* Signage bracket                                                            */
/* -------------------------------------------------------------------------- */

function rebuildBlade(storefront: StorefrontParts, spec: EnvironmentSpec, bounds: RoomBounds): void {
  const group = storefront.blade;
  releaseGeometry(group);
  const halfDepth = bounds.depth / 2;
  const bladeWidth = signageBladeWidth(spec.signage.lettering);
  const bladeHeight = spec.signage.bladeHeight;
  const projection = spec.signage.projection;
  const z = halfDepth + projection;
  const y = SIGNAGE_MOUNT_HEIGHT;
  const armZ = halfDepth + projection / 2 + 0.02;

  // Bracket plate against the facade.
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(0.44, 0.44, 0.08),
      'frame',
      `${SHELL_NODE_NAMES.signageBracket}-plate`,
      'signage-plate',
      { position: [0, y, halfDepth + 0.04] },
    ),
  );

  // Arms, in the era's bracket style.
  const arm = (name: string, x: number, geometry: THREE.BufferGeometry, slot: 'metal' | 'blade', rotation?: readonly [number, number, number]): void => {
    group.add(
      boxMaterialMesh(geometry, slot, `${SHELL_NODE_NAMES.signageBracket}-arm-${name}`, 'signage-arm', {
        position: [x, y, armZ],
        rotation,
      }),
    );
  };
  const armOffset = bladeWidth / 2 - 0.12;
  switch (spec.signage.armStyle) {
    case 'wrought-iron-scroll': {
      for (const side of [-1, 1]) {
        arm(`rod-${side < 0 ? 'left' : 'right'}`, side * armOffset, new THREE.CylinderGeometry(0.022, 0.022, projection + 0.2, 8), 'metal', [Math.PI / 2, 0, 0]);
        arm(`brace-${side < 0 ? 'left' : 'right'}`, side * armOffset, new THREE.CylinderGeometry(0.016, 0.016, 0.7, 8), 'metal', [Math.PI / 4, 0, 0]);
      }
      break;
    }
    case 'chrome-arm': {
      for (const side of [-1, 1]) {
        arm(`rod-${side < 0 ? 'left' : 'right'}`, side * armOffset, new THREE.CylinderGeometry(0.026, 0.026, projection + 0.14, 10), 'metal', [Math.PI / 2, 0, 0]);
      }
      break;
    }
    case 'brass-rod': {
      for (const side of [-1, 1]) {
        arm(`rod-${side < 0 ? 'left' : 'right'}`, side * armOffset, new THREE.CylinderGeometry(0.018, 0.018, projection + 0.14, 10), 'metal', [Math.PI / 2, 0, 0]);
        group.add(
          boxMaterialMesh(
            new THREE.SphereGeometry(0.035, 10, 8),
            'blade',
            `${SHELL_NODE_NAMES.signageBracket}-finial-${side < 0 ? 'left' : 'right'}`,
            'signage-finial',
            { position: [side * armOffset, y, z] },
          ),
        );
      }
      break;
    }
    case 'steel-channel':
    case 'painted-steel-bracket':
    default: {
      for (const side of [-1, 1]) {
        arm(
          `channel-${side < 0 ? 'left' : 'right'}`,
          side * armOffset,
          new THREE.BoxGeometry(0.06, 0.12, projection + 0.12),
          spec.signage.armStyle === 'steel-channel' ? 'metal' : 'blade',
        );
        arm(
          `diagonal-${side < 0 ? 'left' : 'right'}`,
          side * armOffset,
          new THREE.BoxGeometry(0.05, 0.05, 0.62),
          spec.signage.armStyle === 'steel-channel' ? 'metal' : 'blade',
          [Math.PI / 4, 0, 0],
        );
      }
      break;
    }
  }

  // Blade body, lettered on both faces.
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(bladeWidth, bladeHeight, 0.08),
      'blade',
      `${SHELL_NODE_NAMES.signageBracket}-blade`,
      'signage-blade',
      { position: [0, y, z] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.PlaneGeometry(bladeWidth * 0.96, bladeHeight * 0.78),
      'signage',
      `${SHELL_NODE_NAMES.signageBracket}-lettering-street`,
      'signage-lettering',
      { position: [0, y, z + 0.045] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.PlaneGeometry(bladeWidth * 0.96, bladeHeight * 0.78),
      'signage',
      `${SHELL_NODE_NAMES.signageBracket}-lettering-room`,
      'signage-lettering',
      { position: [0, y, z - 0.045], rotation: [0, Math.PI, 0] },
    ),
  );
  if (spec.signage.illuminated) {
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(bladeWidth * 0.9, 0.05, 0.05),
        'lamp',
        `${SHELL_NODE_NAMES.signageBracket}-tube`,
        'signage-lamp',
        { position: [0, y - bladeHeight / 2 - 0.06, z] },
      ),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/** Builds the storefront, entry, street sliver and signage bracket nodes. */
export function buildStorefront(parts: ShellParts, options: StorefrontBuildOptions): StorefrontParts {
  const glazing = buildGlazingPanes(parts, options.spec);
  const entranceDoor = buildEntranceDoor(parts, options.spec);
  const streetSliver = buildStreetSliver(parts.bounds);
  const signageBracket = new THREE.Group();
  signageBracket.name = SHELL_NODE_NAMES.signageBracket;

  const mullions = subGroup(glazing, `${SHELL_NODE_NAMES.storefrontGlazing}-mullions`);
  const dressing = subGroup(glazing, `${SHELL_NODE_NAMES.storefrontGlazing}-dressing`);
  const awning = subGroup(glazing, `${SHELL_NODE_NAMES.storefrontGlazing}-awning`);
  const blade = subGroup(signageBracket, `${SHELL_NODE_NAMES.signageBracket}-blade-group`);

  const storefront: StorefrontParts = {
    glazing,
    entranceDoor,
    streetSliver,
    signageBracket,
    mullions,
    dressing,
    awning,
    blade,
    currentSpec: options.spec,
  };

  parts.group.add(glazing, entranceDoor, streetSliver, signageBracket);
  parts.nodes.storefrontGlazing = glazing;
  parts.nodes.entranceDoor = entranceDoor;
  parts.nodes.streetSliver = streetSliver;
  parts.nodes.signageBracket = signageBracket;

  rebuildMullions(parts, storefront, options.spec);
  rebuildDressing(parts, storefront, options.spec);
  rebuildAwning(parts, storefront, options.spec);
  rebuildBlade(storefront, options.spec, parts.bounds);
  return storefront;
}

/**
 * Moves the storefront to a new era: the mullion grid, dressing, awning and
 * signage blade are rebuilt from the era spec and their old geometries released.
 * Materials are re-pointed by the shell's material pass, which walks this whole
 * group.
 */
export function applyStorefrontEra(
  storefront: StorefrontParts,
  parts: ShellParts,
  spec: EnvironmentSpec,
): void {
  storefront.currentSpec = spec;
  rebuildMullions(parts, storefront, spec);
  rebuildDressing(parts, storefront, spec);
  rebuildAwning(parts, storefront, spec);
  rebuildBlade(storefront, spec, parts.bounds);
}

/**
 * Structural fingerprint of the storefront for one era: mullion grid, dressing
 * geometry, awning presence, blade width and bracket style. Distinct per era.
 */
export function storefrontEraSignature(storefront: StorefrontParts): string {
  const counts = new Map<string, number>();
  const collect = (root: THREE.Object3D): void => {
    root.traverse((object) => {
      const part = object.userData['environmentPart'];
      if (typeof part !== 'string') return;
      counts.set(part, (counts.get(part) ?? 0) + 1);
    });
  };
  collect(storefront.mullions);
  collect(storefront.dressing);
  collect(storefront.awning);
  collect(storefront.blade);
  const bladeMesh = storefront.blade.children.find(
    (child) => child.userData['environmentPart'] === 'signage-blade',
  ) as THREE.Mesh | undefined;
  const bladeGeometry = bladeMesh?.geometry as (THREE.BufferGeometry & { parameters?: { width?: number } }) | undefined;
  const bladeWidth = bladeGeometry?.parameters?.width ?? 0;
  return [
    `mullions=${counts.get('glazing-mullion') ?? 0}`,
    `panels=${counts.get('dressing-panel') ?? 0}`,
    `slats=${counts.get('dressing-slat') ?? 0}`,
    `valance=${counts.get('dressing-valance') ?? 0}`,
    `awning=${counts.get('awning-canopy') ?? 0}`,
    `blade=${bladeWidth.toFixed(2)}`,
    `pane${storefront.currentSpec.glazing.paneColumns}x${storefront.currentSpec.glazing.paneRows}`,
    `transom=${storefront.currentSpec.glazing.transom ? 1 : 0}`,
    `arm=${storefront.currentSpec.signage.armStyle}`,
  ].join('|');
}
