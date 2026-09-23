/**
 * Chrono City — ground-floor shopfronts, window dressing and awnings.
 *
 * This module owns the whole `0–4 m` storefront band of the block perimeter: the
 * plinth, pilasters, fascia, glazing, doors, display bays, interior backdrops,
 * awnings and the goods/dressing behind the glass. Everything it draws stays
 * inside the band (proven by `chronoStorefrontRole` tags and the boundary test),
 * so the buildings task's mount panel is the only other geometry down there.
 *
 * Lifecycle:
 *   create    → `planShopfront(lot, era, random)` turns one lot into a
 *               deterministic, era-authentic shop (archetype, name, signage
 *               media, awning, dressing list and bay dimensions);
 *               `buildShopfront({ plan, ... })` hangs the geometry off a group.
 *   consume   → `StorefrontsApi` owns the plan/build cycle, the sign textures and
 *               the animation, and registers inspectables from the plans.
 *   integrate → the API is wired into `main.ts` by the era-transition task.
 *
 * Design notes
 * ------------
 *  * **Era tables, not branches.** Shop archetypes, awning styles and interior
 *    lighting are authored per era in frozen tables; the code paths are era-blind.
 *  * **Cheap detail.** Every prop is a scaled instance of the four shared unit
 *    primitives, batched one `InstancedMesh` per (shape, material) — a whole
 *    shopfront costs a handful of draw calls.
 *  * **Bounded materials.** One era resolves at most
 *    `MAX_STOREFRONT_MATERIALS_PER_ERA` library materials and shares them across
 *    all eighteen lots; per-lot variation rides on three accent fabrics.
 */

import * as THREE from 'three';

import { assertEraId, clamp01, smoothStep01, type EraId } from '../../core/eraContracts';
import type { RandomSource } from '../../core/sceneContext';
import { getEraDescriptor } from '../../era/eraDescriptors';
import type { MaterialLibrary } from '../../materials/materialLibrary';
import {
  LOT_LAYOUT,
  STOREFRONT_BAND_HEIGHT,
  DetailGeometrySet,
  type DetailGeometrySet as DetailGeometrySetType,
  type DetailInstanceSpec,
  type DetailRotation,
  type LotDefinition,
} from '../buildings/buildingFactory';
import {
  type SignMaterialHandle,
  type SignMedia,
  type SignPalette,
  type SignTextBlock,
} from './signTextures';

export const STOREFRONT_FACTORY_VERSION = 1;

/** Band height this module fills; re-exported so consumers agree with buildings. */
export { STOREFRONT_BAND_HEIGHT };

/** Hard cap on distinct library materials one era of shopfronts resolves. */
export const MAX_STOREFRONT_MATERIALS_PER_ERA = 12;

/** Accent fabrics (awnings, valances, goods) one era may use. */
export const MAX_STOREFRONT_ACCENTS_PER_ERA = 3;

/* ------------------------------------------------------------------------- *
 * Band metrics (metres, lot-local: +x along the frontage, +z towards the street)
 * ------------------------------------------------------------------------- */

export const STOREFRONT_METRICS = Object.freeze({
  /** Height of the shopfront plinth / stall riser. */
  plinthHeight: 0.38,
  /** Depth the plinth and pilasters stand proud of the wall. */
  frameDepth: 0.5,
  /** Width of the pilaster at each end of a shopfront. */
  pilasterWidth: 0.44,
  /** Bottom of the fascia board. */
  fasciaBottom: 3.16,
  /** Height of the fascia board (top lands at 3.9 m, inside the band). */
  fasciaHeight: 0.74,
  /** Cornice cap above the fascia. */
  corniceHeight: 0.1,
  /** Bottom of the transom / letterboard strip above the glazing. */
  transomBottom: 2.56,
  /** Height of that strip. */
  transomHeight: 0.46,
  /** Head height of the display glazing. */
  glassTop: 2.52,
  /** Base of the display bay floor. */
  displayFloor: 0.46,
  /** Backdrop plane the dressing stands in front of. */
  backdropZ: 0.36,
  /** Clear width of a shop door. */
  doorWidth: 1.08,
  /** Height of a shop door leaf. */
  doorHeight: 2.46,
  /** Gap between the door frame and the display bay. */
  doorMargin: 0.26,
  /** How far the awning springs from the wall. */
  awningSpring: 2.98,
});

/** Roles every storefront mesh is tagged with, for boundary + budget audits. */
export type StorefrontRole =
  | 'shopfront'
  | 'shopfront-glass'
  | 'window-dressing'
  | 'awning'
  | 'signage'
  | 'advertising'
  | 'billboard'
  | 'ground-fixture';

/** Every storefront role, in the order they are documented. */
export const STOREFRONT_ROLES: readonly StorefrontRole[] = Object.freeze([
  'shopfront',
  'shopfront-glass',
  'window-dressing',
  'awning',
  'signage',
  'advertising',
  'billboard',
  'ground-fixture',
]);

/** Roles that must stay inside the building perimeter's `0–4 m` band. */
export const BAND_ROLES: readonly StorefrontRole[] = Object.freeze([
  'shopfront',
  'shopfront-glass',
  'window-dressing',
  'awning',
  'signage',
  'advertising',
]);

/** Roles that stand on the sidewalk instead (freestanding media). */
export const SIDEWALK_ROLES: readonly StorefrontRole[] = Object.freeze([
  'billboard',
  'ground-fixture',
]);

/* ------------------------------------------------------------------------- *
 * Lots and mount surfaces
 * ------------------------------------------------------------------------- */

/** One lot the storefront task can dress (a subset of a building lot). */
export interface StorefrontLot {
  readonly id: string;
  readonly side: LotDefinition['side'];
  /**
   * Position of the lot in the ring order (`0`–`17`), *not* its position within
   * its side: the shop program planner spreads the era's archetypes and their
   * trading names across this number, so a street never repeats a shop.
   */
  readonly index: number;
  readonly frontWidth: number;
  readonly frontCenter: Readonly<{ x: number; z: number }>;
  readonly yaw: number;
  readonly landmark?: boolean;
}

/**
 * The storefront band surface one lot offers. Structurally identical to the
 * buildings task's `BuildingMountSurface`, so
 * `createStorefrontsApi({ mountSurfaces: buildings.mountSurfaceList() })` just
 * works while the default keeps the two tasks aligned without any wiring.
 */
export interface StorefrontMountSurface {
  readonly id: string;
  readonly lotId: string;
  readonly side: LotDefinition['side'];
  /** Centre of the band panel, world space, at half the band height. */
  readonly position: Readonly<{ x: number; y: number; z: number }>;
  /** Outward-facing unit normal in world space. */
  readonly normal: Readonly<{ x: number; y: number; z: number }>;
  readonly width: number;
  readonly height: number;
  readonly yaw: number;
}

/** The authored lot ring, projected onto the storefront contract. */
export function defaultStorefrontLots(): readonly StorefrontLot[] {
  return Object.freeze(
    LOT_LAYOUT.map((lot, slotIndex) =>
      Object.freeze({
        id: lot.id,
        side: lot.side,
        index: slotIndex,
        frontWidth: lot.frontWidth,
        frontCenter: Object.freeze({ x: lot.frontCenter.x, z: lot.frontCenter.z }),
        yaw: lot.yaw,
        landmark: lot.landmark,
      }),
    ),
  );
}

/** Derives the band mount surface of every lot, in the buildings convention. */
export function mountSurfacesFromLots(
  lots: readonly StorefrontLot[],
): readonly StorefrontMountSurface[] {
  return Object.freeze(
    lots.map((lot) =>
      Object.freeze({
        id: `${lot.id}-band`,
        lotId: lot.id,
        side: lot.side,
        position: Object.freeze({
          x: lot.frontCenter.x,
          y: STOREFRONT_BAND_HEIGHT / 2,
          z: lot.frontCenter.z,
        }),
        normal: Object.freeze({ x: Math.sin(lot.yaw), y: 0, z: Math.cos(lot.yaw) }),
        width: lot.frontWidth,
        height: STOREFRONT_BAND_HEIGHT,
        yaw: lot.yaw,
      }),
    ),
  );
}

/* ------------------------------------------------------------------------- *
 * Shop programs
 * ------------------------------------------------------------------------- */

/** What kind of business a shopfront is; drives dressing, not code paths. */
export type ShopKind =
  | 'grocer'
  | 'diner'
  | 'barber'
  | 'pharmacy'
  | 'hardware'
  | 'newsstand'
  | 'sodaFountain'
  | 'supermarket'
  | 'hairdresser'
  | 'applianceShowroom'
  | 'recordStore'
  | 'arcade'
  | 'videoRental'
  | 'electronics'
  | 'boutique'
  | 'pizzeria'
  | 'coffeeChain'
  | 'internetCafe'
  | 'mobileShop'
  | 'bankBranch'
  | 'copyShop'
  | 'supermarketExpress'
  | 'holographicRetail'
  | 'ledShowroom'
  | 'microCafe'
  | 'vrArcade'
  | 'zeroWasteGrocer'
  | 'coworkLounge';

/** The props a window display is dressed with. */
export type ShopDressingKind =
  | 'produceCrates'
  | 'sacks'
  | 'shelving'
  | 'priceCards'
  | 'windowPosters'
  | 'dinerCounter'
  | 'stools'
  | 'menuBoard'
  | 'coffeeUrn'
  | 'pastryCase'
  | 'mirrorWall'
  | 'bench'
  | 'bottles'
  | 'tools'
  | 'newsPile'
  | 'magazineRack'
  | 'mannequins'
  | 'clothingRack'
  | 'boutiqueShelves'
  | 'records'
  | 'recordRacks'
  | 'arcadeCabinets'
  | 'tvWall'
  | 'electronicsWall'
  | 'videoRentalShelf'
  | 'espressoBar'
  | 'cafeTables'
  | 'laptopRows'
  | 'printCounter'
  | 'phoneWall'
  | 'bankCounter'
  | 'hologramPlinths'
  | 'ledShelves'
  | 'vrRigs'
  | 'bikes'
  | 'planters'
  | 'microGreens'
  | 'selfCheckout';

/** Every dressing kind, in the order they are documented. */
export const SHOP_DRESSING_KINDS: readonly ShopDressingKind[] = Object.freeze([
  'produceCrates',
  'sacks',
  'shelving',
  'priceCards',
  'windowPosters',
  'dinerCounter',
  'stools',
  'menuBoard',
  'coffeeUrn',
  'pastryCase',
  'mirrorWall',
  'bench',
  'bottles',
  'tools',
  'newsPile',
  'magazineRack',
  'mannequins',
  'clothingRack',
  'boutiqueShelves',
  'records',
  'recordRacks',
  'arcadeCabinets',
  'tvWall',
  'electronicsWall',
  'videoRentalShelf',
  'espressoBar',
  'cafeTables',
  'laptopRows',
  'printCounter',
  'phoneWall',
  'bankCounter',
  'hologramPlinths',
  'ledShelves',
  'vrRigs',
  'bikes',
  'planters',
  'microGreens',
  'selfCheckout',
]);

/** Awning shapes; one per era mood, several per era. */
export type AwningKind =
  | 'canvasShed'
  | 'scalloped'
  | 'angledMetal'
  | 'stripedFabric'
  | 'flatCanopy'
  | 'retractable'
  | 'ledCanopy'
  | 'none';

/** Geometry + hardware of one awning style. */
export interface AwningStyle {
  readonly kind: AwningKind;
  /** Height of the hanging valance. */
  readonly drop: number;
  /** How far the canopy reaches over the sidewalk. */
  readonly projection: number;
  /** Front-edge droop, in radians. */
  readonly pitch: number;
  /** Scallops along the valance (`0` = straight edge). */
  readonly scallops: number;
  /** Paint the valance with era lettering. */
  readonly valanceText: boolean;
  /** Under-canopy strip lighting. */
  readonly lit: boolean;
}

/** Authored awning styles, keyed by kind. */
export const AWNING_STYLES: Readonly<Record<AwningKind, AwningStyle>> = Object.freeze({
  canvasShed: {
    kind: 'canvasShed',
    drop: 0.24,
    projection: 1.25,
    pitch: 0.22,
    scallops: 0,
    valanceText: true,
    lit: false,
  },
  scalloped: {
    kind: 'scalloped',
    drop: 0.26,
    projection: 1.15,
    pitch: 0.2,
    scallops: 9,
    valanceText: true,
    lit: false,
  },
  angledMetal: {
    kind: 'angledMetal',
    drop: 0.2,
    projection: 1.05,
    pitch: 0.36,
    scallops: 0,
    valanceText: false,
    lit: false,
  },
  stripedFabric: {
    kind: 'stripedFabric',
    drop: 0.28,
    projection: 1.2,
    pitch: 0.2,
    scallops: 0,
    valanceText: true,
    lit: false,
  },
  flatCanopy: {
    kind: 'flatCanopy',
    drop: 0.14,
    projection: 1.3,
    pitch: 0.06,
    scallops: 0,
    valanceText: false,
    lit: true,
  },
  retractable: {
    kind: 'retractable',
    drop: 0.2,
    projection: 1.35,
    pitch: 0.16,
    scallops: 0,
    valanceText: true,
    lit: true,
  },
  ledCanopy: {
    kind: 'ledCanopy',
    drop: 0.12,
    projection: 1.2,
    pitch: 0.04,
    scallops: 0,
    valanceText: false,
    lit: true,
  },
  none: {
    kind: 'none',
    drop: 0,
    projection: 0,
    pitch: 0,
    scallops: 0,
    valanceText: false,
    lit: false,
  },
});

/** Awning style with the per-lot accent fabric resolved. */
export interface ResolvedAwning extends AwningStyle {
  /** Index into the era's accent fabric palette. */
  readonly accentIndex: number;
}

/** Interior lighting technology; drives the backdrop glow and ceiling strips. */
export type InteriorLight = 'incandescent' | 'fluorescent' | 'halogen' | 'led';

/** One authored shop program: what a business is and how it is dressed. */
export interface ShopArchetype {
  readonly id: string;
  readonly kind: ShopKind;
  /** Three era-appropriate trading names, so no two lots repeat one. */
  readonly names: readonly [string, string, string];
  readonly blurb: string;
  readonly sign: SignMedia;
  readonly awning: AwningKind;
  readonly dressing: readonly ShopDressingKind[];
}

function archetype(
  id: string,
  kind: ShopKind,
  names: readonly [string, string, string],
  blurb: string,
  sign: SignMedia,
  awning: AwningKind,
  dressing: readonly ShopDressingKind[],
): ShopArchetype {
  return Object.freeze({
    id,
    kind,
    names: Object.freeze(names),
    blurb,
    sign,
    awning,
    dressing: Object.freeze(dressing),
  });
}

/** The authored shop programs of all five eras: six businesses per year. */
export const SHOP_ARCHETYPES: Readonly<Record<EraId, readonly ShopArchetype[]>> = Object.freeze({
  '1945': Object.freeze([
    archetype(
      '1945-grocer',
      'grocer',
      ['Kowalski & Sons Grocers', 'Bellweather Provisions', 'Marchmont Ration Store'],
      'Hand-painted serif lettering over stacked produce crates, meal sacks and a ration-book notice pasted to the glass.',
      'painted',
      'canvasShed',
      ['produceCrates', 'sacks', 'shelving', 'priceCards', 'windowPosters'],
    ),
    archetype(
      '1945-diner',
      'diner',
      ['The Blue Plate Diner', "Doyle's Lunch Counter", 'Star Lunch Room'],
      'Gilded enamel fascia, scalloped awning and a lunch counter with stools, urn and chalked menu.',
      'enamel',
      'scalloped',
      ['dinerCounter', 'stools', 'menuBoard', 'coffeeUrn', 'pastryCase'],
    ),
    archetype(
      '1945-barber',
      'barber',
      ['Hollis Barbers', 'Vale Street Barber', 'The Gents Room'],
      'A gilded blade sign, a mirror wall and a bench of waiting customers under a bare bulb.',
      'enamel',
      'canvasShed',
      ['mirrorWall', 'bench', 'bottles', 'windowPosters'],
    ),
    archetype(
      '1945-pharmacy',
      'pharmacy',
      ['Ward & Daughters Chemist', 'Marlowe Dispensary', 'City Chemist'],
      'Enamel panels, apothecary bottles in neat rows and hand-lettered price cards.',
      'enamel',
      'canvasShed',
      ['bottles', 'shelving', 'priceCards', 'windowPosters'],
    ),
    archetype(
      '1945-hardware',
      'hardware',
      ['Trent & Sons Hardware', 'Bexley Ironmongers', 'The Tool Depot'],
      'Paint worn by a generation of hands, with tool boards, sack piles and paint tins behind the glass.',
      'painted',
      'canvasShed',
      ['tools', 'shelving', 'sacks', 'priceCards'],
    ),
    archetype(
      '1945-newsstand',
      'newsstand',
      ['Corner News Bureau', 'Fleet Street Kiosk', 'The Paper Halt'],
      'Newsprint posters pasted onto a timber hoarding, paper piles and a rotunda of magazines.',
      'paper',
      'none',
      ['newsPile', 'magazineRack', 'windowPosters', 'priceCards'],
    ),
  ]),
  '1965': Object.freeze([
    archetype(
      '1965-diner',
      'diner',
      ['The Rocket Diner', 'Cape Canaveral Grill', 'The Neon Spoon'],
      'Exposed neon tubes bent over a stainless fascia, vinyl stools and a backlit menu board.',
      'neon',
      'angledMetal',
      ['dinerCounter', 'stools', 'menuBoard', 'coffeeUrn', 'pastryCase'],
    ),
    archetype(
      '1965-soda-fountain',
      'sodaFountain',
      ['Fizz & Fountains', 'The Soda Bar', 'Marble Fountain Co.'],
      'Formica and chrome, fountain spigots, chrome stools and a pastel backlit lightbox.',
      'neon',
      'scalloped',
      ['dinerCounter', 'stools', 'coffeeUrn', 'pastryCase', 'menuBoard'],
    ),
    archetype(
      '1965-supermarket',
      'supermarket',
      ['Piggly Fresh Mart', 'Sunbeam Supermarket', 'The Big Basket'],
      'Aisle shelving seen through plate glass, pyramid produce and price cards with gas-blue flashes.',
      'backlit',
      'flatCanopy',
      ['shelving', 'produceCrates', 'priceCards', 'bottles'],
    ),
    archetype(
      '1965-hairdresser',
      'hairdresser',
      ['Bouffant Salon', 'Teen Scene Hair', 'The Beehive Salon'],
      'Neon swan sign, a mirror wall and vinyl chairs under cool fluorescent tubes.',
      'neon',
      'scalloped',
      ['mirrorWall', 'bench', 'bottles', 'windowPosters'],
    ),
    archetype(
      '1965-appliance',
      'applianceShowroom',
      ['Chrome Home Appliances', 'Atomic Appliance Co.', 'Wonder White Goods'],
      'A wall of glowing television sets and gleaming appliances on a raised showroom plinth.',
      'backlit',
      'flatCanopy',
      ['tvWall', 'electronicsWall', 'priceCards'],
    ),
    archetype(
      '1965-pharmacy',
      'pharmacy',
      ["Reed's Corner Drugs", 'Blue Cross Pharmacy', 'The Family Chemist'],
      'Uniform backlit fascia, a soda fountain counter at the back and sun-faded sundries in the window.',
      'backlit',
      'flatCanopy',
      ['bottles', 'shelving', 'priceCards', 'windowPosters'],
    ),
  ]),
  '1985': Object.freeze([
    archetype(
      '1985-record-store',
      'recordStore',
      ['Vinyl Vortex', 'Neon Groove Records', 'The Platter Rack'],
      'Neon tubes over a hand-painted name, record bins and racks of sleeves plastered with tour posters.',
      'neon',
      'stripedFabric',
      ['records', 'recordRacks', 'windowPosters'],
    ),
    archetype(
      '1985-arcade',
      'arcade',
      ['Video Star Arcade', 'Neon Nights Arcade', 'The Coin-Op'],
      'A chasing-bulb marquee, cabinetted hall lit by CRT glow and a bench for the queue.',
      'bulbMarquee',
      'flatCanopy',
      ['arcadeCabinets', 'bench', 'windowPosters'],
    ),
    archetype(
      '1985-video-rental',
      'videoRental',
      ['Video Vault', 'Star Video Rentals', 'The Tape Exchange'],
      'Backlit lightbox fascia, wall-to-wall tape shelves and return-bin graphics in lurid magenta.',
      'backlit',
      'flatCanopy',
      ['videoRentalShelf', 'windowPosters', 'priceCards'],
    ),
    archetype(
      '1985-electronics',
      'electronics',
      ['Megabyte Electronics', 'Stereo City', 'FutureTech Hi-Fi'],
      'A wall of flickering televisions, boxed stereos and a marquee of chasing bulbs.',
      'bulbMarquee',
      'flatCanopy',
      ['tvWall', 'electronicsWall', 'priceCards'],
    ),
    archetype(
      '1985-boutique',
      'boutique',
      ['Aerobics Boutique', 'Synth & Silk', 'The Power Suit'],
      'Neon boutique lettering with shoulder-padded mannequins and a chrome clothing rail.',
      'neon',
      'stripedFabric',
      ['mannequins', 'clothingRack', 'boutiqueShelves'],
    ),
    archetype(
      '1985-pizzeria',
      'pizzeria',
      ['Neon Slice Pizzeria', 'Vesuvio Pizzeria', 'The Slice Rack'],
      'A magenta neon slice sign, an open counter and a hand-lettered specials board.',
      'neon',
      'stripedFabric',
      ['dinerCounter', 'stools', 'menuBoard', 'pastryCase'],
    ),
  ]),
  '2005': Object.freeze([
    archetype(
      '2005-coffee-chain',
      'coffeeChain',
      ['Coromandel Coffee House', 'Bean & Co.', 'Northgate Coffee'],
      'Uniform backlit box fascia, an espresso bar with pastry case and round tables ringed by laptops.',
      'backlit',
      'retractable',
      ['espressoBar', 'cafeTables', 'menuBoard', 'pastryCase'],
    ),
    archetype(
      '2005-internet-cafe',
      'internetCafe',
      ['Pixel Point Internet Cafe', 'Cyber Junction', 'The 24H Net Lounge'],
      'Row upon row of glowing screens behind the glass, with a printed price board and video wall.',
      'video',
      'retractable',
      ['laptopRows', 'cafeTables', 'menuBoard'],
    ),
    archetype(
      '2005-mobile-shop',
      'mobileShop',
      ['Orange Mobile Direct', 'CellPoint', 'Talk & Text Telecom'],
      'A wall of shrink-wrapped handsets, print price cards and a corporate backlit fascia.',
      'backlit',
      'retractable',
      ['phoneWall', 'electronicsWall', 'priceCards'],
    ),
    archetype(
      '2005-bank-branch',
      'bankBranch',
      ['Meridian Bank Branch', 'Kingsway Savings', 'Union Trust Bank'],
      'Corporate lightbox signage, a teller counter behind laminated glass and a queue rail.',
      'backlit',
      'flatCanopy',
      ['bankCounter', 'bench', 'windowPosters'],
    ),
    archetype(
      '2005-copy-shop',
      'copyShop',
      ['SnapPrint Copy Shop', 'CopyCorner', 'The Print Room'],
      'Printed price boards, a laminator counter and reams of paper stacked in the window.',
      'print',
      'flatCanopy',
      ['printCounter', 'shelving', 'priceCards'],
    ),
    archetype(
      '2005-supermarket-express',
      'supermarketExpress',
      ['ExpressMart Metro', 'City Fresh 24', 'QuickSave Local'],
      'Backlit supermarket fascia, refrigerated shelving and a bank of self-service checkouts.',
      'backlit',
      'flatCanopy',
      ['shelving', 'produceCrates', 'priceCards', 'selfCheckout'],
    ),
  ]),
  '2025': Object.freeze([
    archetype(
      '2025-holographic-retail',
      'holographicRetail',
      ['Holoshop', 'Aether Retail Lab', 'Prism & Pixel'],
      'Holographic plinths projecting goods in mid-air behind frameless glass, LED shelves underneath.',
      'hologram',
      'ledCanopy',
      ['hologramPlinths', 'ledShelves', 'boutiqueShelves'],
    ),
    archetype(
      '2025-led-showroom',
      'ledShowroom',
      ['Lumen LED Showroom', 'Brightworks', 'Nova Display Co.'],
      'A full-height LED wall streaming colour across the interior and a lit product shelf.',
      'led',
      'ledCanopy',
      ['ledShelves', 'tvWall', 'electronicsWall', 'priceCards'],
    ),
    archetype(
      '2025-micro-cafe',
      'microCafe',
      ['Slate Micro Cafe', 'Filter & Fern', 'Kettle Lane Coffee'],
      'Warm timber, a programmed LED fascia, espresso bar and planters spilling over the sill.',
      'led',
      'ledCanopy',
      ['espressoBar', 'cafeTables', 'planters', 'menuBoard'],
    ),
    archetype(
      '2025-vr-arcade',
      'vrArcade',
      ['Haptic VR Arena', 'Neon Drift VR', 'Immersion Rooms'],
      'VR pods under a shimmering LED canopy, with holographic attract loops and a queue bench.',
      'led',
      'ledCanopy',
      ['vrRigs', 'bench', 'hologramPlinths'],
    ),
    archetype(
      '2025-zero-waste-grocer',
      'zeroWasteGrocer',
      ['Loop Refill Grocer', 'The Zero Waste Larder', 'Bulk & Bloom'],
      'Refill hoppers, micro-green trays and cyclists outside a timber-and-LED shopfront.',
      'led',
      'ledCanopy',
      ['produceCrates', 'microGreens', 'ledShelves', 'priceCards', 'planters', 'bikes'],
    ),
    archetype(
      '2025-cowork-lounge',
      'coworkLounge',
      ['Deskhouse Cowork', 'The Quiet Floor', 'Signal Workspaces'],
      'Programmed LED signage, a lounge of laptops and a planted divider screening the desks.',
      'led',
      'ledCanopy',
      ['laptopRows', 'cafeTables', 'planters', 'selfCheckout'],
    ),
  ]),
});

/** Shop programs authored for one era, or the 2025 set for unknown input. */
export function getShopArchetypes(era: EraId | string): readonly ShopArchetype[] {
  const resolved = getEraDescriptor(era).id;
  return SHOP_ARCHETYPES[resolved] ?? SHOP_ARCHETYPES['2025'];
}

/** Looks up one archetype by id across all eras. */
export function shopArchetypeById(id: string): ShopArchetype | null {
  for (const list of Object.values(SHOP_ARCHETYPES)) {
    const found = list.find((entry) => entry.id === id);
    if (found) return found;
  }
  return null;
}

/* ------------------------------------------------------------------------- *
 * Advertising media per era (shared with the advertisement factory)
 * ------------------------------------------------------------------------- */

/** Which media each era's shopfront advertising is delivered with. */
export interface EraShopMedia {
  /** Projecting blade sign on the fascia. */
  readonly blade: SignMedia;
  /** Letterboard / transom strip above the glazing. */
  readonly transom: SignMedia;
  /** Freestanding media on the sidewalk, or `null` for none. */
  readonly kerb: SignMedia | null;
  /** Screens used for window dressing (CRT walls, video loop, holograms). */
  readonly dressingScreen: SignMedia | null;
  readonly interiorLight: InteriorLight;
}

/** Authored advertising technology per era. */
export const ERA_SHOP_MEDIA: Readonly<Record<EraId, EraShopMedia>> = Object.freeze({
  '1945': {
    blade: 'painted',
    transom: 'paper',
    kerb: 'paper',
    dressingScreen: null,
    interiorLight: 'incandescent',
  },
  '1965': {
    blade: 'neon',
    transom: 'backlit',
    kerb: 'backlit',
    dressingScreen: 'backlit',
    interiorLight: 'fluorescent',
  },
  '1985': {
    blade: 'bulbMarquee',
    transom: 'backlit',
    kerb: 'backlit',
    dressingScreen: 'video',
    interiorLight: 'halogen',
  },
  '2005': {
    blade: 'backlit',
    transom: 'print',
    kerb: 'video',
    dressingScreen: 'video',
    interiorLight: 'fluorescent',
  },
  '2025': {
    blade: 'hologram',
    transom: 'led',
    kerb: 'led',
    dressingScreen: 'led',
    interiorLight: 'led',
  },
});

/** The media an era's advertising uses, or the 2025 set for unknown input. */
export function eraShopMedia(era: EraId | string): EraShopMedia {
  const resolved = getEraDescriptor(era).id;
  return ERA_SHOP_MEDIA[resolved] ?? ERA_SHOP_MEDIA['2025'];
}

/* ------------------------------------------------------------------------- *
 * Plans
 * ------------------------------------------------------------------------- */

/** Everything the storefront band of one lot shows in one year. */
export interface ShopfrontPlan {
  readonly lotId: string;
  readonly side: StorefrontLot['side'];
  readonly era: EraId;
  readonly frontWidth: number;
  readonly bandHeight: number;
  readonly archetype: ShopArchetype;
  readonly shopKind: ShopKind;
  readonly shopName: string;
  readonly blurb: string;
  readonly signMedia: SignMedia;
  readonly signPalette: SignPalette;
  readonly fasciaLines: readonly SignTextBlock[];
  readonly awning: ResolvedAwning;
  readonly dressing: readonly ShopDressingKind[];
  /** Colour of the interior glow, as a CSS hex string. */
  readonly glowColor: string;
  readonly accentColor: string;
  readonly interiorLight: InteriorLight;
  /** Blade / transom / kerb media this lot carries. */
  readonly bladeMedia: SignMedia;
  readonly transomMedia: SignMedia;
  readonly kerbMedia: SignMedia | null;
  /** Display bay geometry. */
  readonly displayCenterX: number;
  readonly displayWidth: number;
  readonly displayDepth: number;
  readonly doorCenterX: number;
  readonly doorWidth: number;
  readonly bayCount: number;
  /** Every media class visible on this lot, for media-profile accounting. */
  readonly mediaProfile: readonly SignMedia[];
}

function hexFromNumber(value: number): string {
  return `#${(value >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
}

/**
 * `true` when a lot carries freestanding sidewalk media: landmark corners and
 * every third lot, which is what puts a billboard in view from any approach.
 */
export function lotCarriesKerbMedia(lot: StorefrontLot): boolean {
  return lot.landmark === true || lot.index % 3 === 0;
}

function accentAt(era: EraId, index: number): string {
  const accents = getEraDescriptor(era).palette.accents;
  const safe = accents.length > 0 ? accents : [0x8a7a4a];
  return hexFromNumber(safe[((index % safe.length) + safe.length) % safe.length] as number);
}

/**
 * Plans one lot's shopfront for one era.
 *
 * Deterministic for a given `(lot, era, random)` triple: the archetype is picked
 * by lot index (so a side always shows six different businesses), the trading
 * name by how many times that archetype has appeared, and everything else — bay
 * depth, awning accent, dressing trim — comes from the lot+era sub-stream.
 */
export function planShopfront(
  lot: StorefrontLot,
  era: EraId,
  random: RandomSource,
): ShopfrontPlan {
  const resolvedEra = assertEraId(era);
  const archetypes = getShopArchetypes(resolvedEra);
  const stream = random.fork(`${lot.id}:storefront:${resolvedEra}`);
  const descriptor = getEraDescriptor(resolvedEra);
  const media = eraShopMedia(resolvedEra);

  const slot = ((lot.index % archetypes.length) + archetypes.length) % archetypes.length;
  const shop = archetypes[slot] as ShopArchetype;
  const useIndex = Math.min(shop.names.length - 1, Math.floor(Math.max(0, lot.index) / archetypes.length));
  const shopName = shop.names[useIndex] as string;

  const accentIndex = stream.int(0, MAX_STOREFRONT_ACCENTS_PER_ERA - 1);
  const accentColor = accentAt(resolvedEra, accentIndex + lot.index);
  const awningStyle = AWNING_STYLES[shop.awning] ?? AWNING_STYLES.none;
  const awning: ResolvedAwning = Object.freeze({ ...awningStyle, accentIndex });

  const frontWidth = lot.frontWidth;
  const doorWidth = STOREFRONT_METRICS.doorWidth;
  const doorOnLeft = stream.bool();
  const frame = STOREFRONT_METRICS.pilasterWidth;
  const margin = STOREFRONT_METRICS.doorMargin;
  const bayWidth = Math.max(
    2.4,
    frontWidth - frame * 2 - doorWidth - margin * 2 - 0.2,
  );
  const doorCenterX = doorOnLeft
    ? -frontWidth / 2 + frame + margin + doorWidth / 2
    : frontWidth / 2 - frame - margin - doorWidth / 2;
  const displayCenterX = doorOnLeft
    ? doorCenterX + doorWidth / 2 + margin + bayWidth / 2
    : doorCenterX - doorWidth / 2 - margin - bayWidth / 2;

  const displayDepth =
    resolvedEra === '1985'
      ? stream.float(0.58, 0.68)
      : resolvedEra === '2005'
        ? stream.float(0.5, 0.58)
        : resolvedEra === '2025'
          ? stream.float(0.36, 0.46)
          : stream.float(0.46, 0.56);

  const bayCount = Math.max(2, Math.round(bayWidth / 2.6));
  const glowColor = hexFromNumber(descriptor.palette.emissive);
  const kerb = media.kerb !== null && lotCarriesKerbMedia(lot) ? media.kerb : null;

  const fasciaLines: readonly SignTextBlock[] = Object.freeze([
    Object.freeze({ text: shopName, role: 'title' as const }),
    Object.freeze({ text: descriptor.signage.style, role: 'subtitle' as const, scale: 0.12 }),
  ]);

  const profile = new Set<SignMedia>([shop.sign, media.blade, media.transom]);
  if (kerb) profile.add(kerb);
  if (media.dressingScreen) profile.add(media.dressingScreen);

  return Object.freeze({
    lotId: lot.id,
    side: lot.side,
    era: resolvedEra,
    frontWidth,
    bandHeight: STOREFRONT_BAND_HEIGHT,
    archetype: shop,
    shopKind: shop.kind,
    shopName,
    blurb: shop.blurb,
    signMedia: shop.sign,
    signPalette: Object.freeze({
      board: accentAt(resolvedEra, accentIndex),
      ink: hexFromNumber(descriptor.palette.emissive),
      glow: hexFromNumber(descriptor.palette.emissive),
      trim: hexFromNumber(descriptor.palette.buildingSecondary),
    }),
    fasciaLines,
    awning,
    dressing: shop.dressing,
    glowColor,
    accentColor,
    interiorLight: media.interiorLight,
    bladeMedia: media.blade,
    transomMedia: media.transom,
    kerbMedia: kerb,
    displayCenterX,
    displayWidth: bayWidth,
    displayDepth,
    doorCenterX,
    doorWidth,
    bayCount,
    mediaProfile: Object.freeze([...profile]),
  });
}

/** Plans every lot of a ring for one era. */
export function planShopfronts(
  lots: readonly StorefrontLot[],
  era: EraId,
  random: RandomSource,
): readonly ShopfrontPlan[] {
  return Object.freeze(lots.map((lot) => planShopfront(lot, era, random)));
}

/* ------------------------------------------------------------------------- *
 * Materials
 * ------------------------------------------------------------------------- */

/** Library material roles a shopfront draws with. */
export type StorefrontMaterialKey =
  | 'structure'
  | 'plinth'
  | 'trim'
  | 'metal'
  | 'glass'
  | 'interior'
  | 'goods'
  | 'paper'
  | 'emissive';

/** Every material role, in the order they are documented. */
export const STOREFRONT_MATERIAL_KEYS: readonly StorefrontMaterialKey[] = Object.freeze([
  'structure',
  'plinth',
  'trim',
  'metal',
  'glass',
  'interior',
  'goods',
  'paper',
  'emissive',
]);

/** The materials one era's shopfronts draw with, shared across every lot. */
export interface StorefrontMaterialSet {
  readonly era: EraId;
  /** `MaterialLibrary` cache keys this set resolved. */
  readonly keys: readonly string[];
  readonly list: readonly THREE.MeshStandardMaterial[];
  get(key: StorefrontMaterialKey): THREE.MeshStandardMaterial;
  has(key: StorefrontMaterialKey): boolean;
  /** Accent fabric for a lot (`0`–`2`). */
  accent(index: number): THREE.MeshStandardMaterial;
}

interface EraShopfrontRecipe {
  readonly structure: 'brick' | 'stone' | 'stucco' | 'corrugatedMetal' | 'glassCurtainWall';
  readonly plinth: 'stone' | 'cobble' | 'stucco';
  readonly interior: 'brick' | 'stucco' | 'stone';
  readonly roughness: number;
  readonly metalness: number;
}

const ERA_SHOPFRONT_RECIPES: Readonly<Record<EraId, EraShopfrontRecipe>> = Object.freeze({
  '1945': { structure: 'stucco', plinth: 'stone', interior: 'brick', roughness: 0.86, metalness: 0.03 },
  '1965': { structure: 'stucco', plinth: 'stone', interior: 'stucco', roughness: 0.42, metalness: 0.24 },
  '1985': { structure: 'corrugatedMetal', plinth: 'stone', interior: 'stucco', roughness: 0.5, metalness: 0.3 },
  '2005': { structure: 'corrugatedMetal', plinth: 'stone', interior: 'stucco', roughness: 0.36, metalness: 0.45 },
  '2025': { structure: 'corrugatedMetal', plinth: 'stone', interior: 'stucco', roughness: 0.3, metalness: 0.2 },
});

/**
 * Builds (and caches) one era's shopfront material set through the shared
 * `MaterialLibrary`. Accent fabrics are resolved per accent slot, which is what
 * gives each lot its own awning colour without multiplying materials per lot.
 */
export function createShopfrontMaterials(
  library: MaterialLibrary,
  era: EraId,
): StorefrontMaterialSet {
  const resolvedEra = assertEraId(era);
  const recipe = ERA_SHOPFRONT_RECIPES[resolvedEra] ?? ERA_SHOPFRONT_RECIPES['2025'];
  const palette = getEraDescriptor(resolvedEra).palette;
  const primary = hexFromNumber(palette.buildingPrimary);
  const secondary = hexFromNumber(palette.buildingSecondary);
  const emissive = hexFromNumber(palette.emissive);
  const sidewalk = hexFromNumber(palette.sidewalk);
  const ground = hexFromNumber(palette.ground);

  const materials = new Map<StorefrontMaterialKey, THREE.MeshStandardMaterial>();
  const accents: THREE.MeshStandardMaterial[] = [];

  const structure = library.get({
    surface: recipe.structure,
    palette: { base: primary, accent: secondary, emissive },
    roughness: recipe.roughness,
    metalness: recipe.metalness,
    wear: resolvedEra === '1945' ? 0.7 : 0.25,
    repeat: [3, 2],
    name: `storefront-structure-${resolvedEra}`,
  });
  materials.set('structure', structure);

  materials.set(
    'plinth',
    library.get({
      surface: recipe.plinth,
      palette: { base: sidewalk, accent: primary },
      roughness: 0.9,
      metalness: 0.02,
      wear: 0.5,
      repeat: [4, 1],
      name: `storefront-plinth-${resolvedEra}`,
    }),
  );
  materials.set(
    'trim',
    library.get({
      surface: 'corrugatedMetal',
      palette: { base: secondary, accent: emissive, emissive },
      roughness: 0.5,
      metalness: 0.45,
      wear: 0.35,
      repeat: [2, 1],
      name: `storefront-trim-${resolvedEra}`,
    }),
  );
  materials.set(
    'metal',
    library.get({
      surface: 'corrugatedMetal',
      palette: { base: '#b9bec4', accent: '#6d7378', emissive },
      roughness: 0.35,
      metalness: 0.8,
      wear: 0.25,
      repeat: [1, 1],
      name: `storefront-metal-${resolvedEra}`,
    }),
  );
  materials.set(
    'glass',
    library.get({
      surface: 'glassCurtainWall',
      palette: { base: '#7fa8b8', accent: emissive, emissive },
      roughness: 0.1,
      metalness: 0.3,
      emissive: 0.35,
      wear: 0.1,
      repeat: [2, 1],
      opacity: 0.42,
      transparent: true,
      side: THREE.DoubleSide,
      name: `storefront-glass-${resolvedEra}`,
    }),
  );
  materials.set(
    'interior',
    library.get({
      surface: recipe.interior,
      palette: { base: ground, accent: secondary, emissive },
      roughness: 0.95,
      metalness: 0,
      emissive: 0.12,
      wear: 0.6,
      repeat: [2, 2],
      name: `storefront-interior-${resolvedEra}`,
    }),
  );
  materials.set(
    'goods',
    library.get({
      surface: 'stucco',
      palette: { base: '#b08a5a', accent: '#7c5a34' },
      roughness: 0.88,
      metalness: 0,
      wear: 0.45,
      repeat: [1, 1],
      name: `storefront-goods-${resolvedEra}`,
    }),
  );
  materials.set(
    'paper',
    library.get({
      surface: 'paintedSign',
      palette: { base: '#e8e2d2', accent: '#8d3a2c' },
      roughness: 0.92,
      metalness: 0,
      wear: 0.35,
      repeat: [1, 1],
      name: `storefront-paper-${resolvedEra}`,
    }),
  );
  materials.set(
    'emissive',
    library.get({
      surface: 'neon',
      palette: { base: emissive, accent: emissive, emissive },
      roughness: 0.4,
      metalness: 0.1,
      emissive: 1.4,
      wear: 0.15,
      repeat: [1, 1],
      name: `storefront-emissive-${resolvedEra}`,
    }),
  );

  for (let index = 0; index < MAX_STOREFRONT_ACCENTS_PER_ERA; index += 1) {
    accents.push(
      library.get({
        surface: 'fabric',
        palette: { base: accentAt(resolvedEra, index), accent: '#f2ece0' },
        roughness: 0.95,
        metalness: 0,
        wear: resolvedEra === '1945' ? 0.5 : 0.2,
        repeat: [2, 1],
        name: `storefront-accent-${resolvedEra}-${index}`,
      }),
    );
  }

  const list = Object.freeze([...materials.values(), ...accents]);
  // Remember the crafted opacity: era cross-fades scale it instead of
  // overriding it, so deliberately translucent shop glass stays translucent.
  for (const material of list) {
    material.userData.chronoBaseOpacity = material.opacity;
  }
  const keys = Object.freeze(
    list.map((material) => String(material.userData.chronoKey ?? material.name)),
  );

  return Object.freeze({
    era: resolvedEra,
    keys,
    list,
    get: (key: StorefrontMaterialKey) => {
      const material = materials.get(key);
      if (!material) throw new RangeError(`Unknown storefront material role "${key}".`);
      return material;
    },
    has: (key: StorefrontMaterialKey) => materials.has(key),
    accent: (index: number) =>
      accents[
        ((Math.round(index) % accents.length) + accents.length) % accents.length
      ] as THREE.MeshStandardMaterial,
  });
}

/* ------------------------------------------------------------------------- *
 * Instancing
 * ------------------------------------------------------------------------- */

interface StorefrontBatch {
  readonly geometry: DetailInstanceSpec['geometry'];
  readonly material: THREE.Material;
  readonly specs: DetailInstanceSpec[];
}

/**
 * Collects primitive instances and flushes them into one `InstancedMesh` per
 * `(shape, material)` pair. Mirrors the buildings batcher, but tags every mesh
 * with `chronoStorefrontRole` so the storefront/architecture boundary stays
 * auditable.
 */
export class StorefrontBatcher {
  readonly role: StorefrontRole;

  private readonly parent: THREE.Object3D;
  private readonly geometrySet: DetailGeometrySetType;
  private readonly batches = new Map<string, StorefrontBatch>();
  private readonly meshes: THREE.InstancedMesh[] = [];
  private flushed = 0;

  constructor(parent: THREE.Object3D, geometrySet: DetailGeometrySetType, role: StorefrontRole) {
    this.parent = parent;
    this.geometrySet = geometrySet;
    this.role = role;
  }

  /** Queues one primitive instance. */
  add(spec: DetailInstanceSpec): void {
    const key = `${spec.geometry}|${spec.material.uuid}`;
    const existing = this.batches.get(key);
    if (existing) {
      existing.specs.push(spec);
      return;
    }
    this.batches.set(key, { geometry: spec.geometry, material: spec.material, specs: [spec] });
  }

  /** Queues a box of `width × height × depth` centred on `(x, y, z)`. */
  box(
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    rotation?: DetailRotation,
  ): void {
    this.add({
      geometry: 'box',
      material,
      position: [x, y, z],
      scale: [Math.max(0.01, width), Math.max(0.01, height), Math.max(0.01, depth)],
      yaw: rotation?.yaw,
      pitch: rotation?.pitch,
      roll: rotation?.roll,
    });
  }

  /** Queues a cylinder of `diameter × height` centred on `(x, y, z)`. */
  cylinder(
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    diameter: number,
    height: number,
    rotation?: DetailRotation,
  ): void {
    this.add({
      geometry: 'cylinder',
      material,
      position: [x, y, z],
      scale: [Math.max(0.01, diameter), Math.max(0.01, height), Math.max(0.01, diameter)],
      yaw: rotation?.yaw,
      pitch: rotation?.pitch,
      roll: rotation?.roll,
    });
  }

  /** Queues a cone of `diameter × height` centred on `(x, y, z)`. */
  cone(
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    diameter: number,
    height: number,
    rotation?: DetailRotation,
  ): void {
    this.add({
      geometry: 'cone',
      material,
      position: [x, y, z],
      scale: [Math.max(0.01, diameter), Math.max(0.01, height), Math.max(0.01, diameter)],
      yaw: rotation?.yaw,
      pitch: rotation?.pitch,
      roll: rotation?.roll,
    });
  }

  /** Queues a sphere of `diameter` centred on `(x, y, z)`. */
  sphere(material: THREE.Material, x: number, y: number, z: number, diameter: number): void {
    this.add({
      geometry: 'sphere',
      material,
      position: [x, y, z],
      scale: [diameter, diameter, diameter],
    });
  }

  /** Instances waiting to be flushed. */
  get queuedCount(): number {
    let queued = 0;
    for (const batch of this.batches.values()) queued += batch.specs.length;
    return queued;
  }

  /** Instances already handed to the GPU. */
  get instanceCount(): number {
    return this.flushed;
  }

  /** Flushed instanced meshes, newest last. */
  get flushedMeshes(): readonly THREE.InstancedMesh[] {
    return this.meshes;
  }

  /** Creates one instanced mesh per queued `(shape, material)` pair. */
  flush(): number {
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    let flushed = 0;

    for (const batch of this.batches.values()) {
      if (batch.specs.length === 0) continue;
      const mesh = new THREE.InstancedMesh(
        this.geometrySet.get(batch.geometry),
        batch.material,
        batch.specs.length,
      );
      batch.specs.forEach((spec, index) => {
        euler.set(spec.pitch ?? 0, spec.yaw ?? 0, spec.roll ?? 0, 'YXZ');
        quaternion.setFromEuler(euler);
        position.set(spec.position[0], spec.position[1], spec.position[2]);
        scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = `${this.parent.name}:${this.role}:${batch.geometry}`;
      mesh.userData.chronoStorefrontRole = this.role;
      mesh.userData.chronoStorefrontShape = batch.geometry;
      mesh.castShadow = this.role === 'awning' || this.role === 'billboard';
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      this.parent.add(mesh);
      this.meshes.push(mesh);
      flushed += batch.specs.length;
    }

    this.batches.clear();
    this.flushed += flushed;
    return flushed;
  }
}

/* ------------------------------------------------------------------------- *
 * Feature counts
 * ------------------------------------------------------------------------- */

/** What one shopfront variant drew, element by element. */
export interface ShopfrontFeatureCounts {
  pilasters: number;
  plinths: number;
  stallRisers: number;
  fasciaBoards: number;
  cornices: number;
  transoms: number;
  brackets: number;
  mullions: number;
  glassPanes: number;
  doors: number;
  doorSteps: number;
  backdrops: number;
  interiorLamps: number;
  dressingItems: number;
  dressingKinds: number;
  awnings: number;
  awningValances: number;
  awningSupports: number;
  awningScallops: number;
  signageFaces: number;
  decals: number;
  /** Instances per dressing kind, so window dressing is auditable per era. */
  dressingByKind: Partial<Record<ShopDressingKind, number>>;
}

/** A zeroed feature count record. */
export function createShopfrontFeatureCounts(): ShopfrontFeatureCounts {
  return {
    pilasters: 0,
    plinths: 0,
    stallRisers: 0,
    fasciaBoards: 0,
    cornices: 0,
    transoms: 0,
    brackets: 0,
    mullions: 0,
    glassPanes: 0,
    doors: 0,
    doorSteps: 0,
    backdrops: 0,
    interiorLamps: 0,
    dressingItems: 0,
    dressingKinds: 0,
    awnings: 0,
    awningValances: 0,
    awningSupports: 0,
    awningScallops: 0,
    signageFaces: 0,
    decals: 0,
    dressingByKind: {},
  };
}

/** Adds `source` into `target` (dressing-kind maps merged too). */
export function addShopfrontFeatureCounts(
  target: ShopfrontFeatureCounts,
  source: ShopfrontFeatureCounts,
): ShopfrontFeatureCounts {
  const kinds = new Set<ShopDressingKind>([
    ...(Object.keys(target.dressingByKind) as ShopDressingKind[]),
    ...(Object.keys(source.dressingByKind) as ShopDressingKind[]),
  ]);
  for (const key of kinds) {
    target.dressingByKind[key] =
      (target.dressingByKind[key] ?? 0) + (source.dressingByKind[key] ?? 0);
  }
  target.pilasters += source.pilasters;
  target.plinths += source.plinths;
  target.stallRisers += source.stallRisers;
  target.fasciaBoards += source.fasciaBoards;
  target.cornices += source.cornices;
  target.transoms += source.transoms;
  target.brackets += source.brackets;
  target.mullions += source.mullions;
  target.glassPanes += source.glassPanes;
  target.doors += source.doors;
  target.doorSteps += source.doorSteps;
  target.backdrops += source.backdrops;
  target.interiorLamps += source.interiorLamps;
  target.dressingItems += source.dressingItems;
  target.dressingKinds += source.dressingKinds;
  target.awnings += source.awnings;
  target.awningValances += source.awningValances;
  target.awningSupports += source.awningSupports;
  target.awningScallops += source.awningScallops;
  target.signageFaces += source.signageFaces;
  target.decals += source.decals;
  return target;
}

/* ------------------------------------------------------------------------- *
 * Builders
 * ------------------------------------------------------------------------- */

interface DressingContext {
  readonly batcher: StorefrontBatcher;
  readonly materials: StorefrontMaterialSet;
  readonly plan: ShopfrontPlan;
  readonly random: RandomSource;
  readonly counts: ShopfrontFeatureCounts;
  /** Shared static decal sheet (menus, price cards, pasted posters). */
  readonly decalMaterial: THREE.Material | null;
  /** Shared landscape sheet for chalkboards, bill boards and rack posters. */
  readonly menuMaterial: THREE.Material | null;
  /** Shared animated dressing screen for this era, when it has one. */
  readonly screenMaterial: THREE.Material | null;
  /** Local x of the display bay's centre. */
  readonly centerX: number;
  /** Clear width of the display bay. */
  readonly width: number;
  /** Usable depth of the bay (backdrop to just behind the glass). */
  readonly depth: number;
  readonly backdropZ: number;
  readonly floorY: number;
  readonly headY: number;
  readonly signFaces: SignMaterialHandle[];
}

function bump(ctx: DressingContext, kind: ShopDressingKind, count: number): void {
  if (count <= 0) return;
  ctx.counts.dressingByKind[kind] = (ctx.counts.dressingByKind[kind] ?? 0) + count;
  ctx.counts.dressingItems += count;
}

function goodsColor(ctx: DressingContext, index: number): THREE.Material {
  return index % 3 === 0 ? ctx.materials.accent(ctx.plan.awning.accentIndex) : ctx.materials.get('goods');
}

/** Slatted timber crates stacked with produce — grocers and markets. */
function dressProduceCrates(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY, random } = ctx;
  const columns = Math.max(2, Math.round(width / 1.5));
  let placed = 0;
  for (let column = 0; column < columns; column += 1) {
    const u = centerX - width / 2 + (width * (column + 0.5)) / columns;
    const stack = random.int(1, 3);
    for (let level = 0; level < stack; level += 1) {
      const size = 0.62 - level * 0.05;
      const y = floorY + 0.14 + level * 0.34;
      const z = ctx.backdropZ + depth * random.float(0.3, 0.62);
      batcher.box(ctx.materials.get('goods'), u, y, z, size, 0.3, size * 0.8);
      batcher.box(ctx.materials.get('metal'), u, y + 0.16, z, size * 1.04, 0.05, size * 0.84);
      placed += 2;
      const produce = random.int(2, 4);
      for (let fruit = 0; fruit < produce; fruit += 1) {
        batcher.sphere(
          goodsColor(ctx, column + fruit),
          u + random.float(-0.2, 0.2),
          y + 0.26,
          z + random.float(-0.14, 0.14),
          random.float(0.12, 0.2),
        );
        placed += 1;
      }
    }
  }
  bump(ctx, 'produceCrates', placed);
}

/** Meal sacks leaning against the display wall. */
function dressSacks(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY, random } = ctx;
  const count = Math.max(2, Math.round(width / 2.2));
  for (let index = 0; index < count; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / count;
    const y = floorY + 0.34;
    batcher.box(
      ctx.materials.get('paper'),
      u,
      y,
      ctx.backdropZ + depth * 0.42,
      0.44,
      0.68,
      0.34,
      { roll: random.float(-0.06, 0.06) },
    );
    batcher.cone(ctx.materials.get('paper'), u, y + 0.42, ctx.backdropZ + depth * 0.42, 0.4, 0.16);
  }
  bump(ctx, 'sacks', count * 2);
}

/** Three-shelf gondola with boxed goods. */
function dressShelving(ctx: DressingContext, material?: THREE.Material): void {
  const { batcher, centerX, width, depth, floorY, headY, random } = ctx;
  const shelfMaterial = material ?? ctx.materials.get('metal');
  const bays = Math.max(1, Math.round(width / 2.4));
  let placed = 0;
  for (let bay = 0; bay < bays; bay += 1) {
    const u = centerX - width / 2 + (width * (bay + 0.5)) / bays;
    const bayWidth = (width / bays) * 0.82;
    for (let level = 0; level < 3; level += 1) {
      const y = floorY + 0.35 + level * 0.62;
      batcher.box(shelfMaterial, u, y, ctx.backdropZ + depth * 0.5, bayWidth, 0.06, depth * 0.7);
      placed += 1;
      const goods = Math.max(2, Math.round(bayWidth / 0.42));
      for (let item = 0; item < goods; item += 1) {
        const itemU = u - bayWidth / 2 + (bayWidth * (item + 0.5)) / goods;
        const h = random.float(0.16, 0.32);
        batcher.box(
          goodsColor(ctx, bay + item),
          itemU,
          y + 0.04 + h / 2,
          ctx.backdropZ + depth * random.float(0.45, 0.6),
          bayWidth / goods * 0.72,
          h,
          depth * 0.34,
        );
        placed += 1;
      }
    }
  }
  // Uprights make the gondola read as furniture rather than floating shelves.
  for (const edge of [-1, 1]) {
    batcher.box(
      shelfMaterial,
      centerX + (width / 2 + 0.04) * edge,
      floorY + (headY - floorY) / 2,
      ctx.backdropZ + depth * 0.5,
      0.07,
      headY - floorY,
      depth * 0.72,
    );
    placed += 1;
  }
  bump(ctx, 'shelving', placed);
}

/** Small handwritten price cards on the goods, using the portrait decal sheet. */
function dressPriceCards(ctx: DressingContext, count = 4): void {
  const material = ctx.decalMaterial;
  if (!material) return;
  const { batcher, centerX, width, depth, floorY, random } = ctx;
  for (let index = 0; index < count; index += 1) {
    const u = centerX + random.float(-width / 2 + 0.4, width / 2 - 0.4);
    const y = floorY + random.float(0.5, 1.5);
    // 0.22 × 0.31 matches the decal sheet's portrait aspect, so the writing on
    // the card is never stretched.
    batcher.box(material, u, y, ctx.backdropZ + depth * 0.72, 0.22, 0.31, 0.03, {
      roll: random.float(-0.12, 0.12),
    });
  }
  ctx.counts.decals += count;
  bump(ctx, 'priceCards', count);
}

/** Paper notices pasted onto the inside of the glass. */
function dressWindowPosters(ctx: DressingContext, count = 3): void {
  const material = ctx.decalMaterial;
  if (!material) return;
  const { batcher, centerX, width, depth, floorY, random } = ctx;
  for (let index = 0; index < count; index += 1) {
    const u = centerX + random.float(-width / 2 + 0.5, width / 2 - 0.5);
    const y = floorY + random.float(0.9, 1.7);
    const size = random.float(0.34, 0.5);
    batcher.box(material, u, y, ctx.backdropZ + depth * 0.96, size, size * 1.4, 0.02, {
      roll: random.float(-0.16, 0.16),
    });
  }
  ctx.counts.decals += count;
  bump(ctx, 'windowPosters', count);
}

/** Lunch counter with an urn, cups and a chalked menu behind. */
function dressDinerCounter(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY, random } = ctx;
  const counterWidth = width * 0.78;
  const z = ctx.backdropZ + depth * 0.52;
  batcher.box(ctx.materials.get('structure'), centerX, floorY + 0.5, z, counterWidth, 0.1, depth * 0.6);
  batcher.box(
    ctx.materials.accent(ctx.plan.awning.accentIndex),
    centerX,
    floorY + 0.44,
    z + depth * 0.32,
    counterWidth,
    0.14,
    0.08,
  );
  batcher.box(ctx.materials.get('plinth'), centerX, floorY + 0.22, z, counterWidth * 0.96, 0.4, depth * 0.5);
  // Back bar with glasses and an urn.
  batcher.box(
    ctx.materials.get('interior'),
    centerX,
    floorY + 0.85,
    ctx.backdropZ + 0.08,
    counterWidth * 0.9,
    0.9,
    0.08,
  );
  const stools = Math.max(2, Math.round(counterWidth / 0.9));
  for (let index = 0; index < stools; index += 1) {
    const u = centerX - counterWidth / 2 + (counterWidth * (index + 0.5)) / stools;
    batcher.cylinder(ctx.materials.get('metal'), u, floorY + 0.32, z + depth * 0.34, 0.06, 0.62);
    batcher.cylinder(
      ctx.materials.accent(ctx.plan.awning.accentIndex),
      u,
      floorY + 0.64,
      z + depth * 0.34,
      0.34,
      0.08,
    );
  }
  bump(ctx, 'dinerCounter', 3);
  bump(ctx, 'stools', stools * 2);
  void random;
}

/** Additional stools lined along the shop window. */
function dressStools(ctx: DressingContext, count = 3): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  for (let index = 0; index < count; index += 1) {
    const u = centerX - width / 4 + (width / 2) * ((index + 0.5) / count);
    const z = ctx.backdropZ + depth * 0.82;
    batcher.cylinder(ctx.materials.get('metal'), u, floorY + 0.3, z, 0.05, 0.58);
    batcher.cylinder(
      ctx.materials.accent(ctx.plan.awning.accentIndex),
      u,
      floorY + 0.6,
      z,
      0.32,
      0.07,
    );
  }
  bump(ctx, 'stools', count * 2);
}

/** Chalk / print menu board on the display wall (landscape menu sheet). */
function dressMenuBoard(ctx: DressingContext): void {
  const material = ctx.menuMaterial ?? ctx.decalMaterial ?? ctx.materials.get('paper');
  const { batcher, centerX, width, floorY } = ctx;
  const boardWidth = Math.max(1.0, Math.min(width * 0.6, 1.6));
  batcher.box(material, centerX, floorY + 1.5, ctx.backdropZ + 0.06, boardWidth, boardWidth / 1.6, 0.05);
  batcher.box(
    ctx.materials.get('trim'),
    centerX,
    floorY + 1.92,
    ctx.backdropZ + 0.09,
    boardWidth + 0.06,
    0.06,
    0.07,
  );
  ctx.counts.decals += 1;
  bump(ctx, 'menuBoard', 2);
}

/** Coffee urn and a stack of cups on the counter. */
function dressCoffeeUrn(ctx: DressingContext): void {
  const { batcher, centerX, depth, floorY } = ctx;
  const z = ctx.backdropZ + depth * 0.5;
  batcher.cylinder(ctx.materials.get('metal'), centerX - 0.5, floorY + 0.78, z, 0.34, 0.42);
  batcher.cylinder(ctx.materials.get('metal'), centerX - 0.5, floorY + 0.6, z, 0.1, 0.06);
  for (let index = 0; index < 4; index += 1) {
    batcher.cylinder(
      ctx.materials.get('paper'),
      centerX + 0.25 + (index % 2) * 0.16,
      floorY + 0.6 + Math.floor(index / 2) * 0.08,
      z,
      0.08,
      0.07,
    );
  }
  bump(ctx, 'coffeeUrn', 6);
}

/** Glass pastry case with trays. */
function dressPastryCase(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const z = ctx.backdropZ + depth * 0.62;
  const caseWidth = width * 0.34;
  batcher.box(ctx.materials.accent(ctx.plan.awning.accentIndex), centerX + width * 0.24, floorY + 0.5, z, caseWidth, 0.06, depth * 0.42);
  batcher.box(ctx.materials.get('glass'), centerX + width * 0.24, floorY + 0.72, z, caseWidth, 0.42, depth * 0.42);
  for (let index = 0; index < 3; index += 1) {
    batcher.box(
      ctx.materials.get('goods'),
      centerX + width * 0.24 - caseWidth / 2 + (caseWidth * (index + 0.5)) / 3,
      floorY + 0.56,
      z,
      caseWidth / 3.6,
      0.06,
      depth * 0.3,
    );
  }
  bump(ctx, 'pastryCase', 5);
}

/** Framed mirror wall with a shelf of bottles — barbers, salons. */
function dressMirrorWall(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY, headY } = ctx;
  const mirrorWidth = width * 0.42;
  batcher.box(ctx.materials.get('glass'), centerX, floorY + 1.35, ctx.backdropZ + 0.05, mirrorWidth, headY - floorY - 0.4, 0.04);
  batcher.box(ctx.materials.get('trim'), centerX, floorY + 0.72, ctx.backdropZ + 0.08, mirrorWidth, 0.05, 0.12);
  for (let index = 0; index < 5; index += 1) {
    batcher.cylinder(
      goodsColor(ctx, index),
      centerX - mirrorWidth / 2 + 0.2 + index * 0.22,
      floorY + 0.84,
      ctx.backdropZ + 0.1,
      0.1,
      0.2,
    );
  }
  bump(ctx, 'mirrorWall', 7);
}

/** Bench seating with coat pegs — waiting rooms and arcade queues. */
function dressBench(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  const benchWidth = width * 0.46;
  batcher.box(ctx.materials.get('goods'), centerX, floorY + 0.42, ctx.backdropZ + 0.3, benchWidth, 0.08, 0.42);
  batcher.box(ctx.materials.get('goods'), centerX, floorY + 0.62, ctx.backdropZ + 0.08, benchWidth, 0.34, 0.07);
  for (const edge of [-1, 1]) {
    batcher.box(
      ctx.materials.get('metal'),
      centerX + (benchWidth / 2 - 0.08) * edge,
      floorY + 0.2,
      ctx.backdropZ + 0.3,
      0.08,
      0.4,
      0.4,
    );
  }
  bump(ctx, 'bench', 4);
}

/** Rows of apothecary bottles on two shelves. */
function dressBottles(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const rows = 2;
  const perRow = Math.max(4, Math.round(width / 0.5));
  for (let row = 0; row < rows; row += 1) {
    const y = floorY + 0.72 + row * 0.5;
    batcher.box(ctx.materials.get('metal'), centerX, y, ctx.backdropZ + depth * 0.38, width * 0.8, 0.05, depth * 0.36);
    for (let index = 0; index < perRow; index += 1) {
      const u = centerX - (width * 0.8) / 2 + ((width * 0.8) * (index + 0.5)) / perRow;
      batcher.cylinder(goodsColor(ctx, index), u, y + 0.12, ctx.backdropZ + depth * 0.38, 0.11, 0.22);
    }
  }
  bump(ctx, 'bottles', rows * (perRow + 1));
}

/** Tool board with hanging tools and stacked tins. */
function dressTools(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  batcher.box(ctx.materials.get('interior'), centerX, floorY + 1.4, ctx.backdropZ + 0.06, width * 0.7, 1.1, 0.05);
  const tools = Math.max(4, Math.round(width));
  for (let index = 0; index < tools; index += 1) {
    const u = centerX - (width * 0.66) / 2 + ((width * 0.66) * (index + 0.5)) / tools;
    batcher.box(ctx.materials.get('metal'), u, floorY + 1.4, ctx.backdropZ + 0.12, 0.06, 0.62, 0.06, {
      roll: index % 2 === 0 ? 0.06 : -0.06,
    });
  }
  for (let index = 0; index < 4; index += 1) {
    batcher.cylinder(
      ctx.materials.get('metal'),
      centerX - 0.6 + index * 0.4,
      floorY + 0.3,
      ctx.backdropZ + 0.44,
      0.26,
      0.3,
    );
  }
  bump(ctx, 'tools', tools + 4);
}

/** Stacked newspapers with a bill board — newsstands. */
function dressNewsPile(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  const piles = Math.max(2, Math.round(width / 1.6));
  for (let index = 0; index < piles; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / piles;
    for (let level = 0; level < 4; level += 1) {
      batcher.box(ctx.materials.get('paper'), u, floorY + 0.08 + level * 0.08, ctx.backdropZ + 0.34, 0.44, 0.07, 0.34, {
        yaw: 0.05 * level,
      });
    }
  }
  if (ctx.decalMaterial) {
    batcher.box(
      ctx.menuMaterial ?? ctx.decalMaterial,
      centerX,
      floorY + 1.5,
      ctx.backdropZ + 0.07,
      1.2,
      0.75,
      0.05,
    );
    ctx.counts.decals += 1;
  }
  bump(ctx, 'newsPile', piles * 5);
}

/** Magazines fanned on a slanted rack. */
function dressMagazineRack(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  const rackWidth = width * 0.6;
  batcher.box(ctx.materials.get('metal'), centerX, floorY + 0.9, ctx.backdropZ + 0.34, rackWidth, 1.1, 0.16, {
    pitch: -0.35,
  });
  const magazines = Math.max(4, Math.round(rackWidth / 0.32));
  for (let index = 0; index < magazines; index += 1) {
    const u = centerX - rackWidth / 2 + (rackWidth * (index + 0.5)) / magazines;
    batcher.box(ctx.materials.get('paper'), u, floorY + 0.95, ctx.backdropZ + 0.42, 0.26, 0.36, 0.04, {
      pitch: -0.35,
    });
  }
  bump(ctx, 'magazineRack', magazines + 1);
}

/** Mannequins on a low plinth — tailoring and boutiques. */
function dressMannequins(ctx: DressingContext, count = 3): void {
  const { batcher, centerX, width, floorY } = ctx;
  for (let index = 0; index < count; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / count;
    const z = ctx.backdropZ + ctx.depth * 0.44;
    batcher.box(ctx.materials.get('plinth'), u, floorY + 0.06, z, 0.5, 0.12, 0.4);
    batcher.cylinder(ctx.materials.accent(ctx.plan.awning.accentIndex + index), u, floorY + 0.72, z, 0.34, 0.9);
    batcher.cylinder(ctx.materials.get('metal'), u, floorY + 1.32, z, 0.12, 0.16);
    batcher.sphere(ctx.materials.get('goods'), u, floorY + 1.5, z, 0.24);
  }
  bump(ctx, 'mannequins', count * 4);
}

/** Chrome rail with hanging garments. */
function dressClothingRack(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  const railWidth = width * 0.66;
  batcher.cylinder(ctx.materials.get('metal'), centerX, floorY + 1.66, ctx.backdropZ + 0.5, 0.05, railWidth, {
    roll: Math.PI / 2,
  });
  for (const edge of [-1, 1]) {
    batcher.cylinder(
      ctx.materials.get('metal'),
      centerX + (railWidth / 2) * edge,
      floorY + 0.85,
      ctx.backdropZ + 0.5,
      0.06,
      1.6,
    );
  }
  const garments = Math.max(3, Math.round(railWidth / 0.24));
  for (let index = 0; index < garments; index += 1) {
    const u = centerX - railWidth / 2 + (railWidth * (index + 0.5)) / garments;
    batcher.box(
      goodsColor(ctx, index),
      u,
      floorY + 1.18,
      ctx.backdropZ + 0.5,
      railWidth / garments * 0.78,
      0.86,
      0.3,
    );
  }
  bump(ctx, 'clothingRack', garments + 3);
}

/** Lit display shelves of folded goods — modern boutiques. */
function dressBoutiqueShelves(ctx: DressingContext): void {
  dressShelving(ctx, ctx.materials.get('trim'));
  ctx.counts.interiorLamps += 2;
  bump(ctx, 'boutiqueShelves', 2);
}

/** Record bin with sleeved vinyl. */
function dressRecords(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const bins = Math.max(1, Math.round(width / 2));
  let placed = 0;
  for (let bin = 0; bin < bins; bin += 1) {
    const u = centerX - width / 2 + (width * (bin + 0.5)) / bins;
    batcher.box(ctx.materials.get('goods'), u, floorY + 0.36, ctx.backdropZ + depth * 0.46, (width / bins) * 0.72, 0.72, depth * 0.6);
    const sleeves = Math.max(5, Math.round((width / bins) / 0.16));
    for (let index = 0; index < sleeves; index += 1) {
      batcher.box(
        ctx.materials.get('paper'),
        u - (width / bins) * 0.3 + ((width / bins) * 0.6 * (index + 0.5)) / sleeves,
        floorY + 0.5,
        ctx.backdropZ + depth * 0.46,
        0.05,
        0.36,
        0.34,
      );
    }
    placed += sleeves + 1;
  }
  bump(ctx, 'records', placed);
}

/** Wall racks of record sleeves with era posters above. */
function dressRecordRacks(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  const racks = 2;
  let placed = 0;
  for (let rank = 0; rank < racks; rank += 1) {
    const y = floorY + 0.8 + rank * 0.78;
    batcher.box(ctx.materials.get('metal'), centerX, y, ctx.backdropZ + 0.14, width * 0.74, 0.05, 0.2);
    const sleeves = Math.max(4, Math.round((width * 0.72) / 0.34));
    for (let index = 0; index < sleeves; index += 1) {
      batcher.box(
        goodsColor(ctx, index + rank),
        centerX - (width * 0.72) / 2 + ((width * 0.72) * (index + 0.5)) / sleeves,
        y + 0.18,
        ctx.backdropZ + 0.16,
        0.3,
        0.32,
        0.04,
      );
    }
    placed += sleeves + 1;
  }
  if (ctx.decalMaterial) {
    batcher.box(
      ctx.menuMaterial ?? ctx.decalMaterial,
      centerX,
      floorY + 2.05,
      ctx.backdropZ + 0.08,
      0.94,
      0.59,
      0.04,
    );
    ctx.counts.decals += 1;
    placed += 1;
  }
  bump(ctx, 'recordRacks', placed);
}

/** Rank of upright arcade cabinets with glowing marquees. */
function dressArcadeCabinets(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY, random } = ctx;
  const cabinets = Math.max(2, Math.min(4, Math.round(width / 1.6)));
  const screen = ctx.screenMaterial ?? ctx.materials.get('emissive');
  for (let index = 0; index < cabinets; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / cabinets;
    const z = ctx.backdropZ + depth * 0.5;
    batcher.box(ctx.materials.get('structure'), u, floorY + 0.86, z, 0.62, 1.5, depth * 0.8);
    batcher.box(ctx.materials.get('trim'), u, floorY + 1.66, z, 0.62, 0.14, depth * 0.8);
    batcher.box(screen, u, floorY + 1.12, z + depth * 0.44, 0.46, 0.36, 0.04);
    batcher.box(ctx.materials.get('metal'), u, floorY + 0.68, z + depth * 0.42, 0.5, 0.18, 0.24);
  }
  bump(ctx, 'arcadeCabinets', cabinets * 4);
  void random;
}

/** Grid of glowing CRTs — 1965 showroom and 1985 hi-fi shop. */
function dressTvWall(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY, headY } = ctx;
  const screen = ctx.screenMaterial ?? ctx.materials.get('emissive');
  const columns = Math.max(3, Math.round(width / 1.1));
  const rows = 2;
  for (let row = 0; row < rows; row += 1) {
    const y = floorY + 0.75 + row * 0.72;
    if (y > headY - 0.3) continue;
    for (let column = 0; column < columns; column += 1) {
      const u = centerX - (width * 0.84) / 2 + ((width * 0.84) * (column + 0.5)) / columns;
      batcher.box(ctx.materials.get('interior'), u, y, ctx.backdropZ + 0.3, 0.5, 0.42, 0.4);
      batcher.box(screen, u, y, ctx.backdropZ + 0.52, 0.4, 0.3, 0.03);
    }
  }
  bump(ctx, 'tvWall', rows * columns * 2);
}

/** Shelves of boxed consumer electronics. */
function dressElectronicsWall(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY, random } = ctx;
  const shelves = 3;
  let placed = 0;
  for (let level = 0; level < shelves; level += 1) {
    const y = floorY + 0.6 + level * 0.6;
    batcher.box(ctx.materials.get('metal'), centerX, y, ctx.backdropZ + 0.24, width * 0.8, 0.05, 0.34);
    const boxes = Math.max(3, Math.round((width * 0.78) / 0.5));
    for (let index = 0; index < boxes; index += 1) {
      const u = centerX - (width * 0.78) / 2 + ((width * 0.78) * (index + 0.5)) / boxes;
      const h = random.float(0.24, 0.42);
      batcher.box(goodsColor(ctx, index + level), u, y + 0.03 + h / 2, ctx.backdropZ + 0.24, 0.4, h, 0.3);
    }
    placed += boxes + 1;
  }
  bump(ctx, 'electronicsWall', placed);
}

/** Wall-to-wall tape shelves — 1985 video rental. */
function dressVideoRentalShelf(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  let placed = 0;
  for (let level = 0; level < 4; level += 1) {
    const y = floorY + 0.55 + level * 0.48;
    batcher.box(ctx.materials.get('metal'), centerX, y, ctx.backdropZ + 0.18, width * 0.86, 0.04, 0.28);
    const tapes = Math.max(6, Math.round((width * 0.84) / 0.18));
    for (let index = 0; index < tapes; index += 1) {
      batcher.box(
        ctx.materials.get('paper'),
        centerX - (width * 0.84) / 2 + ((width * 0.84) * (index + 0.5)) / tapes,
        y + 0.1,
        ctx.backdropZ + 0.2,
        0.13,
        0.19,
        0.05,
      );
    }
    placed += tapes + 1;
  }
  bump(ctx, 'videoRentalShelf', placed);
}

/** Espresso bar with machine, cups and a pastry case. */
function dressEspressoBar(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const z = ctx.backdropZ + depth * 0.5;
  const barWidth = width * 0.66;
  batcher.box(ctx.materials.get('goods'), centerX, floorY + 0.52, z, barWidth, 0.08, depth * 0.5);
  batcher.box(
    ctx.materials.accent(ctx.plan.awning.accentIndex),
    centerX,
    floorY + 0.26,
    z + depth * 0.2,
    barWidth,
    0.5,
    depth * 0.14,
  );
  // Espresso machine: body, group heads and steam wands.
  batcher.box(ctx.materials.get('metal'), centerX - barWidth * 0.22, floorY + 0.78, z, 0.66, 0.44, depth * 0.4);
  for (let index = 0; index < 2; index += 1) {
    batcher.cylinder(
      ctx.materials.get('metal'),
      centerX - barWidth * 0.22 + (index - 0.5) * 0.26,
      floorY + 0.52,
      z + depth * 0.2,
      0.1,
      0.1,
    );
  }
  batcher.cylinder(ctx.materials.get('metal'), centerX + barWidth * 0.3, floorY + 0.7, z, 0.08, 0.5);
  bump(ctx, 'espressoBar', 6);
}

/** Round cafe tables with chairs. */
function dressCafeTables(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const tables = Math.max(1, Math.round(width / 2.2));
  for (let index = 0; index < tables; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / tables;
    const z = ctx.backdropZ + depth * 0.55;
    batcher.cylinder(ctx.materials.get('metal'), u, floorY + 0.36, z, 0.06, 0.72);
    batcher.cylinder(ctx.materials.get('goods'), u, floorY + 0.74, z, 0.62, 0.05);
    for (const side of [-1, 1]) {
      batcher.box(ctx.materials.accent(ctx.plan.awning.accentIndex), u + side * 0.5, floorY + 0.44, z, 0.36, 0.06, 0.36);
      batcher.box(ctx.materials.get('metal'), u + side * 0.5, floorY + 0.72, z - 0.16 * side, 0.36, 0.5, 0.05);
    }
  }
  bump(ctx, 'cafeTables', tables * 5);
}

/** Rows of desks with glowing laptops. */
function dressLaptopRows(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const screen = ctx.screenMaterial ?? ctx.materials.get('emissive');
  const seats = Math.max(3, Math.round(width / 0.9));
  const z = ctx.backdropZ + depth * 0.55;
  batcher.box(ctx.materials.get('goods'), centerX, floorY + 0.72, z, width * 0.78, 0.06, depth * 0.5);
  for (let index = 0; index < seats; index += 1) {
    const u = centerX - (width * 0.74) / 2 + ((width * 0.74) * (index + 0.5)) / seats;
    batcher.box(ctx.materials.get('metal'), u, floorY + 0.78, z, 0.34, 0.03, 0.24);
    batcher.box(screen, u, floorY + 0.9, z - 0.1, 0.32, 0.22, 0.02, { pitch: -0.28 });
    batcher.box(ctx.materials.get('metal'), u, floorY + 0.42, z + 0.4, 0.34, 0.06, 0.34);
  }
  bump(ctx, 'laptopRows', seats * 4);
}

/** Print counter with a copier and paper reams. */
function dressPrintCounter(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const z = ctx.backdropZ + depth * 0.54;
  batcher.box(ctx.materials.get('trim'), centerX, floorY + 0.5, z, width * 0.7, 0.08, depth * 0.6);
  batcher.box(ctx.materials.get('goods'), centerX, floorY + 0.24, z, width * 0.68, 0.44, depth * 0.5);
  batcher.box(ctx.materials.get('metal'), centerX - width * 0.15, floorY + 0.82, z, 0.8, 0.5, depth * 0.5);
  for (let index = 0; index < 4; index += 1) {
    batcher.box(
      ctx.materials.get('paper'),
      centerX + width * 0.22,
      floorY + 0.58 + index * 0.06,
      z + (index % 2) * 0.1,
      0.24,
      0.06,
      0.3,
    );
  }
  bump(ctx, 'printCounter', 6);
}

/** Wall of handsets in illuminated bays. */
function dressPhoneWall(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  const columns = Math.max(4, Math.round(width / 0.7));
  const rows = 3;
  for (let row = 0; row < rows; row += 1) {
    const y = floorY + 0.72 + row * 0.58;
    for (let column = 0; column < columns; column += 1) {
      const u = centerX - (width * 0.82) / 2 + ((width * 0.82) * (column + 0.5)) / columns;
      batcher.box(ctx.materials.get('metal'), u, y, ctx.backdropZ + 0.16, 0.24, 0.3, 0.12);
      batcher.box(
        ctx.materials.get('emissive'),
        u,
        y,
        ctx.backdropZ + 0.23,
        0.18,
        0.22,
        0.02,
      );
    }
  }
  bump(ctx, 'phoneWall', columns * rows * 2);
}

/** Teller counter behind laminated glass with a queue rail. */
function dressBankCounter(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const z = ctx.backdropZ + depth * 0.44;
  batcher.box(ctx.materials.get('goods'), centerX, floorY + 0.55, z, width * 0.74, 0.08, depth * 0.5);
  batcher.box(ctx.materials.get('goods'), centerX, floorY + 0.26, z, width * 0.72, 0.48, depth * 0.44);
  batcher.box(ctx.materials.get('glass'), centerX, floorY + 1.15, z - depth * 0.18, width * 0.74, 0.9, 0.03);
  for (let index = 0; index < 3; index += 1) {
    batcher.cylinder(
      ctx.materials.get('metal'),
      centerX - 0.5 + index * 0.5,
      floorY + 0.5,
      ctx.backdropZ + depth * 0.8,
      0.04,
      1,
    );
  }
  batcher.cylinder(ctx.materials.get('metal'), centerX, floorY + 0.98, ctx.backdropZ + depth * 0.8, 0.04, width * 0.6, {
    roll: Math.PI / 2,
  });
  bump(ctx, 'bankCounter', 8);
}

/** Plinths projecting holographic product displays. */
function dressHologramPlinths(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY, random } = ctx;
  const plinths = Math.max(1, Math.min(3, Math.round(width / 2.4)));
  const screen = ctx.screenMaterial ?? ctx.materials.get('emissive');
  for (let index = 0; index < plinths; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / plinths;
    const z = ctx.backdropZ + depth * 0.48;
    batcher.cylinder(ctx.materials.get('trim'), u, floorY + 0.34, z, 0.52, 0.68);
    batcher.cylinder(ctx.materials.get('emissive'), u, floorY + 0.7, z, 0.46, 0.04);
    // The projection itself: a translucent, floating media panel.
    batcher.box(screen, u, floorY + 1.28, z, 0.46, 0.72, 0.03, {
      yaw: random.float(-0.24, 0.24),
    });
  }
  bump(ctx, 'hologramPlinths', plinths * 3);
}

/** Shelves with LED strips under every lip. */
function dressLedShelves(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  let placed = 0;
  for (let level = 0; level < 4; level += 1) {
    const y = floorY + 0.5 + level * 0.48;
    batcher.box(ctx.materials.get('metal'), centerX, y, ctx.backdropZ + 0.22, width * 0.8, 0.04, 0.32);
    batcher.box(ctx.materials.get('emissive'), centerX, y - 0.03, ctx.backdropZ + 0.36, width * 0.8, 0.02, 0.03);
    const items = Math.max(3, Math.round((width * 0.76) / 0.34));
    for (let index = 0; index < items; index += 1) {
      batcher.box(
        goodsColor(ctx, index + level),
        centerX - (width * 0.76) / 2 + ((width * 0.76) * (index + 0.5)) / items,
        y + 0.12,
        ctx.backdropZ + 0.22,
        0.24,
        0.2,
        0.22,
      );
    }
    placed += items + 2;
  }
  bump(ctx, 'ledShelves', placed);
}

/** VR pods with visored headsets. */
function dressVrRigs(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const screen = ctx.screenMaterial ?? ctx.materials.get('emissive');
  const pods = Math.max(2, Math.min(3, Math.round(width / 2.2)));
  for (let index = 0; index < pods; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / pods;
    const z = ctx.backdropZ + depth * 0.5;
    batcher.box(ctx.materials.get('structure'), u, floorY + 0.7, z, 1.1, 1.2, depth * 0.7);
    batcher.box(screen, u, floorY + 1.0, z + depth * 0.4, 0.9, 0.5, 0.03);
    batcher.cylinder(ctx.materials.get('metal'), u, floorY + 1.15, z + depth * 0.2, 0.3, 0.24, {
      roll: Math.PI / 2,
    });
  }
  bump(ctx, 'vrRigs', pods * 3);
}

/** Bicycles propped in a rack — zero-waste and cycle shops. */
function dressBikes(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const bikes = 2;
  for (let index = 0; index < bikes; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / bikes;
    const z = ctx.backdropZ + depth * 0.6;
    for (const offset of [-0.42, 0.42]) {
      batcher.cylinder(ctx.materials.get('metal'), u + offset, floorY + 0.36, z, 0.68, 0.05, {
        roll: Math.PI / 2,
      });
    }
    batcher.box(ctx.materials.accent(ctx.plan.awning.accentIndex), u, floorY + 0.62, z, 0.9, 0.06, 0.05);
    batcher.box(ctx.materials.get('metal'), u - 0.1, floorY + 0.86, z, 0.34, 0.4, 0.05);
  }
  bump(ctx, 'bikes', bikes * 6);
}

/** Planter boxes with shrubs and trailing greenery. */
function dressPlanters(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY, random } = ctx;
  const planters = Math.max(1, Math.round(width / 2.6));
  for (let index = 0; index < planters; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / planters;
    const z = ctx.backdropZ + 0.42;
    batcher.box(ctx.materials.get('goods'), u, floorY + 0.22, z, width / planters * 0.7, 0.44, 0.42);
    for (let leaf = 0; leaf < 5; leaf += 1) {
      batcher.cone(
        ctx.materials.accent(ctx.plan.awning.accentIndex + leaf),
        u + random.float(-0.28, 0.28),
        floorY + 0.6 + random.float(0, 0.3),
        z + random.float(-0.12, 0.12),
        random.float(0.16, 0.3),
        random.float(0.4, 0.8),
      );
    }
  }
  bump(ctx, 'planters', planters * 6);
}

/** Trays of micro-greens under warm grow lamps. */
function dressMicroGreens(ctx: DressingContext): void {
  const { batcher, centerX, width, floorY } = ctx;
  let placed = 0;
  for (let level = 0; level < 2; level += 1) {
    const y = floorY + 0.66 + level * 0.62;
    batcher.box(ctx.materials.get('metal'), centerX, y, ctx.backdropZ + 0.24, width * 0.68, 0.04, 0.3);
    const trays = Math.max(3, Math.round((width * 0.66) / 0.3));
    for (let index = 0; index < trays; index += 1) {
      const u = centerX - (width * 0.66) / 2 + ((width * 0.66) * (index + 0.5)) / trays;
      batcher.box(ctx.materials.get('goods'), u, y + 0.06, ctx.backdropZ + 0.24, 0.24, 0.08, 0.24);
      batcher.sphere(
        ctx.materials.accent(ctx.plan.awning.accentIndex),
        u,
        y + 0.14,
        ctx.backdropZ + 0.24,
        0.2,
      );
    }
    batcher.box(ctx.materials.get('emissive'), centerX, y + 0.42, ctx.backdropZ + 0.24, width * 0.68, 0.03, 0.05);
    placed += trays * 2 + 2;
  }
  bump(ctx, 'microGreens', placed);
}

/** Self-service checkout kiosks. */
function dressSelfCheckout(ctx: DressingContext): void {
  const { batcher, centerX, width, depth, floorY } = ctx;
  const screen = ctx.screenMaterial ?? ctx.materials.get('emissive');
  const kiosks = Math.max(1, Math.min(3, Math.round(width / 2.6)));
  for (let index = 0; index < kiosks; index += 1) {
    const u = centerX - width / 2 + (width * (index + 0.5)) / kiosks;
    const z = ctx.backdropZ + depth * 0.6;
    batcher.box(ctx.materials.get('metal'), u, floorY + 0.5, z, 0.7, 1, 0.5);
    batcher.box(screen, u, floorY + 1.12, z, 0.4, 0.3, 0.03, { pitch: -0.2 });
    batcher.box(ctx.materials.get('emissive'), u, floorY + 0.92, z + 0.26, 0.3, 0.03, 0.06);
  }
  bump(ctx, 'selfCheckout', kiosks * 3);
}

/** The dressing builders, keyed by kind. */
const DRESSING_BUILDERS: Readonly<
  Record<ShopDressingKind, (ctx: DressingContext) => void>
> = Object.freeze({
  produceCrates: dressProduceCrates,
  sacks: dressSacks,
  shelving: (ctx) => dressShelving(ctx),
  priceCards: (ctx) => dressPriceCards(ctx),
  windowPosters: (ctx) => dressWindowPosters(ctx),
  dinerCounter: dressDinerCounter,
  stools: (ctx) => dressStools(ctx),
  menuBoard: dressMenuBoard,
  coffeeUrn: dressCoffeeUrn,
  pastryCase: dressPastryCase,
  mirrorWall: dressMirrorWall,
  bench: dressBench,
  bottles: dressBottles,
  tools: dressTools,
  newsPile: dressNewsPile,
  magazineRack: dressMagazineRack,
  mannequins: (ctx) => dressMannequins(ctx),
  clothingRack: dressClothingRack,
  boutiqueShelves: dressBoutiqueShelves,
  records: dressRecords,
  recordRacks: dressRecordRacks,
  arcadeCabinets: dressArcadeCabinets,
  tvWall: dressTvWall,
  electronicsWall: dressElectronicsWall,
  videoRentalShelf: dressVideoRentalShelf,
  espressoBar: dressEspressoBar,
  cafeTables: dressCafeTables,
  laptopRows: dressLaptopRows,
  printCounter: dressPrintCounter,
  phoneWall: dressPhoneWall,
  bankCounter: dressBankCounter,
  hologramPlinths: dressHologramPlinths,
  ledShelves: dressLedShelves,
  vrRigs: dressVrRigs,
  bikes: dressBikes,
  planters: dressPlanters,
  microGreens: dressMicroGreens,
  selfCheckout: dressSelfCheckout,
});

/* ------------------------------------------------------------------------- *
 * Shopfront assembly
 * ------------------------------------------------------------------------- */

export interface ShopfrontBuildOptions {
  readonly plan: ShopfrontPlan;
  readonly materials: StorefrontMaterialSet;
  readonly geometries: DetailGeometrySetType;
  /** Group the shopfront is built into (already at the lot's band position). */
  readonly parent: THREE.Group;
  readonly random: RandomSource;
  /** Painted fascia face; supplied by the API, which owns texture caching. */
  readonly fascia: SignMaterialHandle | null;
  /** Shared portrait decal sheet (price cards, pasted posters). */
  readonly decals: SignMaterialHandle | null;
  /** Shared landscape sheet (chalkboards, bill boards, rack posters). */
  readonly menu: SignMaterialHandle | null;
  /** Lettered awning valance face for this shop. */
  readonly valance: SignMaterialHandle | null;
  /** Shared animated dressing screen for this era, when it has one. */
  readonly screen: SignMaterialHandle | null;
}

export interface ShopfrontBuildResult {
  readonly counts: ShopfrontFeatureCounts;
  readonly instances: number;
  readonly meshes: readonly THREE.Mesh[];
  /** Media faces this shopfront references, so the API can tick them. */
  readonly signFaces: readonly SignMaterialHandle[];
}

/**
 * Builds one era's shopfront into `parent`: frame, glazing, door, display bay,
 * dressing, awning and the fascia signage panel.
 */
export function buildShopfront(options: ShopfrontBuildOptions): ShopfrontBuildResult {
  const { plan, materials, geometries, parent, random, fascia, decals, menu, valance, screen } =
    options;
  const counts = createShopfrontFeatureCounts();
  const metrics = STOREFRONT_METRICS;
  const stream = random.fork(`${plan.lotId}:shopfront:${plan.era}`);
  const signFaces: SignMaterialHandle[] = [];
  const half = plan.frontWidth / 2;

  /* ---------------- frame: plinth, pilasters, fascia ---------------- */
  const frame = new StorefrontBatcher(parent, geometries, 'shopfront');
  frame.box(materials.get('plinth'), 0, metrics.plinthHeight / 2, 0.32, plan.frontWidth, metrics.plinthHeight, 0.36);
  counts.plinths += 1;
  for (const edge of [-1, 1]) {
    frame.box(
      materials.get('structure'),
      (half - metrics.pilasterWidth / 2) * edge,
      1.85,
      0.3,
      metrics.pilasterWidth,
      3.44,
      metrics.frameDepth,
    );
    counts.pilasters += 1;
    frame.box(
      materials.get('trim'),
      (half - metrics.pilasterWidth / 2) * edge,
      3.62,
      0.34,
      metrics.pilasterWidth * 1.05,
      0.12,
      metrics.frameDepth * 0.9,
    );
    counts.cornices += 1;
  }
  frame.box(
    materials.get('structure'),
    0,
    metrics.fasciaBottom + metrics.fasciaHeight / 2,
    0.24,
    plan.frontWidth - 0.5,
    metrics.fasciaHeight,
    0.26,
  );
  counts.fasciaBoards += 1;
  frame.box(
    materials.get('trim'),
    0,
    metrics.fasciaBottom + metrics.fasciaHeight + metrics.corniceHeight / 2,
    0.3,
    plan.frontWidth - 0.3,
    metrics.corniceHeight,
    0.34,
  );
  counts.cornices += 1;
  const brackets = Math.max(2, Math.round(plan.frontWidth / 3));
  for (let index = 0; index < brackets; index += 1) {
    frame.box(
      materials.get('metal'),
      -half + 0.7 + ((plan.frontWidth - 1.4) * (index + 0.5)) / brackets,
      metrics.fasciaBottom - 0.09,
      0.34,
      0.07,
      0.18,
      0.16,
    );
    counts.brackets += 1;
  }
  // Transom / letterboard strip above the glazing.
  frame.box(
    materials.get('structure'),
    0,
    metrics.transomBottom + metrics.transomHeight / 2,
    0.22,
    plan.frontWidth - metrics.pilasterWidth * 2,
    metrics.transomHeight,
    0.2,
  );
  counts.transoms += 1;
  frame.flush();

  /* ---------------- fascia signage panel ---------------- */
  const signage = new StorefrontBatcher(parent, geometries, 'signage');
  if (fascia) {
    const boardWidth = plan.frontWidth - 0.72;
    signage.box(
      fascia.material,
      0,
      metrics.fasciaBottom + metrics.fasciaHeight / 2,
      0.4,
      boardWidth,
      metrics.fasciaHeight - 0.08,
      0.06,
    );
    counts.signageFaces += 1;
    signFaces.push(fascia);
  }
  signage.flush();

  /* ---------------- reveal: backdrop, floor, lighting ---------------- */
  const shell = new StorefrontBatcher(parent, geometries, 'shopfront');
  shell.box(
    materials.get('interior'),
    plan.displayCenterX,
    metrics.displayFloor + 1.03,
    metrics.backdropZ,
    plan.displayWidth,
    2.06,
    0.08,
  );
  counts.backdrops += 1;
  shell.box(
    materials.get('plinth'),
    plan.displayCenterX,
    metrics.displayFloor - 0.02,
    metrics.backdropZ + plan.displayDepth / 2,
    plan.displayWidth,
    0.06,
    plan.displayDepth,
  );
  shell.box(
    materials.get('structure'),
    plan.displayCenterX,
    metrics.displayFloor / 2,
    metrics.backdropZ + 0.06,
    plan.displayWidth,
    metrics.displayFloor,
    0.12,
  );
  counts.stallRisers += 1;
  const lamps = plan.interiorLight === 'led' ? 3 : 2;
  for (let index = 0; index < lamps; index += 1) {
    shell.box(
      materials.get('emissive'),
      plan.displayCenterX - plan.displayWidth / 2 + (plan.displayWidth * (index + 0.5)) / lamps,
      metrics.glassTop - 0.06,
      metrics.backdropZ + plan.displayDepth * 0.5,
      plan.displayWidth / lamps * 0.6,
      0.05,
      0.12,
    );
    counts.interiorLamps += 1;
  }
  shell.flush();

  /* ---------------- glazing, mullions and the door ---------------- */
  const glass = new StorefrontBatcher(parent, geometries, 'shopfront-glass');
  const glassZ = metrics.backdropZ + plan.displayDepth + 0.06;
  glass.box(
    materials.get('glass'),
    plan.displayCenterX,
    (metrics.displayFloor + metrics.glassTop) / 2,
    glassZ,
    plan.displayWidth,
    metrics.glassTop - metrics.displayFloor,
    0.05,
  );
  counts.glassPanes += 1;
  const mullion = new StorefrontBatcher(parent, geometries, 'shopfront');
  mullion.box(
    materials.get('trim'),
    plan.displayCenterX,
    metrics.displayFloor + 0.03,
    glassZ + 0.01,
    plan.displayWidth,
    0.1,
    0.12,
  );
  mullion.box(
    materials.get('trim'),
    plan.displayCenterX,
    metrics.glassTop - 0.03,
    glassZ + 0.01,
    plan.displayWidth,
    0.1,
    0.12,
  );
  counts.mullions += 2;
  for (let index = 1; index < plan.bayCount; index += 1) {
    const paneWidth = plan.displayWidth / plan.bayCount;
    mullion.box(
      materials.get('trim'),
      plan.displayCenterX - plan.displayWidth / 2 + paneWidth * index,
      (metrics.displayFloor + metrics.glassTop) / 2,
      glassZ + 0.01,
      0.08,
      metrics.glassTop - metrics.displayFloor,
      0.12,
    );
    counts.mullions += 1;
  }
  for (const edge of [-1, 1]) {
    mullion.box(
      materials.get('trim'),
      plan.displayCenterX + (plan.displayWidth / 2 + 0.05) * edge,
      (metrics.displayFloor + metrics.glassTop) / 2,
      glassZ + 0.01,
      0.1,
      metrics.glassTop - metrics.displayFloor + 0.1,
      0.14,
    );
    counts.mullions += 1;
  }
  // Door: frame, leaf, glazing, handle and step.
  const doorZ = metrics.backdropZ + 0.06;
  mullion.box(
    materials.get('structure'),
    plan.doorCenterX,
    metrics.doorHeight / 2,
    doorZ,
    plan.doorWidth,
    metrics.doorHeight,
    0.1,
  );
  for (const edge of [-1, 1]) {
    mullion.box(
      materials.get('trim'),
      plan.doorCenterX + (plan.doorWidth / 2 + 0.05) * edge,
      (metrics.doorHeight + 0.16) / 2,
      doorZ + 0.07,
      0.12,
      metrics.doorHeight + 0.16,
      0.16,
    );
    counts.mullions += 1;
  }
  mullion.box(
    materials.get('trim'),
    plan.doorCenterX,
    metrics.doorHeight + 0.1,
    doorZ + 0.07,
    plan.doorWidth + 0.24,
    0.12,
    0.18,
  );
  counts.mullions += 1;
  glass.box(
    materials.get('glass'),
    plan.doorCenterX,
    metrics.doorHeight * 0.62,
    doorZ + 0.06,
    plan.doorWidth * 0.72,
    metrics.doorHeight * 0.52,
    0.04,
  );
  counts.glassPanes += 1;
  mullion.box(
    materials.get('structure'),
    plan.doorCenterX,
    metrics.doorHeight * 0.24,
    doorZ + 0.06,
    plan.doorWidth * 0.72,
    metrics.doorHeight * 0.3,
    0.05,
  );
  mullion.cylinder(
    materials.get('metal'),
    plan.doorCenterX + (plan.doorWidth / 2 - 0.12) * (plan.doorCenterX < 0 ? -1 : 1),
    1.05,
    doorZ + 0.12,
    0.05,
    0.5,
  );
  mullion.box(
    materials.get('plinth'),
    plan.doorCenterX,
    0.045,
    doorZ + 0.2,
    plan.doorWidth + 0.36,
    0.09,
    0.56,
  );
  counts.doors += 1;
  counts.doorSteps += 1;
  mullion.flush();
  glass.flush();

  /* ---------------- window dressing ---------------- */
  const dressing = new StorefrontBatcher(parent, geometries, 'window-dressing');
  const dressingContext: DressingContext = {
    batcher: dressing,
    materials,
    plan,
    random: stream,
    counts,
    decalMaterial: decals?.material ?? null,
    menuMaterial: menu?.material ?? null,
    screenMaterial: screen?.material ?? null,
    centerX: plan.displayCenterX,
    width: plan.displayWidth,
    depth: plan.displayDepth,
    backdropZ: metrics.backdropZ,
    floorY: metrics.displayFloor,
    headY: metrics.glassTop,
    signFaces,
  };
  for (const kind of plan.dressing) {
    DRESSING_BUILDERS[kind](dressingContext);
    counts.dressingKinds += 1;
  }
  if (decals) signFaces.push(decals);
  if (menu) signFaces.push(menu);
  if (screen) signFaces.push(screen);
  dressing.flush();

  /* ---------------- awning ---------------- */
  const awning = new StorefrontBatcher(parent, geometries, 'awning');
  if (plan.awning.kind !== 'none') {
    const style = plan.awning;
    const fabric = materials.accent(style.accentIndex);
    const springY = metrics.awningSpring;
    const canopyWidth = plan.frontWidth - 0.9;
    const reach = style.projection;
    const dropY = Math.sin(style.pitch) * reach;
    const canopyZ = 0.24 + (Math.cos(style.pitch) * reach) / 2;
    const canopyY = springY - dropY / 2;
    awning.box(fabric, 0, canopyY, canopyZ, canopyWidth, 0.06, reach, { pitch: style.pitch });
    counts.awnings += 1;
    for (const edge of [-1, 1]) {
      awning.box(
        materials.get('metal'),
        (canopyWidth / 2 - 0.06) * edge,
        springY - 0.16,
        0.3,
        0.07,
        0.34,
        0.5,
      );
      counts.awningSupports += 1;
    }
    if (style.drop > 0) {
      const valanceZ = 0.24 + Math.cos(style.pitch) * reach;
      const valanceY = springY - dropY - style.drop / 2;
      const valanceWidth = canopyWidth + 0.06;
      awning.box(
        style.valanceText && valance ? valance.material : fabric,
        0,
        valanceY,
        valanceZ,
        valanceWidth,
        style.drop,
        0.05,
      );
      counts.awningValances += 1;
      if (style.valanceText && valance) {
        counts.decals += 1;
        signFaces.push(valance);
      }
      if (style.scallops > 0) {
        for (let index = 0; index < style.scallops; index += 1) {
          awning.cone(
            fabric,
            -valanceWidth / 2 + (valanceWidth * (index + 0.5)) / style.scallops,
            valanceY - style.drop / 2 - 0.05,
            valanceZ,
            valanceWidth / style.scallops * 0.9,
            0.12,
            { pitch: Math.PI },
          );
          counts.awningScallops += 1;
        }
      }
    }
    if (style.lit) {
      awning.box(
        materials.get('emissive'),
        0,
        springY - 0.05,
        0.24 + reach * 0.5,
        canopyWidth * 0.94,
        0.04,
        0.06,
      );
      counts.interiorLamps += 1;
    }
  }
  const awningInstances = awning.flush();

  return Object.freeze({
    counts,
    instances:
      frame.instanceCount +
      signage.instanceCount +
      shell.instanceCount +
      glass.instanceCount +
      mullion.instanceCount +
      dressing.instanceCount +
      awningInstances,
    meshes: Object.freeze([
      ...frame.flushedMeshes,
      ...signage.flushedMeshes,
      ...shell.flushedMeshes,
      ...glass.flushedMeshes,
      ...mullion.flushedMeshes,
      ...dressing.flushedMeshes,
      ...awning.flushedMeshes,
    ]),
    signFaces: Object.freeze(signFaces),
  });
}

/** Smoothed 0→1 ramp used by the API when crossfading two eras of shopfronts. */
export function storefrontBlend(progress: number): number {
  return smoothStep01(clamp01(progress));
}

/** Convenience: a fresh shared geometry set for one storefront system. */
export function createStorefrontGeometries(): DetailGeometrySetType {
  return new DetailGeometrySet();
}
