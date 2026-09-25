/**
 * Era storefront system: ground-floor shop facades for every layout lot.
 *
 * The module consumes the two shared contracts and changes neither:
 * `../era/eraTypes` supplies the era dataset (retail mix, signage techniques,
 * awning colours, opening hours, price tier, interior glow, palette) and
 * `./layout` supplies the real block lots with their frontage geometry.
 *
 * What it produces, per timeline stop and per ground-floor frontage:
 *
 * * exactly **one** shop unit spanning the whole frontage, aligned to the lot's
 *   street-facing edge and carrying an invented period-plausible brand;
 * * an awning (striped fabric with scallops where the era allows one, a neon
 *   blade in 1985, a flush aluminium canopy in 2005), a transom sign, a hanging
 *   sign, a projecting blade where the era's sign technique calls for one, a
 *   price board, an entrance door with kick/push plate, three or more decals, a
 *   glazed window with display goods and a lit interior behind it, mullions and
 *   a worn/new material overlay;
 * * every texture painted at runtime from era descriptors — no image assets;
 * * an `EraAware.applyEra(era, blend)` cross-morph that fades shop identities,
 *   signage and displays continuously across `0..1`, lerps the shared geometry
 *   and texture channels, and disposes the outgoing variant's geometry,
 *   materials and (reference-counted) textures on swap.
 *
 * Detail density is planned before it is built: {@link planStorefront} is a pure
 * function returning every count, size, texture slot and morph channel, and
 * `tests/storefronts.test.ts` compares those numbers against the values read
 * back off the real three.js objects, so the inspected plan and the built scene
 * cannot drift apart.
 *
 * `occupancy` from the era descriptor is honoured as the share of frontages
 * trading in that period; the remainder stay fully detailed but boarded (planks
 * across the lower glazing and a dimmer interior), because the brief requires
 * every frontage to carry the complete storefront kit.
 */

import * as THREE from "three";

import {
  ERAS,
  ERA_IDS,
  clampBlend,
  type EraAware,
  type EraConfig,
  type EraId,
  type EraSceneSystem,
  type EraUpdateContext,
  type SignStyle,
  type StorefrontKind,
} from "../era/eraTypes";
import { CITY_LAYOUT, type BuildingLot, type CityLayout } from "./layout";
import {
  SIGN_STRUCTURE_GLOW,
  StorefrontTextureLibrary,
  awningKindFor,
  clamp01,
  mixHex,
  paintAwningRecipe,
  paintDecalRecipe,
  paintPosterRecipe,
  paintPriceBoardRecipe,
  paintSignageRecipe,
  paintWearRecipe,
  paintWindowGlassRecipe,
  planAwningRecipe,
  planDecalRecipe,
  planPosterRecipe,
  planPriceBoardRecipe,
  planSignageRecipe,
  planWearRecipe,
  planWindowGlassRecipe,
  shadeHex,
  signStructureFor,
  valanceKindFor,
  type AwningKind,
  type AwningPattern,
  type AwningRecipe,
  type CanvasSurfaceFactory,
  type DecalKind,
  type DecalPlacement,
  type DecalRecipe,
  type PaintReport,
  type PaintedTexture,
  type PosterRecipe,
  type PriceBoardLine,
  type PriceBoardRecipe,
  type SignStructure,
  type SignageRecipe,
  type StorefrontTextureSlot,
  type TexturePaintPlan,
  type ValanceKind,
  type WearRecipe,
  type WindowGlassRecipe,
} from "./storefrontTextures";

/* -------------------------------------------------------------------------- */
/* Shop programmes                                                            */
/* -------------------------------------------------------------------------- */

/** Interior fitting families the shop builders can lay out. */
export type InteriorFixture =
  | "counter"
  | "booths"
  | "wall-shelves"
  | "chiller"
  | "crt-wall"
  | "cabinet-row"
  | "arcade-row"
  | "espresso-machine"
  | "work-benches"
  | "grow-racks"
  | "mannequin-stands"
  | "gym-rig"
  | "clinic-screen"
  | "record-bins"
  | "display-cases";

/** Window goods archetype; each form maps to a buildable display shape. */
export type DisplayGoodForm =
  | "can-pyramid"
  | "hanging-produce"
  | "meat-hooks"
  | "tobacco-tins"
  | "cigar-boxes"
  | "sundae-glasses"
  | "candy-counter"
  | "vinyl-crates"
  | "listening-booth"
  | "mannequin"
  | "garment-rail"
  | "crt-stack"
  | "arcade-cabinet"
  | "video-shelf"
  | "appliance-row"
  | "pizza-oven"
  | "photo-booth"
  | "sporting-rack"
  | "greeting-cards"
  | "espresso-bar"
  | "phone-bar"
  | "internet-terminals"
  | "dvd-shelves"
  | "gym-rig"
  | "salon-station"
  | "sandwich-case"
  | "sourdough-racks"
  | "plant-shelves"
  | "cowork-desks"
  | "robot-arm"
  | "seed-tray-wall"
  | "bike-display"
  | "thrift-rail"
  | "clinic-booth"
  | "laundry-drums"
  | "hardware-bins"
  | "showroom-car";

/** Buildable geometry archetype behind a {@link DisplayGoodForm}. */
export type DisplayShape =
  | "stack"
  | "hanging"
  | "shelf"
  | "cabinet"
  | "machine"
  | "figure"
  | "rack"
  | "planter"
  | "booth";

export interface DisplayGoodSpec {
  readonly shape: DisplayShape;
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly quantity: number;
  /** 0..1 emissive strength of the goods (screens, lit counters, grow lights). */
  readonly glow: number;
}

/** Dimensions and build archetype for every window-good form. */
export const DISPLAY_GOOD_SPECS: Readonly<Record<DisplayGoodForm, DisplayGoodSpec>> = {
  "can-pyramid": { shape: "stack", label: "tinned goods", width: 1.1, height: 1.1, depth: 0.4, quantity: 8, glow: 0 },
  "hanging-produce": { shape: "hanging", label: "hanging produce", width: 1.4, height: 1.2, depth: 0.35, quantity: 6, glow: 0 },
  "meat-hooks": { shape: "hanging", label: "meat hooks", width: 1.3, height: 1.1, depth: 0.3, quantity: 5, glow: 0 },
  "tobacco-tins": { shape: "shelf", label: "tobacco tins", width: 1.3, height: 1.2, depth: 0.32, quantity: 5, glow: 0 },
  "cigar-boxes": { shape: "stack", label: "cigar boxes", width: 1, height: 0.9, depth: 0.3, quantity: 5, glow: 0 },
  "sundae-glasses": { shape: "stack", label: "sundae glasses", width: 1, height: 0.9, depth: 0.3, quantity: 4, glow: 0.1 },
  "candy-counter": { shape: "cabinet", label: "candy counter", width: 1.6, height: 1, depth: 0.5, quantity: 1, glow: 0.2 },
  "vinyl-crates": { shape: "stack", label: "record crates", width: 1.4, height: 1, depth: 0.4, quantity: 6, glow: 0 },
  "listening-booth": { shape: "booth", label: "listening booth", width: 1, height: 1.9, depth: 1, quantity: 1, glow: 0.4 },
  mannequin: { shape: "figure", label: "mannequin", width: 0.5, height: 1.75, depth: 0.4, quantity: 1, glow: 0 },
  "garment-rail": { shape: "rack", label: "garment rail", width: 1.5, height: 1.6, depth: 0.5, quantity: 6, glow: 0 },
  "crt-stack": { shape: "stack", label: "television stack", width: 1.3, height: 1.4, depth: 0.5, quantity: 4, glow: 0.75 },
  "arcade-cabinet": { shape: "machine", label: "arcade cabinet", width: 0.8, height: 1.8, depth: 0.8, quantity: 1, glow: 0.85 },
  "video-shelf": { shape: "shelf", label: "video shelves", width: 1.4, height: 1.5, depth: 0.35, quantity: 5, glow: 0.15 },
  "appliance-row": { shape: "shelf", label: "appliance row", width: 1.6, height: 1.3, depth: 0.55, quantity: 3, glow: 0.25 },
  "pizza-oven": { shape: "machine", label: "pizza oven", width: 1.1, height: 1.2, depth: 0.7, quantity: 1, glow: 0.6 },
  "photo-booth": { shape: "booth", label: "photo booth", width: 1, height: 1.9, depth: 1, quantity: 1, glow: 0.5 },
  "sporting-rack": { shape: "rack", label: "sporting gear", width: 1.4, height: 1.5, depth: 0.4, quantity: 4, glow: 0 },
  "greeting-cards": { shape: "rack", label: "card rack", width: 1.2, height: 1.6, depth: 0.4, quantity: 5, glow: 0 },
  "espresso-bar": { shape: "cabinet", label: "espresso bar", width: 1.6, height: 1.1, depth: 0.55, quantity: 1, glow: 0.35 },
  "phone-bar": { shape: "shelf", label: "handset bar", width: 1.4, height: 1, depth: 0.3, quantity: 5, glow: 0.5 },
  "internet-terminals": { shape: "machine", label: "terminal row", width: 1.2, height: 1.3, depth: 0.6, quantity: 3, glow: 0.55 },
  "dvd-shelves": { shape: "shelf", label: "disc shelves", width: 1.4, height: 1.5, depth: 0.35, quantity: 5, glow: 0.1 },
  "gym-rig": { shape: "machine", label: "training rig", width: 1.6, height: 2, depth: 0.7, quantity: 1, glow: 0.2 },
  "salon-station": { shape: "cabinet", label: "styling station", width: 1.2, height: 1.4, depth: 0.5, quantity: 1, glow: 0.3 },
  "sandwich-case": { shape: "cabinet", label: "sandwich case", width: 1.5, height: 1.1, depth: 0.5, quantity: 1, glow: 0.3 },
  "sourdough-racks": { shape: "shelf", label: "bread racks", width: 1.4, height: 1.5, depth: 0.4, quantity: 4, glow: 0 },
  "plant-shelves": { shape: "planter", label: "plant shelves", width: 1.5, height: 1.7, depth: 0.45, quantity: 6, glow: 0.1 },
  "cowork-desks": { shape: "cabinet", label: "desk row", width: 1.7, height: 1.2, depth: 0.6, quantity: 1, glow: 0.45 },
  "robot-arm": { shape: "machine", label: "robot arm", width: 1.1, height: 1.6, depth: 0.7, quantity: 1, glow: 0.65 },
  "seed-tray-wall": { shape: "planter", label: "seed trays", width: 1.5, height: 1.8, depth: 0.4, quantity: 8, glow: 0.7 },
  "bike-display": { shape: "rack", label: "bicycle display", width: 1.5, height: 1.3, depth: 0.5, quantity: 2, glow: 0.1 },
  "thrift-rail": { shape: "rack", label: "resale rail", width: 1.5, height: 1.5, depth: 0.5, quantity: 6, glow: 0 },
  "clinic-booth": { shape: "booth", label: "screening booth", width: 1.2, height: 1.6, depth: 0.9, quantity: 1, glow: 0.4 },
  "laundry-drums": { shape: "machine", label: "laundry drums", width: 1.4, height: 1.1, depth: 0.6, quantity: 2, glow: 0.2 },
  "hardware-bins": { shape: "shelf", label: "hardware bins", width: 1.5, height: 1.3, depth: 0.45, quantity: 6, glow: 0 },
  "showroom-car": { shape: "machine", label: "showroom car", width: 1.9, height: 1.3, depth: 2.4, quantity: 1, glow: 0.2 },
};

export interface PriceBoardSource {
  readonly title: string;
  readonly lines: readonly (readonly [string, string])[];
}

/**
 * One shop identity: an invented, period-plausible brand realizing an era
 * retail programme.
 *
 * `kind` is always a member of the era's `storefronts.kinds`, so the identity is
 * grounded in the shared era contract rather than duplicated inside this file;
 * `label` is the programme name (diner, tobacconist, arcade, robotics lab …)
 * that the acceptance criteria speak in.
 */
export interface ShopProgramme {
  readonly id: string;
  readonly era: EraId;
  readonly label: string;
  readonly kind: StorefrontKind;
  readonly brand: string;
  readonly tagline: string;
  readonly signStyle: SignStyle;
  readonly structure: SignStructure;
  readonly awningPattern: AwningPattern;
  readonly valanceText: string;
  readonly displayGoods: readonly DisplayGoodForm[];
  readonly decals: readonly DecalKind[];
  readonly fixtures: readonly InteriorFixture[];
  readonly priceBoard: PriceBoardSource;
  readonly poster: Readonly<{ headline: string; subline: string }>;
  /** 0..1 share of block pedestrians this shop draws. */
  readonly footTraffic: number;
}

interface ProgrammeSeed extends Omit<ShopProgramme, "id" | "era" | "signStyle" | "structure"> {}

/**
 * Programme seeds per timeline stop, best frontages first.
 *
 * The leading entries of each era realize the required shop set (1945 diner,
 * barber, tobacconist and grocer; 1965 record shop, soda fountain and clothing
 * boutique; 1985 arcade, video rental and electronics; 2005 coffee chain, phone
 * store and gym; 2025 coworking hub, robotics lab and vertical farm grocer).
 * The remaining entries cover the rest of that era's retail mix so all twenty
 * frontages on the block can trade in period. Every brand is invented: no real
 * trademark is used anywhere in the catalogue.
 */
const PROGRAMME_SEEDS: Readonly<Record<EraId, readonly ProgrammeSeed[]>> = {
  "1945": [
    {
      label: "diner", kind: "diner", brand: "Victory Grill", tagline: "Hot plate specials all day",
      awningPattern: "vertical-stripes", valanceText: "Victory Grill",
      displayGoods: ["hanging-produce", "candy-counter"], decals: ["open-sign", "hours-decal", "payment-logos"],
      fixtures: ["counter", "booths", "display-cases"],
      priceBoard: { title: "Counter menu", lines: [["Blue plate", "35\u00a2"], ["Coffee", "5\u00a2"], ["Pie slice", "10\u00a2"]] },
      poster: { headline: "Meatloaf today", subline: "Served from 6am" }, footTraffic: 0.9,
    },
    {
      label: "barber", kind: "barber", brand: "Halloway's Barbers", tagline: "Shave and a trim, twenty-five cents",
      awningPattern: "wide-bands", valanceText: "Barber",
      displayGoods: ["hardware-bins", "candy-counter"], decals: ["open-sign", "est-band", "vinyl-band"],
      fixtures: ["counter", "display-cases", "booths"],
      priceBoard: { title: "Price list", lines: [["Haircut", "25\u00a2"], ["Shave", "15\u00a2"], ["Tonic", "40\u00a2"]] },
      poster: { headline: "Flat tops", subline: "Walk in welcome" }, footTraffic: 0.7,
    },
    {
      label: "tobacconist", kind: "newsstand", brand: "Kessler's Tobacconist", tagline: "Pipes, papers and evening editions",
      awningPattern: "wide-bands", valanceText: "Tobacconist",
      displayGoods: ["tobacco-tins", "cigar-boxes", "greeting-cards"], decals: ["open-sign", "est-band", "price-flash"],
      fixtures: ["counter", "wall-shelves", "display-cases"],
      priceBoard: { title: "Counter goods", lines: [["Cigarettes", "14\u00a2"], ["Cigars", "10\u00a2"], ["Evening paper", "3\u00a2"]] },
      poster: { headline: "Evening edition", subline: "On the stand at four" }, footTraffic: 0.8,
    },
    {
      label: "grocer", kind: "grocer", brand: "Marlow Bros. Grocer", tagline: "Fresh from the market each morning",
      awningPattern: "vertical-stripes", valanceText: "Grocer",
      displayGoods: ["can-pyramid", "hanging-produce", "candy-counter"], decals: ["open-sign", "payment-logos", "price-flash"],
      fixtures: ["counter", "wall-shelves", "chiller"],
      priceBoard: { title: "Today's prices", lines: [["Bread", "9\u00a2"], ["Milk, quart", "13\u00a2"], ["Butter", "28\u00a2"]] },
      poster: { headline: "Victory garden", subline: "Local produce daily" }, footTraffic: 0.95,
    },
    {
      label: "butcher", kind: "butcher", brand: "Prentice Quality Meats", tagline: "Cut to order on the block",
      awningPattern: "vertical-stripes", valanceText: "Meats",
      displayGoods: ["meat-hooks", "candy-counter"], decals: ["open-sign", "est-band", "price-flash"],
      fixtures: ["counter", "chiller", "display-cases"],
      priceBoard: { title: "Counter cuts", lines: [["Chuck roast", "32\u00a2"], ["Sausages", "24\u00a2"], ["Bacon", "19\u00a2"]] },
      poster: { headline: "Sunday roast", subline: "Order ahead" }, footTraffic: 0.75,
    },
    {
      label: "pharmacy", kind: "pharmacy", brand: "Bell & Sons Apothecary", tagline: "Prescriptions and a soda counter",
      awningPattern: "wide-bands", valanceText: "Apothecary",
      displayGoods: ["hardware-bins", "sundae-glasses"], decals: ["open-sign", "hours-decal", "leaf-badge"],
      fixtures: ["counter", "wall-shelves", "display-cases"],
      priceBoard: { title: "Counter", lines: [["Aspirin", "12\u00a2"], ["Cough syrup", "29\u00a2"], ["Seltzer", "6\u00a2"]] },
      poster: { headline: "Ask the chemist", subline: "Advice free of charge" }, footTraffic: 0.6,
    },
    {
      label: "hardware", kind: "hardware", brand: "Ironmonger & Sons", tagline: "Tools, nails and paint by the pound",
      awningPattern: "wide-bands", valanceText: "Hardware",
      displayGoods: ["hardware-bins", "can-pyramid"], decals: ["est-band", "hours-decal", "price-flash"],
      fixtures: ["counter", "wall-shelves"],
      priceBoard: { title: "By the pound", lines: [["Nails", "7\u00a2"], ["Screws", "9\u00a2"], ["Paint, quart", "45\u00a2"]] },
      poster: { headline: "Home repairs", subline: "Everything for the house" }, footTraffic: 0.5,
    },
    {
      label: "tailor", kind: "tailor", brand: "Aldergate Tailoring", tagline: "Alterations while you wait",
      awningPattern: "wide-bands", valanceText: "Tailor",
      displayGoods: ["mannequin", "garment-rail"], decals: ["open-sign", "est-band", "vinyl-band"],
      fixtures: ["counter", "mannequin-stands", "display-cases"],
      priceBoard: { title: "Alterations", lines: [["Trouser hem", "20\u00a2"], ["New suit", "$6.50"], ["Press", "8\u00a2"]] },
      poster: { headline: "New suits", subline: "Wool and gabardine" }, footTraffic: 0.45,
    },
    {
      label: "laundromat", kind: "laundromat", brand: "White Swan Laundry", tagline: "Washed, pressed and folded",
      awningPattern: "vertical-stripes", valanceText: "Laundry",
      displayGoods: ["laundry-drums", "candy-counter"], decals: ["hours-decal", "payment-logos", "soap-sign"],
      fixtures: ["counter", "wall-shelves", "chiller"],
      priceBoard: { title: "Service", lines: [["Wash", "18\u00a2"], ["Shirts", "12\u00a2"], ["Blankets", "45\u00a2"]] },
      poster: { headline: "Soap saver", subline: "Bundle rates available" }, footTraffic: 0.4,
    },
  ],
  "1965": [
    {
      label: "record-shop", kind: "record-shop", brand: "Spinnerette Records", tagline: "Singles, LPs and listening booths",
      awningPattern: "wide-bands", valanceText: "Records",
      displayGoods: ["vinyl-crates", "listening-booth"], decals: ["open-sign", "sale-burst", "price-flash"],
      fixtures: ["record-bins", "counter", "booths"],
      priceBoard: { title: "New releases", lines: [["Single", "99\u00a2"], ["LP", "$3.98"], ["Box set", "$9.50"]] },
      poster: { headline: "Stereo sound", subline: "Hear it before you buy" }, footTraffic: 0.85,
    },
    {
      label: "soda-fountain", kind: "diner", brand: "Frostline Soda Fountain", tagline: "Malts, sundaes and egg creams",
      awningPattern: "vertical-stripes", valanceText: "Frostline",
      displayGoods: ["sundae-glasses", "candy-counter"], decals: ["open-sign", "hours-decal", "price-flash"],
      fixtures: ["counter", "booths", "display-cases"],
      priceBoard: { title: "Fountain", lines: [["Malt", "35\u00a2"], ["Sundae", "45\u00a2"], ["Egg cream", "20\u00a2"]] },
      poster: { headline: "Double scoop", subline: "Two flavours, one price" }, footTraffic: 0.95,
    },
    {
      label: "clothing-boutique", kind: "department-store", brand: "Marlene's Mode Boutique", tagline: "New season separates",
      awningPattern: "wide-bands", valanceText: "Mode",
      displayGoods: ["mannequin", "garment-rail"], decals: ["open-sign", "vinyl-band", "sale-burst"],
      fixtures: ["mannequin-stands", "counter", "display-cases"],
      priceBoard: { title: "Separates", lines: [["Shift dress", "$12.95"], ["Skirt", "$7.50"], ["Scarf", "$2.25"]] },
      poster: { headline: "Autumn line", subline: "New colours arrived" }, footTraffic: 0.7,
    },
    {
      label: "department-store", kind: "department-store", brand: "Harrow & Vale", tagline: "Four floors on one block",
      awningPattern: "wide-bands", valanceText: "Harrow & Vale",
      displayGoods: ["mannequin", "garment-rail", "appliance-row"], decals: ["open-sign", "hours-decal", "sale-burst"],
      fixtures: ["cabinet-row", "mannequin-stands", "counter"],
      priceBoard: { title: "Floor specials", lines: [["Sheets", "$2.98"], ["Toaster", "$9.95"], ["Shoes", "$6.50"]] },
      poster: { headline: "Storewide sale", subline: "This week only" }, footTraffic: 0.8,
    },
    {
      label: "appliance-store", kind: "appliance-store", brand: "Dynaflo Appliance Centre", tagline: "Automatic living for the modern home",
      awningPattern: "wide-bands", valanceText: "Dynaflo",
      displayGoods: ["appliance-row", "crt-stack"], decals: ["open-sign", "payment-logos", "price-flash"],
      fixtures: ["cabinet-row", "crt-wall", "counter"],
      priceBoard: { title: "Home goods", lines: [["Refrigerator", "$189"], ["Washer", "$164"], ["Radio set", "$39.95"]] },
      poster: { headline: "Push-button easy", subline: "Easy terms arranged" }, footTraffic: 0.55,
    },
    {
      label: "pharmacy", kind: "pharmacy", brand: "Corner Drug & Fountain", tagline: "Prescriptions, film and postcards",
      awningPattern: "vertical-stripes", valanceText: "Drugs",
      displayGoods: ["hardware-bins", "sundae-glasses"], decals: ["open-sign", "hours-decal", "leaf-badge"],
      fixtures: ["counter", "wall-shelves", "booths"],
      priceBoard: { title: "Counter", lines: [["Vitamins", "$1.29"], ["Film roll", "79\u00a2"], ["Postcards", "5\u00a2"]] },
      poster: { headline: "Photo finishing", subline: "Prints in twenty-four hours" }, footTraffic: 0.65,
    },
    {
      label: "auto-showroom", kind: "auto-showroom", brand: "Meridian Motors", tagline: "V8 power behind plate glass",
      awningPattern: "vertical-stripes", valanceText: "Meridian",
      displayGoods: ["showroom-car", "appliance-row"], decals: ["open-sign", "payment-logos", "price-flash"],
      fixtures: ["cabinet-row", "counter"],
      priceBoard: { title: "On the floor", lines: [["Two-door", "$2,145"], ["Wagon", "$2,480"], ["Trade-in", "valued"]] },
      poster: { headline: "Drive it today", subline: "Finance from four percent" }, footTraffic: 0.5,
    },
    {
      label: "bowling-alley", kind: "bowling-alley", brand: "Stardust Lanes", tagline: "Twelve lanes, open late",
      awningPattern: "wide-bands", valanceText: "Stardust",
      displayGoods: ["sporting-rack", "candy-counter"], decals: ["open-sign", "sale-burst", "token-sticker"],
      fixtures: ["counter", "booths", "cabinet-row"],
      priceBoard: { title: "Lane rates", lines: [["Per game", "40\u00a2"], ["Shoes", "15\u00a2"], ["League night", "$1.50"]] },
      poster: { headline: "League sign-up", subline: "Thursday evenings" }, footTraffic: 0.6,
    },
    {
      label: "barber", kind: "barber", brand: "Fade & Feather Barbers", tagline: "Crew cuts and taper shaves",
      awningPattern: "wide-bands", valanceText: "Barbers",
      displayGoods: ["hardware-bins", "greeting-cards"], decals: ["open-sign", "est-band", "vinyl-band"],
      fixtures: ["counter", "booths", "display-cases"],
      priceBoard: { title: "Chairs", lines: [["Crew cut", "$1.75"], ["Shave", "$1.25"], ["Flat top", "$2.00"]] },
      poster: { headline: "Flat tops", subline: "No appointment needed" }, footTraffic: 0.55,
    },
  ],
  "1985": [
    {
      label: "arcade", kind: "arcade", brand: "Neon Rift Arcade", tagline: "Twenty cabinets, free play Fridays",
      awningPattern: "solid-canopy", valanceText: "Arcade",
      displayGoods: ["arcade-cabinet", "crt-stack"], decals: ["open-sign", "token-sticker", "sale-burst"],
      fixtures: ["arcade-row", "counter", "booths"],
      priceBoard: { title: "Play rates", lines: [["One play", "25\u00a2"], ["Five plays", "$1.00"], ["High score", "glory"]] },
      poster: { headline: "High score", subline: "Beat the machine" }, footTraffic: 0.9,
    },
    {
      label: "video-rental", kind: "video-rental", brand: "Rewind City Video", tagline: "New releases on two-night hire",
      awningPattern: "gradient-bands", valanceText: "Rewind City",
      displayGoods: ["video-shelf", "crt-stack"], decals: ["open-sign", "hours-decal", "price-flash"],
      fixtures: ["wall-shelves", "crt-wall", "counter"],
      priceBoard: { title: "Two nights", lines: [["New release", "$2.50"], ["Back catalogue", "$1.00"], ["Late fee", "50\u00a2"]] },
      poster: { headline: "Be kind", subline: "Rewind before return" }, footTraffic: 0.85,
    },
    {
      label: "electronics", kind: "electronics", brand: "Voltronic Electronics", tagline: "Stereos, computers and components",
      awningPattern: "solid-canopy", valanceText: "Voltronic",
      displayGoods: ["crt-stack", "appliance-row"], decals: ["open-sign", "payment-logos", "price-flash"],
      fixtures: ["cabinet-row", "crt-wall", "counter"],
      priceBoard: { title: "In stock", lines: [["Boombox", "$89"], ["Home computer", "$399"], ["Blank tape", "$2.99"]] },
      poster: { headline: "Component sale", subline: "Trade-ins accepted" }, footTraffic: 0.7,
    },
    {
      label: "record-shop", kind: "record-shop", brand: "Groove Crate Records", tagline: "Imports, dance twelve-inches and tapes",
      awningPattern: "solid-canopy", valanceText: "Groove Crate",
      displayGoods: ["vinyl-crates", "crt-stack"], decals: ["open-sign", "sale-burst", "price-flash"],
      fixtures: ["record-bins", "counter", "booths"],
      priceBoard: { title: "Crates", lines: [["Twelve-inch", "$5.99"], ["Cassette", "$8.99"], ["Import LP", "$12.50"]] },
      poster: { headline: "New imports", subline: "Limited pressings" }, footTraffic: 0.6,
    },
    {
      label: "pizza", kind: "pizza", brand: "Slice Runner Pizza", tagline: "Hot slices until midnight",
      awningPattern: "gradient-bands", valanceText: "Slice Runner",
      displayGoods: ["pizza-oven", "candy-counter"], decals: ["open-sign", "hours-decal", "price-flash"],
      fixtures: ["counter", "booths", "chiller"],
      priceBoard: { title: "By the slice", lines: [["Cheese slice", "95\u00a2"], ["Whole pie", "$7.50"], ["Soda", "75\u00a2"]] },
      poster: { headline: "Free delivery", subline: "Within eight blocks" }, footTraffic: 0.8,
    },
    {
      label: "department-store", kind: "department-store", brand: "Harfield's Department Store", tagline: "Everything under one roof",
      awningPattern: "gradient-bands", valanceText: "Harfield's",
      displayGoods: ["mannequin", "appliance-row"], decals: ["open-sign", "hours-decal", "sale-burst"],
      fixtures: ["cabinet-row", "mannequin-stands", "counter"],
      priceBoard: { title: "Floor deals", lines: [["Denim jacket", "$39.99"], ["Microwave", "$129"], ["Trainers", "$44.99"]] },
      poster: { headline: "Blue tag event", subline: "Extra twenty percent off" }, footTraffic: 0.75,
    },
    {
      label: "photo-lab", kind: "photo-lab", brand: "Kwik Focus Photo", tagline: "One hour prints and passport photos",
      awningPattern: "solid-canopy", valanceText: "Kwik Focus",
      displayGoods: ["photo-booth", "crt-stack"], decals: ["open-sign", "hours-decal", "price-flash"],
      fixtures: ["counter", "cabinet-row", "chiller"],
      priceBoard: { title: "Finishing", lines: [["One hour prints", "$7.99"], ["Passport photos", "$6.50"], ["Film, 24 exp", "$3.29"]] },
      poster: { headline: "In one hour", subline: "Colour or black and white" }, footTraffic: 0.55,
    },
    {
      label: "sporting-goods", kind: "sporting-goods", brand: "Peakline Sporting Goods", tagline: "Rackets, skates and team kits",
      awningPattern: "solid-canopy", valanceText: "Peakline",
      displayGoods: ["sporting-rack", "bike-display"], decals: ["open-sign", "sale-burst", "payment-logos"],
      fixtures: ["wall-shelves", "cabinet-row", "counter"],
      priceBoard: { title: "Team kit", lines: [["Trainers", "$54.99"], ["Racket", "$39.95"], ["Skates", "$69.00"]] },
      poster: { headline: "Season stock", subline: "Team discounts" }, footTraffic: 0.6,
    },
    {
      label: "card-shop", kind: "card-shop", brand: "Paper Trail Cards", tagline: "Greetings, stickers and stationery",
      awningPattern: "gradient-bands", valanceText: "Paper Trail",
      displayGoods: ["greeting-cards", "candy-counter"], decals: ["open-sign", "est-band", "sale-burst"],
      fixtures: ["wall-shelves", "counter", "display-cases"],
      priceBoard: { title: "Cards", lines: [["Single card", "$1.25"], ["Boxed set", "$4.99"], ["Stickers", "60\u00a2"]] },
      poster: { headline: "Birthday aisle", subline: "Cards from seventy-five cents" }, footTraffic: 0.5,
    },
  ],
  "2005": [
    {
      label: "coffee-chain", kind: "coffee-bar", brand: "Beanhouse Coffee", tagline: "Espresso, lattes and free refills",
      awningPattern: "solid-canopy", valanceText: "Beanhouse Coffee",
      displayGoods: ["espresso-bar", "sandwich-case"], decals: ["open-sign", "hours-decal", "payment-logos"],
      fixtures: ["espresso-machine", "counter", "display-cases"],
      priceBoard: { title: "Drinks", lines: [["Tall latte", "$3.45"], ["Drip coffee", "$1.85"], ["Muffin", "$2.25"]] },
      poster: { headline: "Morning blend", subline: "Fresh ground every hour" }, footTraffic: 0.95,
    },
    {
      label: "phone-store", kind: "mobile-phone", brand: "Cellpoint Wireless", tagline: "Handsets, plans and accessories",
      awningPattern: "gradient-bands", valanceText: "Cellpoint",
      displayGoods: ["phone-bar", "crt-stack"], decals: ["open-sign", "payment-logos", "price-flash"],
      fixtures: ["cabinet-row", "counter", "display-cases"],
      priceBoard: { title: "Plans", lines: [["Handset", "$79.99"], ["Monthly plan", "$39.99"], ["Car charger", "$19.99"]] },
      poster: { headline: "Free weekend calls", subline: "With any plan" }, footTraffic: 0.8,
    },
    {
      label: "gym", kind: "fitness-studio", brand: "Ironline Fitness", tagline: "Cardio floor, weights and classes",
      awningPattern: "solid-canopy", valanceText: "Ironline Fitness",
      displayGoods: ["gym-rig", "sporting-rack"], decals: ["open-sign", "hours-decal", "sale-burst"],
      fixtures: ["gym-rig", "counter", "chiller"],
      priceBoard: { title: "Membership", lines: [["Day pass", "$12.00"], ["Monthly", "$49.00"], ["Annual", "$399"]] },
      poster: { headline: "Join this month", subline: "No joining fee" }, footTraffic: 0.7,
    },
    {
      label: "internet-cafe", kind: "internet-cafe", brand: "Pixelforge Internet Cafe", tagline: "Broadband terminals by the hour",
      awningPattern: "gradient-bands", valanceText: "Pixelforge",
      displayGoods: ["internet-terminals", "crt-stack"], decals: ["open-sign", "hours-decal", "payment-logos"],
      fixtures: ["cabinet-row", "counter", "chiller"],
      priceBoard: { title: "Terminals", lines: [["Half hour", "$3.00"], ["Hour", "$5.00"], ["Printing", "20\u00a2"]] },
      poster: { headline: "Broadband", subline: "Print, scan and surf" }, footTraffic: 0.65,
    },
    {
      label: "dvd-rental", kind: "dvd-rental", brand: "Discbox DVD Rental", tagline: "Three nights, no late fees on Tuesdays",
      awningPattern: "solid-canopy", valanceText: "Discbox",
      displayGoods: ["dvd-shelves", "crt-stack"], decals: ["open-sign", "hours-decal", "sale-burst"],
      fixtures: ["wall-shelves", "crt-wall", "counter"],
      priceBoard: { title: "Three nights", lines: [["New release", "$4.50"], ["Box set", "$9.00"], ["Weekly pass", "$14.99"]] },
      poster: { headline: "Two for Tuesday", subline: "Second rental half price" }, footTraffic: 0.7,
    },
    {
      label: "convenience", kind: "convenience", brand: "Quickstop Corner Market", tagline: "Open twenty-four hours",
      awningPattern: "solid-canopy", valanceText: "Quickstop",
      displayGoods: ["sandwich-case", "candy-counter"], decals: ["hours-decal", "payment-logos", "price-flash"],
      fixtures: ["chiller", "wall-shelves", "counter"],
      priceBoard: { title: "Grab and go", lines: [["Sandwich", "$4.25"], ["Soda, large", "$1.79"], ["Snack bar", "$1.29"]] },
      poster: { headline: "Open all night", subline: "Hot coffee round the clock" }, footTraffic: 0.85,
    },
    {
      label: "hair-salon", kind: "hair-salon", brand: "Chopshop Hair Studio", tagline: "Cuts, colour and blowouts",
      awningPattern: "gradient-bands", valanceText: "Chopshop",
      displayGoods: ["salon-station", "greeting-cards"], decals: ["open-sign", "est-band", "price-flash"],
      fixtures: ["counter", "display-cases", "chiller"],
      priceBoard: { title: "Services", lines: [["Cut and finish", "$34.00"], ["Colour", "$79.00"], ["Blow dry", "$22.00"]] },
      poster: { headline: "Walk-ins today", subline: "Colour from fifty-nine dollars" }, footTraffic: 0.6,
    },
    {
      label: "electronics", kind: "electronics", brand: "Megahertz Electronics", tagline: "Flat panels, MP3 players and cables",
      awningPattern: "solid-canopy", valanceText: "Megahertz",
      displayGoods: ["crt-stack", "phone-bar"], decals: ["open-sign", "payment-logos", "sale-burst"],
      fixtures: ["cabinet-row", "crt-wall", "counter"],
      priceBoard: { title: "Deals", lines: [["Flat panel", "$899"], ["MP3 player", "$129"], ["Cable kit", "$24.99"]] },
      poster: { headline: "Flat panels", subline: "Interest free for a year" }, footTraffic: 0.65,
    },
    {
      label: "sandwich-bar", kind: "sandwich-bar", brand: "Breadline Sandwich Bar", tagline: "Made to order on fresh bread",
      awningPattern: "solid-canopy", valanceText: "Breadline",
      displayGoods: ["sandwich-case", "espresso-bar"], decals: ["open-sign", "hours-decal", "price-flash"],
      fixtures: ["counter", "chiller", "display-cases"],
      priceBoard: { title: "Lunch", lines: [["Hot sandwich", "$5.95"], ["Salad box", "$6.50"], ["Soup", "$3.75"]] },
      poster: { headline: "Lunch deal", subline: "Sandwich, drink and crisps" }, footTraffic: 0.9,
    },
  ],
  "2025": [
    {
      label: "coworking-hub", kind: "coworking", brand: "Nexus Coworking Hub", tagline: "Desks, studios and standing meetings",
      awningPattern: "solar-scrim", valanceText: "Nexus",
      displayGoods: ["cowork-desks", "plant-shelves"], decals: ["open-sign", "leaf-badge", "vinyl-band"],
      fixtures: ["work-benches", "counter", "grow-racks"],
      priceBoard: { title: "Membership", lines: [["Day desk", "$29"], ["Hot desk", "$249/mo"], ["Studio", "$690/mo"]] },
      poster: { headline: "Flexible desks", subline: "Month to month" }, footTraffic: 0.7,
    },
    {
      label: "robotics-lab", kind: "phone-repair", brand: "Servo Works Robotics Lab", tagline: "Repairs, prototypes and open evenings",
      awningPattern: "solar-scrim", valanceText: "Servo Works",
      displayGoods: ["robot-arm", "seed-tray-wall"], decals: ["open-sign", "vinyl-graphic", "token-sticker"],
      fixtures: ["work-benches", "cabinet-row", "grow-racks"],
      priceBoard: { title: "Workshop", lines: [["Diagnostic", "$45"], ["Board swap", "$120"], ["Prototype hour", "$85"]] },
      poster: { headline: "Open lab night", subline: "Thursdays from six" }, footTraffic: 0.55,
    },
    {
      label: "vertical-farm-grocer", kind: "zero-waste-grocer", brand: "Aerofield Vertical Farm Grocer", tagline: "Leafy greens grown three floors up",
      awningPattern: "solar-scrim", valanceText: "Aerofield",
      displayGoods: ["seed-tray-wall", "plant-shelves", "can-pyramid"], decals: ["open-sign", "leaf-badge", "price-flash"],
      fixtures: ["grow-racks", "chiller", "counter"],
      priceBoard: { title: "Refill prices", lines: [["Salad mix, 200g", "$4.20"], ["Herbs, bunch", "$2.60"], ["Refill oats, kg", "$3.90"]] },
      poster: { headline: "Grown upstairs", subline: "Picked the same morning" }, footTraffic: 0.85,
    },
    {
      label: "specialty-coffee", kind: "specialty-coffee", brand: "Third Wave Roastery", tagline: "Single origin filter and oat flat whites",
      awningPattern: "solar-scrim", valanceText: "Third Wave",
      displayGoods: ["espresso-bar", "plant-shelves"], decals: ["open-sign", "coffee-ring", "payment-logos"],
      fixtures: ["espresso-machine", "counter", "display-cases"],
      priceBoard: { title: "Filter bar", lines: [["Batch brew", "$4.50"], ["Flat white", "$5.20"], ["Beans, 250g", "$18.00"]] },
      poster: { headline: "Single origin", subline: "Roasted on the block" }, footTraffic: 0.95,
    },
    {
      label: "plant-shop", kind: "plant-shop", brand: "Fern & Fable Plant Shop", tagline: "Houseplants, pots and advice",
      awningPattern: "solar-scrim", valanceText: "Fern & Fable",
      displayGoods: ["plant-shelves", "seed-tray-wall"], decals: ["open-sign", "leaf-badge", "vinyl-band"],
      fixtures: ["grow-racks", "counter", "display-cases"],
      priceBoard: { title: "Plants", lines: [["Small pot", "$12.00"], ["Statement plant", "$48.00"], ["Pottery", "$22.00"]] },
      poster: { headline: "Propagation swap", subline: "Bring a cutting" }, footTraffic: 0.6,
    },
    {
      label: "micro-bakery", kind: "micro-bakery", brand: "Sourdough Society", tagline: "Long ferment loaves and pastries",
      awningPattern: "solar-scrim", valanceText: "Sourdough Society",
      displayGoods: ["sourdough-racks", "sandwich-case"], decals: ["open-sign", "hours-decal", "price-flash"],
      fixtures: ["counter", "chiller", "display-cases"],
      priceBoard: { title: "Bakery", lines: [["Country loaf", "$8.50"], ["Croissant", "$4.20"], ["Focaccia", "$9.00"]] },
      poster: { headline: "Baked at dawn", subline: "Sourdough daily" }, footTraffic: 0.85,
    },
    {
      label: "bike-shop", kind: "bike-shop", brand: "Cadence Bike Works", tagline: "Cargo bikes, servicing and same-day repairs",
      awningPattern: "solar-scrim", valanceText: "Cadence",
      displayGoods: ["bike-display", "robot-arm"], decals: ["open-sign", "hours-decal", "price-flash"],
      fixtures: ["work-benches", "cabinet-row", "counter"],
      priceBoard: { title: "Workshop", lines: [["Tune up", "$95"], ["Brake service", "$55"], ["E-bike service", "$140"]] },
      poster: { headline: "Same-day repairs", subline: "Book the stand online" }, footTraffic: 0.6,
    },
    {
      label: "thrift-resale", kind: "thrift-resale", brand: "Loop Thrift & Resale", tagline: "Sorted, repaired, recirculated",
      awningPattern: "solar-scrim", valanceText: "Loop Thrift",
      displayGoods: ["thrift-rail", "mannequin"], decals: ["open-sign", "sale-burst", "payment-logos"],
      fixtures: ["mannequin-stands", "counter", "wall-shelves"],
      priceBoard: { title: "Rails", lines: [["Coats", "$24.00"], ["Knitwear", "$14.00"], ["Books", "$4.00"]] },
      poster: { headline: "Trade your rail", subline: "Credit for clean clothing" }, footTraffic: 0.65,
    },
    {
      label: "clinic", kind: "clinic", brand: "Wellspring Community Clinic", tagline: "Walk-in checks and vaccinations",
      awningPattern: "solar-scrim", valanceText: "Wellspring",
      displayGoods: ["clinic-booth", "plant-shelves"], decals: ["hours-decal", "leaf-badge", "vinyl-band"],
      fixtures: ["clinic-screen", "counter", "chiller"],
      priceBoard: { title: "Appointments", lines: [["Walk-in check", "$0"], ["Vaccination", "$0"], ["Travel advice", "$15"]] },
      poster: { headline: "Drop-in clinic", subline: "Weekdays, no booking" }, footTraffic: 0.7,
    },
  ],
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function buildCatalogue(): Readonly<Record<EraId, readonly ShopProgramme[]>> {
  const catalogue = {} as Record<EraId, readonly ShopProgramme[]>;
  for (const era of ERA_IDS) {
    const config = erasById()[era];
    const signStyles = config.storefronts.signStyles;
    catalogue[era] = PROGRAMME_SEEDS[era].map((seed, index) => {
      const signStyle = signStyles[index % signStyles.length] ?? signStyles[0]!;
      return {
        ...seed,
        id: `${era}-${slug(seed.label)}`,
        era,
        signStyle,
        structure: signStructureFor(signStyle),
      };
    });
  }
  return catalogue;
}

let eraIndexCache: Readonly<Record<EraId, EraConfig>> | null = null;

function erasById(): Readonly<Record<EraId, EraConfig>> {
  if (!eraIndexCache) {
    const index = {} as Record<EraId, EraConfig>;
    for (const era of ERAS) {
      index[era.id] = era;
    }
    eraIndexCache = index;
  }
  return eraIndexCache;
}

/** The full era shop mix: nine invented, period-plausible identities per era. */
export const ERA_SHOP_PROGRAMMES: Readonly<Record<EraId, readonly ShopProgramme[]>> = buildCatalogue();

/**
 * Shop programmes the brief requires for each era, best frontage first.
 *
 * These labels are asserted to exist in the catalogue and to appear on the block
 * for the matching timeline stop.
 */
export const REQUIRED_ERA_SHOP_LABELS: Readonly<Record<EraId, readonly string[]>> = {
  "1945": ["diner", "barber", "tobacconist", "grocer"],
  "1965": ["record-shop", "soda-fountain", "clothing-boutique"],
  "1985": ["arcade", "video-rental", "electronics"],
  "2005": ["coffee-chain", "phone-store", "gym"],
  "2025": ["coworking-hub", "robotics-lab", "vertical-farm-grocer"],
};

/** Shop programmes of one era, best frontages first. */
export function shopProgrammesFor(era: EraId): readonly ShopProgramme[] {
  return ERA_SHOP_PROGRAMMES[era];
}

/**
 * Validates the catalogue against the era contract and the brief.
 *
 * Returns a list of human-readable problems; an empty list means the mix is
 * grounded in the real era descriptors: every `kind` and `signStyle` exists in
 * that era, awning patterns match the era's awning structure, the required shop
 * programmes are present first, and brands are invented and unique.
 */
export function validateStorefrontCatalogue(eras: readonly EraConfig[] = ERAS): readonly string[] {
  const problems: string[] = [];
  const brands = new Map<string, string>();
  for (const era of eras) {
    const programmes = ERA_SHOP_PROGRAMMES[era.id];
    if (!programmes || programmes.length === 0) {
      problems.push(`Era ${era.id} has no shop programmes.`);
      continue;
    }
    const labels = new Set(programmes.map((programme) => programme.label));
    for (const required of REQUIRED_ERA_SHOP_LABELS[era.id] ?? []) {
      if (!labels.has(required)) {
        problems.push(`Era ${era.id} is missing the required programme "${required}".`);
      }
    }
    const kinds = new Set<StorefrontKind>(era.storefronts.kinds);
    const signStyles = new Set<SignStyle>(era.storefronts.signStyles);
    const awningKind = awningKindFor(era);
    for (const [index, programme] of programmes.entries()) {
      if (programme.era !== era.id) {
        problems.push(`Programme ${programme.id} claims era ${programme.era} inside ${era.id}.`);
      }
      if (programme.id !== `${era.id}-${slug(programme.label)}`) {
        problems.push(`Programme ${programme.id} has a non-canonical id for "${programme.label}".`);
      }
      if (!kinds.has(programme.kind)) {
        problems.push(`Programme ${programme.id} uses kind "${programme.kind}" outside the ${era.id} retail mix.`);
      }
      if (!signStyles.has(programme.signStyle)) {
        problems.push(`Programme ${programme.id} uses sign style "${programme.signStyle}" outside the ${era.id} techniques.`);
      }
      if (awningPatternMismatch(awningKind, programme.awningPattern)) {
        problems.push(`Programme ${programme.id} uses awning pattern "${programme.awningPattern}" with a ${awningKind} awning.`);
      }
      if (programme.displayGoods.length === 0) {
        problems.push(`Programme ${programme.id} has no window goods.`);
      }
      if (programme.decals.length < 2) {
        problems.push(`Programme ${programme.id} has fewer than two decals.`);
      }
      if (programme.priceBoard.lines.length < 2) {
        problems.push(`Programme ${programme.id} has fewer than two price board lines.`);
      }
      if (programme.brand.length === 0 || programme.tagline.length === 0) {
        problems.push(`Programme ${programme.id} is missing brand or tagline text.`);
      }
      const previous = brands.get(programme.brand);
      if (previous) {
        problems.push(`Brand "${programme.brand}" is reused by ${previous} and ${programme.id}.`);
      }
      brands.set(programme.brand, programme.id);
      if (REQUIRED_ERA_SHOP_LABELS[era.id]?.[index] === undefined) {
        continue;
      }
    }
  }
  return problems;
}

const FABRIC_PATTERNS: readonly AwningPattern[] = ["vertical-stripes", "wide-bands", "solar-scrim"];

function awningPatternMismatch(kind: AwningKind, pattern: AwningPattern): boolean {
  const isFabric = FABRIC_PATTERNS.includes(pattern);
  return kind === "fabric-striped" ? !isFabric : isFabric;
}

/* -------------------------------------------------------------------------- */
/* Era facade styling                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Facade proportions, awning geometry and material age for one era.
 *
 * Everything the era descriptor does not already carry (storey heights, mullion
 * pitch, awning depth and pitch, cornice depth, wear level) lives here as a
 * single documented table keyed by `EraId`, so shopfronts grow taller, flatter
 * and cleaner along the timeline while colours, signage, retail mix and glow
 * keep coming from the shared era contract.
 */
export interface EraFacadeStyle {
  readonly label: string;
  /** Ground-floor storey height in metres. */
  readonly facadeHeight: number;
  /** Height of the glazing + door band. */
  readonly storefrontHeight: number;
  readonly transomHeight: number;
  readonly corniceDepth: number;
  readonly corniceHeight: number;
  readonly pilasterWidth: number;
  readonly kickPlateHeight: number;
  readonly mullionSpacing: number;
  readonly interiorDepth: number;
  readonly awningDepth: number;
  readonly awningDrop: number;
  readonly awningPitch: number;
  readonly signHeight: number;
  readonly hangingSign: number;
  readonly material: "brick" | "limestone" | "stucco" | "granite" | "steel" | "glass" | "timber";
  /** 0..1 material age driving the worn/new overlay. */
  readonly wear: number;
  /** Kind of edge light the era puts on its awning. */
  readonly canopyLight: "none" | "bulbs" | "neon" | "led" | "solar";
}

/** Era storefront styling table; see {@link EraFacadeStyle}. */
export const ERA_FACADE_STYLE: Readonly<Record<EraId, EraFacadeStyle>> = {
  "1945": {
    label: "Sooted painted timber shopfronts", facadeHeight: 4.2, storefrontHeight: 2.85, transomHeight: 0.7,
    corniceDepth: 0.5, corniceHeight: 0.36, pilasterWidth: 0.7, kickPlateHeight: 0.5,
    mullionSpacing: 1.05, interiorDepth: 2.6, awningDepth: 1.5, awningDrop: 0.9, awningPitch: 0.26,
    signHeight: 0.7, hangingSign: 0.62, material: "brick", wear: 0.72, canopyLight: "bulbs",
  },
  "1965": {
    label: "Bright googie panels under backlit fascia", facadeHeight: 4.6, storefrontHeight: 3.15, transomHeight: 0.85,
    corniceDepth: 0.62, corniceHeight: 0.3, pilasterWidth: 0.6, kickPlateHeight: 0.42,
    mullionSpacing: 1.2, interiorDepth: 3.1, awningDepth: 1.7, awningDrop: 1, awningPitch: 0.22,
    signHeight: 0.85, hangingSign: 0.7, material: "stucco", wear: 0.42, canopyLight: "bulbs",
  },
  "1985": {
    label: "Chrome frames, mirrored spandrels and neon blades", facadeHeight: 4.9, storefrontHeight: 3.4, transomHeight: 0.95,
    corniceDepth: 0.4, corniceHeight: 0.26, pilasterWidth: 0.5, kickPlateHeight: 0.36,
    mullionSpacing: 1.35, interiorDepth: 3.5, awningDepth: 1.35, awningDrop: 0.62, awningPitch: 0.08,
    signHeight: 0.95, hangingSign: 0.78, material: "steel", wear: 0.58, canopyLight: "neon",
  },
  "2005": {
    label: "Flush aluminium frames and lightbox fascia", facadeHeight: 5.1, storefrontHeight: 3.6, transomHeight: 1.05,
    corniceDepth: 0.34, corniceHeight: 0.24, pilasterWidth: 0.42, kickPlateHeight: 0.3,
    mullionSpacing: 1.5, interiorDepth: 4, awningDepth: 1.2, awningDrop: 0.5, awningPitch: 0.06,
    signHeight: 1.05, hangingSign: 0.84, material: "glass", wear: 0.3, canopyLight: "led",
  },
  "2025": {
    label: "Deep timber reveals, solar scrims and e-ink panels", facadeHeight: 5.4, storefrontHeight: 3.9, transomHeight: 1.1,
    corniceDepth: 0.5, corniceHeight: 0.2, pilasterWidth: 0.38, kickPlateHeight: 0.24,
    mullionSpacing: 1.7, interiorDepth: 4.4, awningDepth: 1.55, awningDrop: 0.72, awningPitch: 0.16,
    signHeight: 1.1, hangingSign: 0.9, material: "timber", wear: 0.12, canopyLight: "solar",
  },
};

/** Facade styling for `era`. */
export function facadeStyleFor(era: EraId): EraFacadeStyle {
  return ERA_FACADE_STYLE[era];
}

/* -------------------------------------------------------------------------- */
/* Morph channels                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Shared morph channels: the values `applyEra(era, blend)` lerps continuously.
 *
 * Colours are `0xRRGGBB` integers, everything else is metric or `0..1`. Both
 * variants alive during a blend receive the same lerped channel set, so a shop
 * identity fades out of one era's geometry and into the next while the block's
 * tint, awning depth, glazing share, glow and material age slide between stops.
 */
export interface StorefrontMorphChannels {
  readonly facadeTint: number;
  readonly accentTint: number;
  readonly awningTint: number;
  readonly signGlow: number;
  readonly signEmissive: number;
  readonly interiorGlow: number;
  readonly glazingFraction: number;
  readonly awningDepth: number;
  readonly awningDrop: number;
  readonly signHeight: number;
  readonly wear: number;
}

const CHANNEL_KEYS = [
  "facadeTint",
  "accentTint",
  "awningTint",
  "signGlow",
  "signEmissive",
  "interiorGlow",
  "glazingFraction",
  "awningDepth",
  "awningDrop",
  "signHeight",
  "wear",
] as const satisfies readonly (keyof StorefrontMorphChannels)[];

const COLOR_CHANNELS = new Set<keyof StorefrontMorphChannels>(["facadeTint", "accentTint", "awningTint", "signGlow"]);

/** Linear interpolation of every morph channel. */
export function lerpMorphChannels(
  from: StorefrontMorphChannels,
  to: StorefrontMorphChannels,
  blend: number,
): StorefrontMorphChannels {
  const t = clamp01(blend);
  const result = {} as Record<keyof StorefrontMorphChannels, number>;
  for (const key of CHANNEL_KEYS) {
    result[key] = COLOR_CHANNELS.has(key) ? mixHex(from[key], to[key], t) : from[key] + (to[key] - from[key]) * t;
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

export interface DisplayGoodPlan {
  readonly form: DisplayGoodForm;
  readonly spec: DisplayGoodSpec;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface DecalPlan {
  readonly kind: DecalKind;
  readonly placement: DecalPlacement;
  readonly recipe: DecalRecipe;
  readonly width: number;
  readonly height: number;
  readonly x: number;
  readonly y: number;
}

/** Every count the builder must realize; the variant reports the built values. */
export interface StorefrontDetailCounts {
  readonly mullions: number;
  readonly scallops: number;
  readonly decals: number;
  readonly displayGoods: number;
  readonly displayInstances: number;
  readonly channelLetters: number;
  readonly signMarks: number;
  readonly fixtures: number;
  readonly fixtureInstances: number;
  readonly boardPlanks: number;
  readonly textures: number;
}

export interface StorefrontPlan {
  readonly id: string;
  readonly era: EraId;
  readonly lotId: string;
  readonly lotName: string;
  readonly streetSide: BuildingLot["streetSide"];
  readonly frontage: BuildingLot["frontage"];
  readonly rank: number;
  readonly programme: ShopProgramme;
  /** True when this frontage trades in this era; otherwise it is boarded. */
  readonly trading: boolean;
  readonly facade: Readonly<{
    width: number;
    height: number;
    panelThickness: number;
    storefrontHeight: number;
    transomHeight: number;
    corniceDepth: number;
    corniceHeight: number;
    pilasterWidth: number;
    kickPlateHeight: number;
    interiorDepth: number;
    material: EraFacadeStyle["material"];
  }>;
  readonly glazing: Readonly<{ width: number; height: number; mullionCount: number; frameThickness: number }>;
  readonly door: Readonly<{ width: number; height: number; offsetX: number; stepHeight: number }>;
  readonly awning: Readonly<{
    kind: AwningKind;
    pattern: AwningPattern;
    valanceKind: ValanceKind;
    width: number;
    depth: number;
    drop: number;
    pitch: number;
    mountHeight: number;
    valanceHeight: number;
    scallopCount: number;
    scallopRadius: number;
    supportArms: number;
    recipe: AwningRecipe;
  }>;
  readonly signage: Readonly<{
    structure: SignStructure;
    signStyle: SignStyle;
    brand: string;
    letterCount: number;
    channelLetterCount: number;
    signMarks: number;
    transomWidth: number;
    transomHeight: number;
    hangingWidth: number;
    hangingHeight: number;
    hangingDrop: number;
    hasBlade: boolean;
    bladeWidth: number;
    bladeHeight: number;
    transom: SignageRecipe;
    hanging: SignageRecipe;
    blade: SignageRecipe | null;
  }>;
  readonly priceBoard: Readonly<{
    recipe: PriceBoardRecipe;
    width: number;
    height: number;
    mountHeight: number;
    x: number;
  }>;
  readonly windowGlass: WindowGlassRecipe;
  readonly poster: PosterRecipe;
  readonly displayGoods: readonly DisplayGoodPlan[];
  readonly decals: readonly DecalPlan[];
  readonly wear: WearRecipe;
  readonly interior: Readonly<{
    glowColor: number;
    glowIntensity: number;
    fixtures: readonly InteriorFixture[];
    fixtureInstances: number;
  }>;
  readonly channels: StorefrontMorphChannels;
  readonly textures: readonly TexturePaintPlan[];
  readonly detailCounts: StorefrontDetailCounts;
}

export interface StorefrontPlanInput {
  readonly lot: BuildingLot;
  readonly era: EraConfig;
  readonly programme: ShopProgramme;
  readonly rank: number;
  readonly unitCount: number;
}

/** Deterministic 0..1 hash used for per-lot variation without randomness. */
function hash01(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/** Ranks lots so earlier programmes land on the widest frontages. */
export function rankLots(lots: readonly BuildingLot[]): ReadonlyMap<string, number> {
  const ordered = [...lots].sort((left, right) => {
    if (right.frontageWidth !== left.frontageWidth) {
      return right.frontageWidth - left.frontageWidth;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
  return new Map(ordered.map((lot, index) => [lot.id, index]));
}

function placementFor(kind: DecalKind): DecalPlacement {
  return kind === "est-band" ? "kick-plate" : kind === "hours-decal" || kind === "open-sign" ? "door" : "glass";
}

function decalTextFor(
  kind: DecalKind,
  era: EraConfig,
  programme: ShopProgramme,
): Readonly<{ text: string; subtext: string }> {
  const hours = era.storefronts.hours;
  const closing = hours.closeHour > 12 ? `${hours.closeHour - 12}pm` : `${hours.closeHour}am`;
  switch (kind) {
    case "open-sign":
      return { text: "Open", subtext: `Until ${closing}` };
    case "hours-decal":
      return { text: `Hours ${hours.openHour}-${hours.closeHour}`, subtext: "Closed Sundays" };
    case "payment-logos":
      return era.id === "1945" || era.id === "1965"
        ? { text: "Cash only", subtext: "Charge accounts welcome" }
        : { text: "Citypay - Mobe", subtext: "Tap accepted" };
    case "vinyl-band":
      return { text: programme.brand, subtext: "" };
    case "soap-sign":
      return { text: "Washed in soft water", subtext: "Soap supplied" };
    case "coffee-ring":
      return { text: "Single origin", subtext: "Roasted weekly" };
    case "leaf-badge":
      return { text: "Local produce", subtext: "Grown nearby" };
    case "sale-burst":
      return { text: "Sale", subtext: "This week" };
    case "token-sticker":
      return { text: "Tokens 25c", subtext: "Change at the desk" };
    case "price-flash":
      return {
        text: programme.priceBoard.lines[0]?.[1] ?? "Best price",
        subtext: programme.priceBoard.lines[0]?.[0] ?? "Today",
      };
    case "est-band":
      return { text: `Est. ${era.year}`, subtext: programme.tagline };
    case "vinyl-graphic":
      return { text: programme.brand, subtext: programme.tagline };
  }
}

/** Counts the light marks an era's sign decorations add to one sign. */
function signMarkCount(recipe: SignageRecipe, signWidthMetres: number): number {
  let total = 0;
  for (const decoration of recipe.decorations) {
    const widthMetres = (decoration.width / recipe.canvas.width) * signWidthMetres;
    switch (decoration.kind) {
      case "bulb-row":
        total += Math.max(3, Math.round(widthMetres / 0.34));
        break;
      case "neon-tube":
      case "sunburst":
        total += 4;
        break;
      case "speed-lines":
        total += 3;
        break;
      case "arrow":
      case "cup":
      case "leaf":
      case "led-strip":
      case "greek-key":
        total += 1;
        break;
    }
  }
  return total;
}

function fixtureInstanceCount(fixtures: readonly InteriorFixture[], glazingWidth: number): number {
  let total = 0;
  for (const fixture of fixtures) {
    switch (fixture) {
      case "wall-shelves":
      case "record-bins":
      case "grow-racks":
      case "crt-wall":
        total += 4;
        break;
      case "arcade-row":
      case "cabinet-row":
        total += Math.max(2, Math.round(glazingWidth / 2.2));
        break;
      case "mannequin-stands":
        total += 2;
        break;
      case "booths":
        total += 2;
        break;
      case "gym-rig":
        total += 3;
        break;
      default:
        total += 1;
        break;
    }
  }
  return total;
}

function texturePlan(
  slot: StorefrontTextureSlot,
  recipeId: string,
  canvas: Readonly<{ width: number; height: number }>,
  paint: (ctx: CanvasRenderingContext2D) => PaintReport,
  options: Readonly<{ repeat?: readonly [number, number]; fallbackColor?: number }> = {},
): TexturePaintPlan {
  return {
    recipeId,
    slot,
    width: canvas.width,
    height: canvas.height,
    repeat: options.repeat,
    fallbackColor: options.fallbackColor ?? 0x8a8a8a,
    paint,
  };
}

/**
 * Pure storefront plan: every size, count, texture recipe and morph channel for
 * one lot in one era. The builder consumes this directly, so the numbers tests
 * inspect are the numbers that get built.
 */
export function planStorefront(input: StorefrontPlanInput): StorefrontPlan {
  const { lot, era, programme } = input;
  const style = facadeStyleFor(era.id);
  const storefronts = era.storefronts;
  const awningKind = awningKindFor(era);
  const awningValance = valanceKindFor(awningKind);

  const facadeWidth = lot.frontageWidth;
  const glazingWidth = Math.max(2, facadeWidth - style.pilasterWidth * 2);
  const glazingHeight = style.storefrontHeight - style.kickPlateHeight;
  const mullionCount = Math.max(3, Math.round(glazingWidth / style.mullionSpacing));
  const doorWidth = Math.min(1.5, Math.max(0.95, facadeWidth * 0.16));
  const doorHeight = Math.min(glazingHeight + 0.2, 2.35);
  const doorOffsetX = glazingWidth / 2 - doorWidth / 2;
  const awningWidth = glazingWidth + style.pilasterWidth;
  const scallopRadius = style.awningDrop * 0.22;
  const scallopCount = awningValance === "scalloped"
    ? Math.max(4, Math.round(awningWidth / (scallopRadius * 2.6)))
    : 0;
  const awningMount = style.kickPlateHeight + glazingHeight - 0.12;

  const recipeBase = `${era.id}:${programme.id}`;
  const transomWidth = glazingWidth * 0.94;
  const transomHeight = Math.min(style.transomHeight * 0.92, 1.1);
  const transom = planSignageRecipe({
    id: `${recipeBase}:transom-sign`,
    era,
    slot: "transom-sign",
    brand: programme.brand,
    tagline: programme.tagline,
    signStyle: programme.signStyle,
  });
  const hanging = planSignageRecipe({
    id: `${recipeBase}:hanging-sign`,
    era,
    slot: "hanging-sign",
    brand: programme.brand,
    tagline: programme.tagline,
    signStyle: programme.signStyle,
  });
  const blade = programme.structure === "blade-marquee" || programme.structure === "projected-scrim"
    ? planSignageRecipe({
      id: `${recipeBase}:projecting-sign`,
      era,
      slot: "projecting-sign",
      brand: programme.brand,
      tagline: programme.tagline,
      signStyle: programme.signStyle,
    })
    : null;
  const hangingWidth = Math.min(1.1, facadeWidth * 0.16);
  const hangingHeight = Math.min(style.hangingSign, hangingWidth * 1.15);

  const awning = planAwningRecipe({
    id: `${recipeBase}:awning`,
    era,
    pattern: programme.awningPattern,
    text: programme.valanceText,
    wear: style.wear,
  });
  const windowGlass = planWindowGlassRecipe({
    id: `${recipeBase}:window-glass`,
    era,
    poster: programme.poster.headline,
    glow: storefronts.interiorGlow,
  });
  const poster = planPosterRecipe({
    id: `${recipeBase}:window-poster`,
    era,
    headline: programme.poster.headline,
    subline: programme.poster.subline,
  });
  const priceBoard = planPriceBoardRecipe({
    id: `${recipeBase}:price-board`,
    era,
    title: programme.priceBoard.title,
    lines: programme.priceBoard.lines.map(([label, price]): PriceBoardLine => ({ label, price })),
  });
  const wear = planWearRecipe({ id: `${recipeBase}:wear`, era, level: style.wear });

  const decals: DecalPlan[] = programme.decals.map((kind, index) => {
    const placement = placementFor(kind);
    const text = decalTextFor(kind, era, programme);
    const recipe = planDecalRecipe({
      id: `${recipeBase}:decal-${kind}`,
      era,
      kind,
      placement,
      text: text.text,
      subtext: text.subtext,
      wear: style.wear,
    });
    const size = decalSize(placement, kind, glazingWidth, doorWidth);
    const x = placement === "door" ? doorOffsetX : -glazingWidth * 0.28 + index * 0.12;
    const y = placement === "kick-plate"
      ? style.kickPlateHeight * 0.5
      : placement === "door"
        ? 1.55
        : style.kickPlateHeight + glazingHeight * 0.55 - index * 0.18;
    return { kind, placement, recipe, width: size.width, height: size.height, x, y };
  });

  const trading = input.rank < Math.max(1, Math.round(storefronts.occupancy * input.unitCount));
  const boardPlanks = trading ? 0 : 3;
  const displayGoods = planDisplayGoods(programme, glazingWidth, style.kickPlateHeight, glazingHeight);
  const displayInstances = displayGoods.reduce((sum, good) => sum + good.spec.quantity, 0);
  const fixtureInstances = fixtureInstanceCount(programme.fixtures, glazingWidth);
  const channelLetterCount = programme.structure === "channel-letters"
    ? Array.from(programme.brand).filter((glyph) => glyph !== " ").length
    : 0;
  const signMarks = signMarkCount(transom, transomWidth) + signMarkCount(hanging, hangingWidth);

  const facadeTint = mixHex(
    era.palette.facadePrimary,
    era.palette.facadeSecondary,
    0.2 + (input.rank % 3) * 0.18 + hash01(lot.id) * 0.12,
  );
  const awningColors = storefronts.awningColors;
  const awningTint = awningColors[input.rank % Math.max(1, awningColors.length)] ?? era.palette.accent;
  const signEmissive = SIGN_STRUCTURE_GLOW[programme.structure] * (0.55 + 0.45 * (1 - style.wear));

  const channels: StorefrontMorphChannels = {
    facadeTint,
    accentTint: shadeHex(era.palette.accent, style.wear * 0.1),
    awningTint,
    signGlow: era.palette.windowGlow,
    signEmissive,
    interiorGlow: storefronts.interiorGlow,
    glazingFraction: storefronts.glassArea,
    awningDepth: style.awningDepth,
    awningDrop: style.awningDrop,
    signHeight: style.signHeight,
    wear: style.wear,
  };

  const textures: TexturePaintPlan[] = [
    texturePlan("transom-sign", transom.id, transom.canvas, (ctx) => paintSignageRecipe(ctx, transom), { fallbackColor: facadeTint }),
    texturePlan("hanging-sign", hanging.id, hanging.canvas, (ctx) => paintSignageRecipe(ctx, hanging), { fallbackColor: era.palette.accent }),
    texturePlan("awning", awning.id, awning.canvas, (ctx) => paintAwningRecipe(ctx, awning), { repeat: [2, 1], fallbackColor: awningTint }),
    texturePlan("price-board", priceBoard.id, priceBoard.canvas, (ctx) => paintPriceBoardRecipe(ctx, priceBoard), { fallbackColor: facadeTint }),
    texturePlan("window-glass", windowGlass.id, windowGlass.canvas, (ctx) => paintWindowGlassRecipe(ctx, windowGlass), { fallbackColor: era.palette.windowGlow }),
    texturePlan("window-poster", poster.id, poster.canvas, (ctx) => paintPosterRecipe(ctx, poster), { fallbackColor: era.palette.accent }),
    texturePlan("wear", wear.id, wear.canvas, (ctx) => paintWearRecipe(ctx, wear), { fallbackColor: facadeTint }),
  ];
  if (blade) {
    textures.push(texturePlan(
      "projecting-sign",
      blade.id,
      blade.canvas,
      (ctx) => paintSignageRecipe(ctx, blade),
      { fallbackColor: era.palette.uiAccent },
    ));
  }
  for (const decal of decals) {
    const slot: StorefrontTextureSlot = decal.kind === "est-band"
      ? "kick-band"
      : decal.placement === "door"
        ? "door-decal"
        : "glass-vinyl";
    textures.push(texturePlan(
      slot,
      decal.recipe.id,
      decal.recipe.canvas,
      (ctx) => paintDecalRecipe(ctx, decal.recipe),
      { fallbackColor: era.palette.accent },
    ));
  }

  return {
    id: `${lot.id}-storefront`,
    era: era.id,
    lotId: lot.id,
    lotName: lot.name,
    streetSide: lot.streetSide,
    frontage: lot.frontage,
    rank: input.rank,
    programme,
    trading,
    facade: {
      width: facadeWidth,
      height: style.facadeHeight,
      panelThickness: FACADE_PANEL_THICKNESS,
      storefrontHeight: style.storefrontHeight,
      transomHeight: style.transomHeight,
      corniceDepth: style.corniceDepth,
      corniceHeight: style.corniceHeight,
      pilasterWidth: style.pilasterWidth,
      kickPlateHeight: style.kickPlateHeight,
      interiorDepth: style.interiorDepth,
      material: style.material,
    },
    glazing: { width: glazingWidth, height: glazingHeight, mullionCount, frameThickness: 0.09 },
    door: { width: doorWidth, height: doorHeight, offsetX: doorOffsetX, stepHeight: 0.12 },
    awning: {
      kind: awningKind,
      pattern: programme.awningPattern,
      valanceKind: awningValance,
      width: awningWidth,
      depth: style.awningDepth,
      drop: style.awningDrop,
      pitch: style.awningPitch,
      mountHeight: awningMount,
      valanceHeight: Math.max(0.18, style.awningDrop * 0.26),
      scallopCount,
      scallopRadius,
      supportArms: facadeWidth > 10 ? 4 : 3,
      recipe: awning,
    },
    signage: {
      structure: programme.structure,
      signStyle: programme.signStyle,
      brand: programme.brand,
      letterCount: Array.from(programme.brand).length,
      channelLetterCount,
      signMarks,
      transomWidth,
      transomHeight,
      hangingWidth,
      hangingHeight,
      hangingDrop: awningMount + 0.55,
      hasBlade: blade !== null,
      bladeWidth: 0.72,
      bladeHeight: 1.5,
      transom,
      hanging,
      blade,
    },
    priceBoard: {
      recipe: priceBoard,
      width: Math.min(0.9, facadeWidth * 0.12),
      height: Math.min(1.15, facadeWidth * 0.15),
      mountHeight: 1.5,
      x: -(facadeWidth / 2 - style.pilasterWidth / 2),
    },
    windowGlass,
    poster,
    displayGoods,
    decals,
    wear,
    interior: {
      glowColor: era.palette.windowGlow,
      glowIntensity: storefronts.interiorGlow,
      fixtures: programme.fixtures,
      fixtureInstances,
    },
    channels,
    textures,
    detailCounts: {
      mullions: mullionCount,
      scallops: scallopCount,
      decals: decals.length,
      displayGoods: displayGoods.length,
      displayInstances,
      channelLetters: channelLetterCount,
      signMarks,
      fixtures: programme.fixtures.length,
      fixtureInstances,
      boardPlanks,
      textures: textures.length,
    },
  };
}

function decalSize(
  placement: DecalPlacement,
  kind: DecalKind,
  glazingWidth: number,
  doorWidth: number,
): Readonly<{ width: number; height: number }> {
  if (placement === "kick-plate") {
    return { width: glazingWidth, height: 0.26 };
  }
  if (placement === "door") {
    return kind === "open-sign"
      ? { width: doorWidth * 0.55, height: doorWidth * 0.28 }
      : { width: doorWidth * 0.8, height: doorWidth * 0.4 };
  }
  return kind === "vinyl-band"
    ? { width: glazingWidth * 0.5, height: 0.3 }
    : { width: Math.min(1.3, glazingWidth * 0.3), height: 0.72 };
}

function planDisplayGoods(
  programme: ShopProgramme,
  glazingWidth: number,
  kickPlateHeight: number,
  glazingHeight: number,
): readonly DisplayGoodPlan[] {
  const count = programme.displayGoods.length;
  const usable = Math.max(1.2, glazingWidth - 0.6);
  const spacing = usable / count;
  return programme.displayGoods.map((form, index) => {
    const spec = DISPLAY_GOOD_SPECS[form];
    const jitter = hash01(`${programme.id}:${form}`) * 0.12;
    const width = Math.min(spec.width, spacing * 0.92);
    const height = Math.min(spec.height, glazingHeight * 0.82);
    return {
      form,
      spec: { ...spec, width, height },
      x: -usable / 2 + spacing * (index + 0.5),
      y: kickPlateHeight + height / 2 + jitter,
      z: -0.55,
    };
  });
}

/** Plans every storefront on the block for one era, best frontages first. */
export function planStorefronts(layout: CityLayout, era: EraConfig): readonly StorefrontPlan[] {
  const ranks = rankLots(layout.lots);
  const programmes = shopProgrammesFor(era.id);
  return layout.lots.map((lot) => {
    const rank = ranks.get(lot.id) ?? 0;
    const programme = programmes[rank % programmes.length] ?? programmes[0]!;
    return planStorefront({ lot, era, programme, rank, unitCount: layout.lots.length });
  });
}

/** Plain-text fingerprint of a plan, used to prove planning is deterministic. */
export function planFingerprint(plan: StorefrontPlan): string {
  return [
    plan.id,
    plan.era,
    plan.programme.id,
    plan.programme.brand,
    plan.programme.signStyle,
    plan.signage.structure,
    plan.trading ? "trading" : "boarded",
    plan.detailCounts.mullions,
    plan.detailCounts.scallops,
    plan.detailCounts.decals,
    plan.detailCounts.displayGoods,
    plan.detailCounts.channelLetters,
    plan.detailCounts.fixtures,
    plan.detailCounts.textures,
    plan.textures.map((texture) => `${texture.slot}:${texture.recipeId}:${texture.width}x${texture.height}`).join("|"),
    plan.channels.facadeTint,
    plan.channels.awningTint,
    Math.round(plan.channels.wear * 1000),
  ].join(";");
}

/* -------------------------------------------------------------------------- */
/* Resource accounting                                                        */
/* -------------------------------------------------------------------------- */

/** Live accounting of GPU resources owned by the storefront system. */
export interface StorefrontResourceLedger {
  readonly createdGeometries: number;
  readonly disposedGeometries: number;
  readonly createdMaterials: number;
  readonly disposedMaterials: number;
}

/**
 * Tracks geometry and material lifetimes through three.js `dispose` events.
 *
 * The counters are the evidence that an era swap really releases the outgoing
 * variant instead of leaving GPU memory behind: tests assert that created and
 * disposed counts meet after the timeline has been walked and torn down.
 */
export class ResourceLedger {
  private createdGeometries = 0;
  private disposedGeometries = 0;
  private createdMaterials = 0;
  private disposedMaterials = 0;

  trackGeometry<T extends THREE.BufferGeometry>(geometry: T): T {
    this.createdGeometries += 1;
    geometry.addEventListener("dispose", () => {
      this.disposedGeometries += 1;
    });
    return geometry;
  }

  trackMaterial<T extends THREE.Material>(material: T): T {
    this.createdMaterials += 1;
    material.addEventListener("dispose", () => {
      this.disposedMaterials += 1;
    });
    return material;
  }

  snapshot(): StorefrontResourceLedger {
    return {
      createdGeometries: this.createdGeometries,
      disposedGeometries: this.disposedGeometries,
      createdMaterials: this.createdMaterials,
      disposedMaterials: this.disposedMaterials,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Variants                                                                   */
/* -------------------------------------------------------------------------- */

/** Counts read back off the built three.js objects for one era variant. */
export interface StorefrontVariantStats {
  readonly meshes: number;
  readonly geometries: number;
  readonly materials: number;
  readonly textures: number;
  readonly mullions: number;
  readonly scallops: number;
  readonly signMarks: number;
  readonly channelLetters: number;
  readonly decals: number;
  readonly displayGoods: number;
  readonly displayInstances: number;
  readonly fixtureInstances: number;
  readonly boardPlanks: number;
  readonly awningKind: AwningKind;
  readonly structure: SignStructure;
}

const FACADE_PANEL_THICKNESS = 0.24;
/** Interior glow multiplier applied on top of the weighted era glow. */
export const STOREFRONT_GLOW_GAIN = 2;
/** Opacity of the worn/new material overlay at full material age. */
export const STOREFRONT_WEAR_OVERLAY_OPACITY = 0.5;
const GLASS_PANE_OPACITY = 0.22;
const BACKDROP_OPACITY = 0.94;

type TintChannel = "facadeTint" | "accentTint" | "awningTint" | "signGlow";
type ScaleChannel = "awningDepth" | "awningDrop" | "signHeight" | "glazingFraction";

interface FadeEntry {
  readonly material: THREE.MeshStandardMaterial;
  readonly baseOpacity: number;
}

interface ScaleBinding {
  readonly object: THREE.Object3D;
  readonly axis: "x" | "y" | "z";
  readonly channel: ScaleChannel;
  readonly reference: number;
}

interface GlowBinding {
  readonly material: THREE.MeshStandardMaterial;
  readonly factor: number;
}

interface MaterialOptions {
  readonly color: number;
  readonly roughness: number;
  readonly metalness: number;
  readonly map?: THREE.Texture | null;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
  readonly emissiveMap?: THREE.Texture | null;
  readonly opacity?: number;
  readonly side?: THREE.Side;
  readonly channel?: TintChannel;
  /** `sign` = follows the era's sign emissive, `interior` = the shop glow driver. */
  readonly role?: "sign" | "interior" | "secondary";
  readonly depthWrite?: boolean;
}

/** Material factory handed to the display/fixture builders. */
export type StorefrontMaterialFactory = (options: MaterialOptions) => THREE.MeshStandardMaterial;

/** Mesh factory handed to the display/fixture builders. */
export type StorefrontMeshFactory = (
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: readonly [number, number, number],
  parent?: THREE.Object3D,
) => THREE.Mesh;

/**
 * One era's built shopfront for one lot.
 *
 * A variant owns its geometry, materials and a reference-counted share of the
 * texture library. `setFade` cross-dissolves it during a morph and
 * `applyChannels` slides the shared morph channels; both are called every frame
 * while the timeline moves, and the unit disposes the variant once the blend
 * completes.
 */
export class StorefrontVariant {
  readonly plan: StorefrontPlan;
  readonly group = new THREE.Group();
  readonly textures: readonly PaintedTexture[];
  readonly stats: StorefrontVariantStats;
  readonly pickables: readonly THREE.Object3D[];

  private readonly library: StorefrontTextureLibrary;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private readonly fadeEntries: FadeEntry[] = [];
  private readonly tintBindings: Readonly<{ material: THREE.MeshStandardMaterial; channel: TintChannel }>[] = [];
  private readonly signEmissives: THREE.MeshStandardMaterial[] = [];
  private readonly interiorGlow: THREE.MeshStandardMaterial[] = [];
  private readonly secondaryGlow: GlowBinding[] = [];
  private readonly scaleBindings: ScaleBinding[] = [];
  private readonly awningGroup: THREE.Group;
  private readonly displayGroup: THREE.Group;
  private readonly signageGroup: THREE.Group;
  private readonly wearMaterial: THREE.MeshStandardMaterial;
  private channels: StorefrontMorphChannels;
  private fadeWeight = 1;
  private glowSignal: number | null = null;
  private glowFlicker = 1;
  private disposed = false;

  constructor(
    plan: StorefrontPlan,
    library: StorefrontTextureLibrary,
    ledger: ResourceLedger,
    textures: readonly PaintedTexture[],
  ) {
    this.plan = plan;
    this.library = library;
    this.textures = textures;
    this.channels = plan.channels;
    const prefix = `${plan.id}:${plan.era}`;
    this.group.name = prefix;
    this.group.userData = { storefrontId: plan.id, lotId: plan.lotId, era: plan.era, brand: plan.programme.brand };

    const textureFor = (slot: StorefrontTextureSlot): THREE.Texture | null => {
      const found = textures.find((texture) => texture.slot === slot);
      return found ? found.texture : null;
    };

    const material = (options: MaterialOptions): THREE.MeshStandardMaterial => {
      const created = ledger.trackMaterial(new THREE.MeshStandardMaterial({
        color: options.color,
        roughness: options.roughness,
        metalness: options.metalness,
        map: options.map ?? null,
        emissive: options.emissive ?? 0x000000,
        emissiveIntensity: options.emissiveIntensity ?? 0,
        emissiveMap: options.emissiveMap ?? null,
        // Fade-capable from the start: the timelapse blend must never trigger a
        // shader recompile in the middle of a morph.
        transparent: true,
        opacity: options.opacity ?? 1,
        depthWrite: options.depthWrite ?? true,
        side: options.side ?? THREE.FrontSide,
      }));
      this.materials.push(created);
      if (options.channel) {
        this.tintBindings.push({ material: created, channel: options.channel });
      }
      if (options.role === "sign") {
        this.signEmissives.push(created);
      } else if (options.role === "interior") {
        this.interiorGlow.push(created);
      } else if (options.role === "secondary") {
        this.secondaryGlow.push({ material: created, factor: options.emissiveIntensity ?? 1 });
      }
      return created;
    };

    const own = <T extends THREE.BufferGeometry>(geometry: T): T => {
      this.geometries.push(ledger.trackGeometry(geometry));
      return geometry;
    };

    const meshes: THREE.Mesh[] = [];
    const mesh: StorefrontMeshFactory = (geometry, meshMaterial, position, parent = this.group) => {
      const created = new THREE.Mesh(own(geometry), meshMaterial);
      created.position.set(position[0], position[1], position[2]);
      created.userData = { storefrontId: plan.id, lotId: plan.lotId, era: plan.era, brand: plan.programme.brand };
      parent.add(created);
      meshes.push(created);
      return created;
    };

    const facadeMaterial = material({
      color: plan.channels.facadeTint,
      roughness: 0.62 + plan.channels.wear * 0.28,
      metalness: 0.03 + (1 - plan.channels.wear) * 0.08,
      channel: "facadeTint",
    });
    const trimMaterial = material({
      color: plan.channels.accentTint,
      roughness: 0.45,
      metalness: 0.25,
      channel: "accentTint",
    });
    const darkMaterial = material({ color: shadeHex(plan.channels.facadeTint, -0.5), roughness: 0.6, metalness: 0.2 });
    const awningMaterial = material({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.02,
      map: textureFor("awning"),
      channel: "awningTint",
    });
    const glassMaterial = material({
      color: shadeHex(plan.channels.signGlow, 0.35),
      roughness: 0.08,
      metalness: 0.3,
      opacity: GLASS_PANE_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const signMaterial = material({
      color: 0xffffff,
      roughness: 0.4,
      metalness: 0.1,
      map: textureFor("transom-sign"),
      emissive: plan.channels.signGlow,
      emissiveIntensity: plan.channels.signEmissive,
      emissiveMap: textureFor("transom-sign"),
      channel: "signGlow",
      role: "sign",
    });
    const signBodyMaterial = material({
      color: shadeHex(plan.channels.facadeTint, -0.35),
      roughness: 0.5,
      metalness: 0.35,
      role: "sign",
    });

    /* Shell: pilasters, kick plate, transom band, spandrel and cornice. */
    const thickness = plan.facade.panelThickness;
    const facadeHeight = plan.facade.height;
    const storefrontHeight = plan.facade.storefrontHeight;
    const transomTop = storefrontHeight + plan.facade.transomHeight;
    const pilasterX = (plan.facade.width - plan.facade.pilasterWidth) / 2;
    for (const sign of [-1, 1]) {
      mesh(
        new THREE.BoxGeometry(plan.facade.pilasterWidth, facadeHeight, thickness),
        facadeMaterial,
        [sign * pilasterX, facadeHeight / 2, -thickness / 2],
      );
    }
    mesh(
      new THREE.BoxGeometry(plan.glazing.width, plan.facade.kickPlateHeight, thickness),
      trimMaterial,
      [0, plan.facade.kickPlateHeight / 2, -thickness / 2],
    ).userData.role = "kick-plate";
    mesh(
      new THREE.BoxGeometry(plan.glazing.width, plan.facade.transomHeight, thickness),
      facadeMaterial,
      [0, storefrontHeight + plan.facade.transomHeight / 2, -thickness / 2],
    );
    mesh(
      new THREE.BoxGeometry(plan.facade.width, facadeHeight - transomTop, thickness),
      facadeMaterial,
      [0, (facadeHeight + transomTop) / 2, -thickness / 2],
    );
    mesh(
      new THREE.BoxGeometry(plan.facade.width, plan.facade.corniceHeight, thickness + plan.facade.corniceDepth),
      trimMaterial,
      [0, facadeHeight - plan.facade.corniceHeight / 2, -thickness / 2 + plan.facade.corniceDepth / 2],
    );

    /* Interior: floor, back wall, glowing ceiling card and lit backdrop. */
    const interiorDepth = plan.facade.interiorDepth;
    mesh(new THREE.BoxGeometry(plan.glazing.width, 0.12, interiorDepth), darkMaterial, [0, 0.06, -interiorDepth / 2 - 0.1]);
    mesh(new THREE.BoxGeometry(plan.glazing.width, storefrontHeight, 0.12), darkMaterial, [0, storefrontHeight / 2, -interiorDepth]);
    const glowCard = mesh(
      new THREE.PlaneGeometry(plan.glazing.width, interiorDepth),
      material({
        color: shadeHex(plan.interior.glowColor, -0.35),
        roughness: 0.9,
        metalness: 0,
        emissive: plan.interior.glowColor,
        emissiveIntensity: plan.interior.glowIntensity,
        role: "interior",
        side: THREE.DoubleSide,
      }),
      [0, storefrontHeight - 0.04, -interiorDepth / 2 - 0.1],
    );
    glowCard.rotation.x = Math.PI / 2;
    glowCard.userData.role = "interior-glow";

    const backdrop = mesh(
      new THREE.PlaneGeometry(plan.glazing.width, plan.glazing.height),
      material({
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0,
        map: textureFor("window-glass"),
        emissive: plan.interior.glowColor,
        emissiveIntensity: plan.interior.glowIntensity,
        emissiveMap: textureFor("window-glass"),
        opacity: BACKDROP_OPACITY,
        role: "interior",
        side: THREE.DoubleSide,
      }),
      [0, plan.facade.kickPlateHeight + plan.glazing.height / 2, -0.42],
    );
    backdrop.userData.role = "window-backdrop";

    this.displayGroup = new THREE.Group();
    this.displayGroup.name = `${prefix}:display`;
    this.group.add(this.displayGroup);
    for (const good of plan.displayGoods) {
      buildDisplayGood(good, this.displayGroup, plan, material, mesh, own);
    }
    const displayInstances = plan.displayGoods.reduce((sum, good) => sum + good.spec.quantity, 0);

    const fixtureGroup = new THREE.Group();
    fixtureGroup.name = `${prefix}:fixtures`;
    this.group.add(fixtureGroup);
    let fixtureInstances = 0;
    for (const fixture of plan.interior.fixtures) {
      fixtureInstances += buildFixture(fixture, fixtureGroup, plan, material, mesh, own);
    }

    /* Glazing: pane, head/sill frame and the mullion run. */
    const glazingCentre = plan.facade.kickPlateHeight + plan.glazing.height / 2;
    mesh(new THREE.PlaneGeometry(plan.glazing.width, plan.glazing.height), glassMaterial, [0, glazingCentre, 0.03]);
    for (const y of [plan.facade.kickPlateHeight, plan.facade.kickPlateHeight + plan.glazing.height]) {
      mesh(new THREE.BoxGeometry(plan.glazing.width + 0.14, plan.glazing.frameThickness, 0.16), trimMaterial, [0, y, 0.02]);
    }
    const mullions = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.07, plan.glazing.height, 0.1)), trimMaterial, plan.glazing.mullionCount);
    mullions.name = `${prefix}:mullions`;
    const mullionMatrix = new THREE.Matrix4();
    for (let index = 0; index < plan.glazing.mullionCount; index += 1) {
      const x = plan.glazing.mullionCount > 1
        ? -plan.glazing.width / 2 + (plan.glazing.width / (plan.glazing.mullionCount - 1)) * index
        : 0;
      mullionMatrix.makeTranslation(x, glazingCentre, 0.045);
      mullions.setMatrixAt(index, mullionMatrix);
    }
    mullions.instanceMatrix.needsUpdate = true;
    this.group.add(mullions);

    /* Entrance door with glazing, handle, push plate and threshold. */
    const doorGroup = new THREE.Group();
    doorGroup.name = `${prefix}:door`;
    doorGroup.position.set(plan.door.offsetX, 0, 0);
    this.group.add(doorGroup);
    const doorPanelMaterial = material({ color: shadeHex(plan.channels.facadeTint, -0.25), roughness: 0.5, metalness: 0.15 });
    mesh(
      new THREE.BoxGeometry(plan.door.width + 0.16, plan.door.height + 0.1, thickness * 0.8),
      darkMaterial,
      [0, (plan.door.height + 0.1) / 2, -thickness * 0.4],
      doorGroup,
    );
    mesh(new THREE.BoxGeometry(plan.door.width, plan.door.height, 0.09), doorPanelMaterial, [0, plan.door.height / 2, 0.05], doorGroup);
    mesh(new THREE.PlaneGeometry(plan.door.width * 0.66, plan.door.height * 0.52), glassMaterial, [0, plan.door.height * 0.62, 0.11], doorGroup);
    mesh(new THREE.BoxGeometry(0.05, plan.door.height * 0.34, 0.05), trimMaterial, [-plan.door.width * 0.34, plan.door.height * 0.48, 0.12], doorGroup)
      .userData.role = "door-handle";
    mesh(new THREE.BoxGeometry(plan.door.width * 0.5, 0.14, 0.03), trimMaterial, [0, plan.door.height * 0.08, 0.12], doorGroup)
      .userData.role = "push-plate";
    mesh(new THREE.BoxGeometry(plan.door.width + 0.34, plan.door.stepHeight, 0.5), darkMaterial, [0, plan.door.stepHeight / 2, 0.2], doorGroup)
      .userData.role = "threshold";

    /* Awning: canopy, valance, scallops, supports and edge light. */
    this.awningGroup = new THREE.Group();
    this.awningGroup.name = `${prefix}:awning`;
    this.awningGroup.position.set(0, plan.awning.mountHeight, 0);
    this.group.add(this.awningGroup);
    const canopy = mesh(
      new THREE.BoxGeometry(plan.awning.width, 0.07, plan.awning.depth),
      awningMaterial,
      [0, -plan.awning.drop / 2, plan.awning.depth / 2],
      this.awningGroup,
    );
    canopy.rotation.x = -plan.awning.pitch;
    mesh(
      new THREE.BoxGeometry(plan.awning.width, plan.awning.valanceHeight, 0.06),
      awningMaterial,
      [0, -plan.awning.drop - plan.awning.valanceHeight / 2, plan.awning.depth],
      this.awningGroup,
    ).userData.role = "awning-valance";
    if (plan.awning.scallopCount > 0) {
      const scallops = new THREE.InstancedMesh(
        own(new THREE.CylinderGeometry(plan.awning.scallopRadius, plan.awning.scallopRadius, 0.06, 10, 1, false, 0, Math.PI)),
        material({ color: plan.awning.recipe.stripeHex, roughness: 0.7, metalness: 0.02, channel: "awningTint" }),
        plan.awning.scallopCount,
      );
      scallops.name = `${prefix}:scallops`;
      const scallopMatrix = new THREE.Matrix4();
      const spacing = plan.awning.width / plan.awning.scallopCount;
      for (let index = 0; index < plan.awning.scallopCount; index += 1) {
        scallopMatrix.compose(
          new THREE.Vector3(
            -plan.awning.width / 2 + spacing * (index + 0.5),
            -plan.awning.drop - plan.awning.valanceHeight + plan.awning.scallopRadius * 0.35,
            plan.awning.depth + 0.02,
          ),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2)),
          new THREE.Vector3(1, 1, 1),
        );
        scallops.setMatrixAt(index, scallopMatrix);
      }
      scallops.instanceMatrix.needsUpdate = true;
      this.awningGroup.add(scallops);
    }
    if (plan.awning.kind !== "fabric-striped") {
      mesh(
        new THREE.BoxGeometry(plan.awning.width, 0.09, 0.09),
        material({
          color: 0xffffff,
          roughness: 0.3,
          metalness: 0.1,
          emissive: plan.channels.signGlow,
          emissiveIntensity: plan.channels.signEmissive * 0.4,
          role: "secondary",
        }),
        [0, -plan.awning.drop - plan.awning.valanceHeight, plan.awning.depth + 0.05],
        this.awningGroup,
      ).userData.role = "canopy-light";
    }
    for (let index = 0; index < plan.awning.supportArms; index += 1) {
      const x = plan.awning.supportArms > 1
        ? plan.awning.width / 2 - (plan.awning.width / (plan.awning.supportArms - 1)) * index
        : 0;
      const arm = mesh(
        new THREE.CylinderGeometry(0.03, 0.03, plan.awning.depth * 1.05, 6),
        trimMaterial,
        [x, -plan.awning.drop / 2 - 0.12, plan.awning.depth / 2],
        this.awningGroup,
      );
      arm.rotation.x = Math.PI / 2 - plan.awning.pitch;
    }

    /* Signage: lightbox transom, hanging shingle, blade and channel letters. */
    this.signageGroup = new THREE.Group();
    this.signageGroup.name = `${prefix}:signage`;
    this.group.add(this.signageGroup);
    const transomPanel = mesh(
      new THREE.PlaneGeometry(plan.signage.transomWidth, plan.signage.transomHeight),
      signMaterial,
      [0, storefrontHeight + plan.facade.transomHeight / 2, 0.045],
      this.signageGroup,
    );
    transomPanel.userData.role = "transom-sign";
    mesh(
      new THREE.BoxGeometry(plan.signage.transomWidth + 0.1, plan.signage.transomHeight + 0.1, 0.06),
      signBodyMaterial,
      [0, storefrontHeight + plan.facade.transomHeight / 2, -0.01],
      this.signageGroup,
    ).userData.role = "sign-lightbox";
    const hangingTexture = textureFor("hanging-sign");
    const hangingX = -plan.facade.width * 0.3;
    const hangingPanel = mesh(
      new THREE.PlaneGeometry(plan.signage.hangingWidth, plan.signage.hangingHeight),
      material({
        color: 0xffffff,
        roughness: 0.45,
        metalness: 0.15,
        map: hangingTexture,
        emissive: plan.channels.signGlow,
        emissiveIntensity: plan.channels.signEmissive * 0.85,
        emissiveMap: hangingTexture,
        side: THREE.DoubleSide,
        channel: "signGlow",
        role: "sign",
      }),
      [hangingX, plan.signage.hangingDrop, 0.55],
      this.signageGroup,
    );
    hangingPanel.userData.role = "hanging-sign";
    mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.6),
      trimMaterial,
      [hangingX, plan.signage.hangingDrop + plan.signage.hangingHeight / 2 + 0.12, 0.28],
      this.signageGroup,
    ).userData.role = "hanging-sign-bracket";
    if (plan.signage.hasBlade) {
      const bladeTexture = textureFor("projecting-sign");
      const bladeGroup = new THREE.Group();
      bladeGroup.name = `${prefix}:blade`;
      bladeGroup.position.set(
        plan.facade.width / 2 + plan.signage.bladeWidth * 0.55,
        storefrontHeight + plan.facade.transomHeight * 0.4,
        0.2,
      );
      this.signageGroup.add(bladeGroup);
      const bladePanel = mesh(
        new THREE.PlaneGeometry(plan.signage.bladeWidth, plan.signage.bladeHeight),
        material({
          color: 0xffffff,
          roughness: 0.4,
          metalness: 0.2,
          map: bladeTexture,
          emissive: plan.channels.signGlow,
          emissiveIntensity: plan.channels.signEmissive * 0.9,
          emissiveMap: bladeTexture,
          side: THREE.DoubleSide,
          channel: "signGlow",
          role: "sign",
        }),
        [0, 0, 0],
        bladeGroup,
      );
      bladePanel.rotation.y = Math.PI / 2;
      bladePanel.userData.role = "projecting-sign";
      const bladeArm = mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.9, 6),
        trimMaterial,
        [-plan.signage.bladeWidth * 0.5, 0, 0.1],
        bladeGroup,
      );
      bladeArm.rotation.z = Math.PI / 2;
      bladeArm.rotation.y = Math.PI / 2;
    }
    if (plan.signage.channelLetterCount > 0) {
      const letters = new THREE.InstancedMesh(
        own(new THREE.BoxGeometry(0.28, plan.signage.transomHeight * 0.62, 0.14)),
        material({
          color: shadeHex(plan.channels.accentTint, 0.1),
          roughness: 0.3,
          metalness: 0.6,
          emissive: plan.channels.signGlow,
          emissiveIntensity: plan.channels.signEmissive * 0.7,
          role: "secondary",
        }),
        plan.signage.channelLetterCount,
      );
      letters.name = `${prefix}:channel-letters`;
      const letterMatrix = new THREE.Matrix4();
      const step = plan.signage.transomWidth / (plan.signage.channelLetterCount + 1);
      for (let index = 0; index < plan.signage.channelLetterCount; index += 1) {
        letterMatrix.makeTranslation(
          -plan.signage.transomWidth / 2 + step * (index + 1),
          storefrontHeight + plan.facade.transomHeight / 2,
          0.09,
        );
        letters.setMatrixAt(index, letterMatrix);
      }
      letters.instanceMatrix.needsUpdate = true;
      this.signageGroup.add(letters);
    }

    /* Sign decoration marks: bulbs, tube outlines, strips. */
    let signMarks = 0;
    const signSources = [
      { recipe: plan.signage.transom, width: plan.signage.transomWidth, y: storefrontHeight + plan.facade.transomHeight / 2, x: 0 },
      { recipe: plan.signage.hanging, width: plan.signage.hangingWidth, y: plan.signage.hangingDrop, x: hangingX },
    ] as const;
    for (const [index, source] of signSources.entries()) {
      const markCount = signMarkCount(source.recipe, source.width);
      if (markCount === 0) {
        continue;
      }
      const marks = new THREE.InstancedMesh(
        own(new THREE.SphereGeometry(0.035, 6, 5)),
        material({
          color: 0xffffff,
          roughness: 0.3,
          metalness: 0.1,
          emissive: plan.channels.signGlow,
          emissiveIntensity: plan.channels.signEmissive,
          role: "secondary",
        }),
        markCount,
      );
      marks.name = `${prefix}:sign-marks-${index}`;
      const markMatrix = new THREE.Matrix4();
      for (let mark = 0; mark < markCount; mark += 1) {
        const t = (mark + 0.5) / markCount;
        markMatrix.makeTranslation(source.x - source.width / 2 + source.width * t, source.y, 0.16);
        marks.setMatrixAt(mark, markMatrix);
      }
      marks.instanceMatrix.needsUpdate = true;
      this.signageGroup.add(marks);
      signMarks += markCount;
    }

    /* Price board on the left pilaster. */
    const priceTexture = textureFor("price-board");
    const pricePanel = mesh(
      new THREE.PlaneGeometry(plan.priceBoard.width, plan.priceBoard.height),
      material({
        color: 0xffffff,
        roughness: 0.55,
        metalness: 0.1,
        map: priceTexture,
        emissive: plan.channels.signGlow,
        emissiveIntensity: plan.channels.signEmissive * 0.35,
        emissiveMap: priceTexture,
        role: "secondary",
      }),
      [plan.priceBoard.x, plan.priceBoard.mountHeight, 0.1],
    );
    pricePanel.userData.role = "price-board";
    mesh(
      new THREE.BoxGeometry(plan.priceBoard.width + 0.06, plan.priceBoard.height + 0.06, 0.05),
      signBodyMaterial,
      [plan.priceBoard.x, plan.priceBoard.mountHeight, 0.06],
    ).userData.role = "price-board-frame";

    /* Decals: glass vinyl, door hours plates and the kicked band. */
    const decalGroup = new THREE.Group();
    decalGroup.name = `${prefix}:decals`;
    this.group.add(decalGroup);
    for (const decal of plan.decals) {
      const slot: StorefrontTextureSlot = decal.kind === "est-band"
        ? "kick-band"
        : decal.placement === "door"
          ? "door-decal"
          : "glass-vinyl";
      const parent = decal.placement === "door" ? doorGroup : decalGroup;
      const z = decal.placement === "glass" ? 0.06 : 0.13;
      const decalMesh = mesh(
        new THREE.PlaneGeometry(decal.width, decal.height),
        material({
          color: 0xffffff,
          roughness: 0.5,
          metalness: 0.05,
          map: textureFor(slot),
          opacity: decal.recipe.opacity,
          depthWrite: false,
        }),
        [decal.x, decal.y, z],
        parent,
      );
      decalMesh.userData.role = `decal:${decal.kind}`;
    }

    /* Boarded frontages: planks across the lower glazing. */
    const boardingGroup = new THREE.Group();
    boardingGroup.name = `${prefix}:boarding`;
    this.group.add(boardingGroup);
    if (plan.detailCounts.boardPlanks > 0) {
      const plankMaterial = material({ color: shadeHex(plan.channels.awningTint, -0.35), roughness: 0.85, metalness: 0.02 });
      const plankHeight = plan.glazing.height * 0.22;
      for (let index = 0; index < plan.detailCounts.boardPlanks; index += 1) {
        mesh(
          new THREE.BoxGeometry(plan.glazing.width, plankHeight * 0.86, 0.06),
          plankMaterial,
          [0, plan.facade.kickPlateHeight + plankHeight * (index + 0.5), 0.08],
          boardingGroup,
        ).userData.role = "board-plank";
      }
    }

    /* Worn vs new material overlay. */
    this.wearMaterial = material({
      color: 0xffffff,
      roughness: 0.9,
      metalness: 0,
      map: textureFor("wear"),
      opacity: plan.channels.wear * STOREFRONT_WEAR_OVERLAY_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    mesh(
      new THREE.PlaneGeometry(plan.facade.width, facadeHeight),
      this.wearMaterial,
      [0, facadeHeight / 2, 0.12],
    ).userData.role = "wear-overlay";

    this.scaleBindings.push({ object: this.awningGroup, axis: "z", channel: "awningDepth", reference: plan.awning.depth });
    this.scaleBindings.push({ object: this.awningGroup, axis: "y", channel: "awningDrop", reference: plan.awning.drop });
    this.scaleBindings.push({ object: this.signageGroup, axis: "y", channel: "signHeight", reference: plan.signage.transomHeight });
    this.scaleBindings.push({ object: this.displayGroup, axis: "x", channel: "glazingFraction", reference: plan.channels.glazingFraction });

    const scallopsMesh = this.group.getObjectByName(`${prefix}:scallops`);
    const lettersMesh = this.group.getObjectByName(`${prefix}:channel-letters`);
    this.stats = {
      meshes: meshes.length,
      geometries: this.geometries.length,
      materials: this.materials.length,
      textures: textures.length,
      mullions: mullions.count,
      scallops: scallopsMesh instanceof THREE.InstancedMesh ? scallopsMesh.count : 0,
      signMarks,
      channelLetters: lettersMesh instanceof THREE.InstancedMesh ? lettersMesh.count : 0,
      decals: this.countRoles("decal:"),
      displayGoods: this.displayGroup.children.length,
      displayInstances,
      fixtureInstances,
      boardPlanks: boardingGroup.children.length,
      awningKind: plan.awning.kind,
      structure: plan.signage.structure,
    };

    this.pickables = [this.group, transomPanel, hangingPanel, pricePanel];

    for (const entry of this.materials) {
      if (entry !== this.wearMaterial) {
        this.fadeEntries.push({ material: entry, baseOpacity: entry.opacity });
      }
    }
    this.applyChannels(plan.channels);
  }

  /** Current shared morph channels (lerped while a blend is in flight). */
  get morphChannels(): StorefrontMorphChannels {
    return this.channels;
  }

  /** Opacity of the worn/new overlay, read straight off the material. */
  get wearOpacity(): number {
    return this.wearMaterial.opacity;
  }

  /** Interior glow emissive intensity, read straight off the live material. */
  get glowIntensity(): number {
    return this.interiorGlow[0]?.emissiveIntensity ?? 0;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Awning depth ratio currently applied by the morph (1 = its own era). */
  get awningDepthScale(): number {
    return this.scaleFor("awningDepth");
  }

  /** Awning drop ratio currently applied by the morph (1 = its own era). */
  get awningDropScale(): number {
    return this.scaleFor("awningDrop");
  }

  /** Glazing-width ratio currently applied by the morph (1 = its own era). */
  get glazingScale(): number {
    return this.scaleFor("glazingFraction");
  }

  /** Cross-dissolve weight; the unit drives this from the blend. */
  setFade(weight: number): void {
    if (this.disposed) {
      return;
    }
    this.fadeWeight = clamp01(weight);
    for (const entry of this.fadeEntries) {
      entry.material.opacity = entry.baseOpacity * this.fadeWeight;
    }
    this.wearMaterial.opacity = this.channels.wear * STOREFRONT_WEAR_OVERLAY_OPACITY * this.fadeWeight;
    this.group.visible = this.fadeWeight > 0.002;
  }

  /** Interior glow driven by the transition weights fed from `update`. */
  setGlow(weightedGlow: number, flicker: number): void {
    if (this.disposed) {
      return;
    }
    this.glowSignal = Math.max(0, weightedGlow);
    this.glowFlicker = Math.max(0, flicker);
    this.applyGlowIntensity();
  }

  /** Applies lerped morph channels to materials and morphable groups. */
  applyChannels(channels: StorefrontMorphChannels): void {
    if (this.disposed) {
      return;
    }
    this.channels = channels;
    for (const binding of this.tintBindings) {
      if (binding.channel === "signGlow") {
        binding.material.emissive.setHex(channels.signGlow);
      } else {
        binding.material.color.setHex(channels[binding.channel]);
      }
    }
    for (const entry of this.signEmissives) {
      entry.emissiveIntensity = channels.signEmissive;
    }
    this.applyGlowIntensity();
    this.wearMaterial.opacity = channels.wear * STOREFRONT_WEAR_OVERLAY_OPACITY * this.fadeWeight;
    for (const binding of this.scaleBindings) {
      const value = channels[binding.channel];
      const ratio = binding.reference > 0 ? value / binding.reference : 1;
      const clamped = Math.min(4, Math.max(0.05, ratio));
      if (binding.axis === "x") {
        binding.object.scale.x = clamped;
      } else if (binding.axis === "y") {
        binding.object.scale.y = clamped;
      } else {
        binding.object.scale.z = clamped;
      }
    }
  }

  /** Releases geometry, materials and this variant's share of the textures. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const geometry of this.geometries) {
      geometry.dispose();
    }
    for (const material of this.materials) {
      material.dispose();
    }
    for (const texture of this.textures) {
      this.library.release(texture);
    }
    this.group.removeFromParent();
    this.group.clear();
  }

  private scaleFor(channel: ScaleChannel): number {
    const binding = this.scaleBindings.find((entry) => entry.channel === channel);
    if (!binding) {
      return 1;
    }
    if (binding.axis === "x") {
      return binding.object.scale.x;
    }
    return binding.axis === "y" ? binding.object.scale.y : binding.object.scale.z;
  }

  private applyGlowIntensity(): void {
    // Without a `update()` signal the variant falls back to its own era glow,
    // so a plain applyEra(era, 1) still lights the interior correctly.
    const value = STOREFRONT_GLOW_GAIN * (this.glowSignal ?? this.channels.interiorGlow) * this.glowFlicker;
    for (const entry of this.interiorGlow) {
      entry.emissiveIntensity = value;
    }
    for (const binding of this.secondaryGlow) {
      binding.material.emissiveIntensity = binding.factor * value;
    }
  }

  private countRoles(prefix: string): number {
    let total = 0;
    this.group.traverse((child) => {
      const role = child.userData.role;
      if (typeof role === "string" && role.startsWith(prefix)) {
        total += 1;
      }
    });
    return total;
  }
}

/* -------------------------------------------------------------------------- */
/* Display goods and fixtures                                                 */
/* -------------------------------------------------------------------------- */

function buildDisplayGood(
  good: DisplayGoodPlan,
  parent: THREE.Object3D,
  plan: StorefrontPlan,
  material: StorefrontMaterialFactory,
  mesh: StorefrontMeshFactory,
  own: <T extends THREE.BufferGeometry>(geometry: T) => T,
): void {
  const { spec } = good;
  const body = material({
    color: shadeHex(plan.channels.accentTint, spec.glow > 0.3 ? 0.25 : -0.1),
    roughness: 0.6,
    metalness: 0.15,
  });
  const lit = material({
    color: 0xffffff,
    roughness: 0.35,
    metalness: 0.1,
    emissive: plan.channels.signGlow,
    emissiveIntensity: spec.glow,
    role: "secondary",
  });
  const position: readonly [number, number, number] = [good.x, good.y, good.z];

  switch (spec.shape) {
    case "stack": {
      const stack = new THREE.InstancedMesh(own(new THREE.BoxGeometry(spec.width, spec.height * 0.1, spec.depth)), body, spec.quantity);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < spec.quantity; index += 1) {
        matrix.makeTranslation(
          index % 2 === 0 ? -spec.width * 0.1 : spec.width * 0.1,
          spec.height * 0.1 * (index + 0.5) - spec.height / 2,
          (index % 3) * 0.02,
        );
        stack.setMatrixAt(index, matrix);
      }
      stack.instanceMatrix.needsUpdate = true;
      stack.position.set(position[0], position[1], position[2]);
      parent.add(stack);
      break;
    }
    case "hanging": {
      const hanging = new THREE.InstancedMesh(own(new THREE.SphereGeometry(spec.width * 0.09, 7, 6)), body, spec.quantity);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < spec.quantity; index += 1) {
        matrix.makeTranslation(
          -spec.width / 2 + (spec.width / spec.quantity) * (index + 0.5),
          spec.height * 0.16 - (index % 3) * spec.height * 0.18,
          0,
        );
        hanging.setMatrixAt(index, matrix);
      }
      hanging.instanceMatrix.needsUpdate = true;
      hanging.position.set(position[0], position[1], position[2]);
      parent.add(hanging);
      mesh(new THREE.BoxGeometry(spec.width, 0.05, spec.depth * 0.5), body, [0, spec.height * 0.4, 0], hanging)
        .userData.role = "display-rail";
      break;
    }
    case "shelf": {
      const shelfGroup = new THREE.Group();
      shelfGroup.position.set(position[0], position[1], position[2]);
      parent.add(shelfGroup);
      for (const sign of [-1, 1]) {
        mesh(new THREE.BoxGeometry(0.06, spec.height, spec.depth), body, [sign * spec.width * 0.48, 0, 0], shelfGroup);
      }
      const shelves = new THREE.InstancedMesh(own(new THREE.BoxGeometry(spec.width, 0.05, spec.depth)), body, spec.quantity);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < spec.quantity; index += 1) {
        const step = spec.quantity > 1 ? spec.height / (spec.quantity - 1) : 0;
        matrix.makeTranslation(0, -spec.height / 2 + step * index, 0);
        shelves.setMatrixAt(index, matrix);
      }
      shelves.instanceMatrix.needsUpdate = true;
      shelfGroup.add(shelves);
      break;
    }
    case "cabinet": {
      const cabinet = mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), body, position, parent);
      cabinet.userData.role = "display-cabinet";
      if (spec.glow > 0.1) {
        mesh(new THREE.PlaneGeometry(spec.width * 0.8, spec.height * 0.3), lit, [0, spec.height * 0.2, spec.depth / 2 + 0.01], cabinet);
      }
      break;
    }
    case "machine": {
      const machineGroup = new THREE.Group();
      machineGroup.position.set(position[0], position[1], position[2]);
      parent.add(machineGroup);
      mesh(new THREE.BoxGeometry(spec.width, spec.height * 0.85, spec.depth), body, [0, -spec.height * 0.05, 0], machineGroup);
      mesh(new THREE.CylinderGeometry(spec.width * 0.2, spec.width * 0.2, spec.depth * 0.6, 8), body, [0, spec.height * 0.44, 0], machineGroup);
      if (spec.quantity > 1) {
        const extras = new THREE.InstancedMesh(
          own(new THREE.BoxGeometry(spec.width * 0.6, spec.height * 0.5, spec.depth * 0.6)),
          body,
          spec.quantity - 1,
        );
        const matrix = new THREE.Matrix4();
        for (let index = 0; index < spec.quantity - 1; index += 1) {
          matrix.makeTranslation(spec.width * 0.8 * (index + 1), -spec.height * 0.2, 0);
          extras.setMatrixAt(index, matrix);
        }
        extras.instanceMatrix.needsUpdate = true;
        machineGroup.add(extras);
      }
      if (spec.glow > 0.1) {
        mesh(new THREE.PlaneGeometry(spec.width * 0.7, spec.height * 0.4), lit, [0, spec.height * 0.16, spec.depth / 2 + 0.02], machineGroup);
      }
      break;
    }
    case "figure": {
      const figureGroup = new THREE.Group();
      figureGroup.position.set(position[0], position[1], position[2]);
      parent.add(figureGroup);
      mesh(new THREE.BoxGeometry(spec.width * 0.8, 0.08, spec.depth * 0.8), body, [0, -spec.height / 2, 0], figureGroup);
      mesh(new THREE.CapsuleGeometry(spec.width * 0.22, spec.height * 0.55, 4, 8), body, [0, -spec.height * 0.1, 0], figureGroup);
      mesh(new THREE.SphereGeometry(spec.width * 0.2, 10, 8), body, [0, spec.height * 0.34, 0], figureGroup);
      break;
    }
    case "rack": {
      const rackGroup = new THREE.Group();
      rackGroup.position.set(position[0], position[1], position[2]);
      parent.add(rackGroup);
      const rail = mesh(new THREE.CylinderGeometry(0.035, 0.035, spec.width, 8), body, [0, spec.height * 0.32, 0], rackGroup);
      rail.rotation.z = Math.PI / 2;
      for (const sign of [-1, 1]) {
        mesh(new THREE.CylinderGeometry(0.03, 0.03, spec.height * 0.66, 6), body, [sign * spec.width * 0.46, 0, 0], rackGroup);
      }
      const garments = new THREE.InstancedMesh(own(new THREE.BoxGeometry(0.05, spec.height * 0.5, spec.depth * 0.8)), body, spec.quantity);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < spec.quantity; index += 1) {
        matrix.makeTranslation(-spec.width / 2 + (spec.width / spec.quantity) * (index + 0.5), -spec.height * 0.02, spec.depth * 0.12);
        garments.setMatrixAt(index, matrix);
      }
      garments.instanceMatrix.needsUpdate = true;
      rackGroup.add(garments);
      break;
    }
    case "planter": {
      const planterGroup = new THREE.Group();
      planterGroup.position.set(position[0], position[1], position[2]);
      parent.add(planterGroup);
      mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), body, [0, 0, 0], planterGroup);
      const foliage = new THREE.InstancedMesh(own(new THREE.SphereGeometry(spec.width * 0.12, 7, 6)), lit, spec.quantity);
      const matrix = new THREE.Matrix4();
      const columns = Math.max(2, Math.round(Math.sqrt(spec.quantity)));
      const rows = Math.ceil(spec.quantity / columns);
      for (let index = 0; index < spec.quantity; index += 1) {
        matrix.makeTranslation(
          -spec.width / 2 + (spec.width / columns) * ((index % columns) + 0.5),
          -spec.height / 2 + (spec.height / rows) * (Math.floor(index / columns) + 0.5),
          spec.depth * 0.2,
        );
        foliage.setMatrixAt(index, matrix);
      }
      foliage.instanceMatrix.needsUpdate = true;
      planterGroup.add(foliage);
      break;
    }
    case "booth": {
      const boothGroup = new THREE.Group();
      boothGroup.position.set(position[0], position[1], position[2]);
      parent.add(boothGroup);
      mesh(new THREE.BoxGeometry(spec.width, spec.height, spec.depth), body, [0, 0, 0], boothGroup);
      mesh(new THREE.PlaneGeometry(spec.width * 0.62, spec.height * 0.5), lit, [0, spec.height * 0.05, spec.depth / 2 + 0.02], boothGroup);
      break;
    }
  }
}

function buildFixture(
  fixture: InteriorFixture,
  parent: THREE.Object3D,
  plan: StorefrontPlan,
  material: StorefrontMaterialFactory,
  mesh: StorefrontMeshFactory,
  own: <T extends THREE.BufferGeometry>(geometry: T) => T,
): number {
  const width = plan.glazing.width;
  const depth = plan.facade.interiorDepth;
  const body = material({ color: shadeHex(plan.channels.facadeTint, -0.2), roughness: 0.6, metalness: 0.2 });
  const lit = material({
    color: 0xffffff,
    roughness: 0.4,
    metalness: 0.1,
    emissive: plan.channels.signGlow,
    emissiveIntensity: 0.6,
    role: "secondary",
  });

  switch (fixture) {
    case "counter":
    case "display-cases":
    case "espresso-machine":
    case "clinic-screen":
    case "work-benches": {
      const isBench = fixture === "work-benches";
      mesh(
        new THREE.BoxGeometry(Math.min(width * 0.7, 3.4), isBench ? 0.9 : 1.05, 0.6),
        body,
        [0, isBench ? 0.45 : 0.52, -depth * 0.45],
        parent,
      );
      if (fixture === "espresso-machine" || fixture === "clinic-screen") {
        mesh(new THREE.PlaneGeometry(0.8, 0.4), lit, [0, 1.25, -depth * 0.45], parent);
      }
      return 1;
    }
    case "chiller": {
      mesh(new THREE.BoxGeometry(Math.min(width * 0.5, 2.4), 2, 0.7), lit, [width * 0.22, 1, -depth * 0.6], parent);
      return 1;
    }
    case "wall-shelves":
    case "record-bins":
    case "grow-racks":
    case "crt-wall": {
      const shelves = new THREE.InstancedMesh(
        own(new THREE.BoxGeometry(Math.min(width * 0.8, 4), 0.06, 0.45)),
        fixture === "grow-racks" ? lit : body,
        4,
      );
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < 4; index += 1) {
        matrix.makeTranslation(0, 0.55 + index * 0.42, -depth * 0.72);
        shelves.setMatrixAt(index, matrix);
      }
      shelves.instanceMatrix.needsUpdate = true;
      parent.add(shelves);
      return 4;
    }
    case "cabinet-row":
    case "arcade-row": {
      const count = Math.max(2, Math.round(width / 2.2));
      const row = new THREE.InstancedMesh(
        own(new THREE.BoxGeometry(0.7, 1.7, 0.7)),
        fixture === "arcade-row" ? lit : body,
        count,
      );
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < count; index += 1) {
        matrix.makeTranslation(-width * 0.32 + index * 0.85, 0.85, -depth * 0.55);
        row.setMatrixAt(index, matrix);
      }
      row.instanceMatrix.needsUpdate = true;
      parent.add(row);
      return count;
    }
    case "booths": {
      const booths = new THREE.InstancedMesh(own(new THREE.BoxGeometry(width * 0.3, 1.2, 1.2)), body, 2);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < 2; index += 1) {
        matrix.makeTranslation(-width * 0.2 + index * width * 0.4, 0.6, -depth * 0.4);
        booths.setMatrixAt(index, matrix);
      }
      booths.instanceMatrix.needsUpdate = true;
      parent.add(booths);
      return 2;
    }
    case "mannequin-stands": {
      const stands = new THREE.InstancedMesh(own(new THREE.CylinderGeometry(0.12, 0.28, 0.7, 8)), body, 2);
      const matrix = new THREE.Matrix4();
      for (let index = 0; index < 2; index += 1) {
        matrix.makeTranslation(-width * 0.25 + index * width * 0.5, 0.35, -depth * 0.5);
        stands.setMatrixAt(index, matrix);
      }
      stands.instanceMatrix.needsUpdate = true;
      parent.add(stands);
      return 2;
    }
    case "gym-rig": {
      const rigGroup = new THREE.Group();
      parent.add(rigGroup);
      for (const sign of [-1, 1]) {
        mesh(new THREE.BoxGeometry(0.12, 2.1, 0.12), body, [sign * width * 0.28, 1.05, -depth * 0.6], rigGroup);
      }
      const bar = mesh(new THREE.CylinderGeometry(0.05, 0.05, width * 0.6, 8), body, [0, 2, -depth * 0.6], rigGroup);
      bar.rotation.z = Math.PI / 2;
      return 3;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Storefront units                                                           */
/* -------------------------------------------------------------------------- */

/** Live morph state of one storefront unit. */
export interface StorefrontMorphSample {
  readonly era: EraId;
  readonly fromEra: EraId | null;
  readonly blend: number;
  readonly fromWeight: number;
  readonly toWeight: number;
  readonly variants: number;
  readonly brand: string;
  readonly fromBrand: string | null;
  readonly programmeLabel: string;
  readonly channels: StorefrontMorphChannels;
  readonly wearOpacity: number;
  readonly glowIntensity: number;
  readonly awningDepthScale: number;
  readonly awningDropScale: number;
  readonly glazingScale: number;
}

export interface StorefrontUnitOptions {
  readonly lot: BuildingLot;
  readonly rank: number;
  readonly unitCount: number;
  readonly eras: readonly EraConfig[];
  readonly library: StorefrontTextureLibrary;
  readonly ledger: ResourceLedger;
}

/**
 * One ground-floor frontage: its lot, its variants and its era morph.
 *
 * The unit owns the two variants alive during a transition (at most two, and
 * only one once a blend completes) plus the frozen transform that puts the
 * facade on the lot's street-facing edge, with local +Z as the streetward
 * normal and local X running along the frontage.
 */
export class StorefrontUnit implements EraAware {
  readonly id: string;
  readonly lot: BuildingLot;
  readonly group = new THREE.Group();

  private readonly eras: Readonly<Record<EraId, EraConfig>>;
  private readonly library: StorefrontTextureLibrary;
  private readonly ledger: ResourceLedger;
  private readonly rank: number;
  private readonly unitCount: number;
  private readonly plans = new Map<EraId, StorefrontPlan>();
  private variantFrom: StorefrontVariant | null = null;
  private variantTo: StorefrontVariant | null = null;
  private blendValue = 1;
  private lastEra: EraId | null = null;
  private disposed = false;

  constructor(options: StorefrontUnitOptions) {
    this.id = `${options.lot.id}-storefront`;
    this.lot = options.lot;
    this.rank = options.rank;
    this.unitCount = options.unitCount;
    this.eras = indexEras(options.eras);
    this.library = options.library;
    this.ledger = options.ledger;
    this.group.name = `storefront:${options.lot.id}`;
    this.group.userData = { storefrontId: this.id, lotId: options.lot.id };

    const { facing } = options.lot;
    const halfExtent = Math.abs(facing.x) * options.lot.footprint.width / 2
      + Math.abs(facing.z) * options.lot.footprint.depth / 2;
    this.group.position.set(
      options.lot.center.x + facing.x * halfExtent,
      options.lot.center.y,
      options.lot.center.z + facing.z * halfExtent,
    );
    this.group.rotation.y = Math.atan2(facing.x, facing.z);
  }

  get era(): EraId {
    if (this.variantTo) {
      return this.variantTo.plan.era;
    }
    return this.lastEra ?? this.plans.keys().next().value ?? "1945";
  }

  get fromEra(): EraId | null {
    return this.variantFrom ? this.variantFrom.plan.era : null;
  }

  get blend(): number {
    return this.blendValue;
  }

  get variantCount(): number {
    return (this.variantFrom ? 1 : 0) + (this.variantTo ? 1 : 0);
  }

  /**
   * The active plan: the era the timeline is heading towards.
   *
   * After teardown the unit keeps answering with the plan it last showed, so
   * stats and debug overlays stay readable on a disposed system.
   */
  get plan(): StorefrontPlan {
    return this.variantTo ? this.variantTo.plan : this.planFor(this.era);
  }

  /** Textures currently held by the target variant. */
  get textures(): readonly PaintedTexture[] {
    return this.variantTo ? this.variantTo.textures : [];
  }

  /** Pickable surfaces: the facade root plus its signage panels. */
  get pickables(): readonly THREE.Object3D[] {
    return this.variantTo ? this.variantTo.pickables : [];
  }

  /** Interior glow emissive intensity of the target variant. */
  get glowIntensity(): number {
    return this.variantTo ? this.variantTo.glowIntensity : 0;
  }

  /** Counts read back off the target variant's built objects. */
  get stats(): StorefrontVariantStats | null {
    return this.variantTo ? this.variantTo.stats : null;
  }

  /** Plan for any era of this lot, computed once and cached. */
  planFor(era: EraId): StorefrontPlan {
    const cached = this.plans.get(era);
    if (cached) {
      return cached;
    }
    const programmes = shopProgrammesFor(era);
    const programme = programmes[this.rank % programmes.length] ?? programmes[0]!;
    const plan = planStorefront({
      lot: this.lot,
      era: this.eras[era],
      programme,
      rank: this.rank,
      unitCount: this.unitCount,
    });
    this.plans.set(era, plan);
    return plan;
  }

  /** Live morph sample used by tests and debug overlays. */
  get morph(): StorefrontMorphSample {
    if (!this.variantTo) {
      throw new Error(`Storefront unit ${this.id} has no active variant.`);
    }
    const to = this.variantTo;
    const from = this.variantFrom;
    return {
      era: to.plan.era,
      fromEra: from ? from.plan.era : null,
      blend: this.blendValue,
      fromWeight: from ? 1 - this.blendValue : 0,
      toWeight: from ? this.blendValue : 1,
      variants: this.variantCount,
      brand: to.plan.programme.brand,
      fromBrand: from ? from.plan.programme.brand : null,
      programmeLabel: to.plan.programme.label,
      channels: to.morphChannels,
      wearOpacity: to.wearOpacity,
      glowIntensity: to.glowIntensity,
      awningDepthScale: to.awningDepthScale,
      awningDropScale: to.awningDropScale,
      glazingScale: to.glazingScale,
    };
  }

  /**
   * Cross-morphs this storefront to `era` at `blend` in `0..1`.
   *
   * `blend` 0 means "still fully the previous era", 1 means "fully `era`". The
   * previous target becomes the outgoing variant, a variant for the new era is
   * built (or reused when the timeline is reversing), both are cross-dissolved
   * and given the same lerped channels, and the outgoing variant is disposed as
   * soon as the blend completes.
   */
  applyEra(era: EraId, blend: number): void {
    if (this.disposed) {
      return;
    }
    const target = clampBlend(blend);
    this.lastEra = era;
    if (this.variantTo && this.variantTo.plan.era === era && this.blendValue === target) {
      return;
    }
    if (!this.variantTo) {
      this.variantTo = this.buildVariant(era);
    } else if (this.variantTo.plan.era !== era) {
      const previousTarget = this.variantTo;
      const reusable = this.variantFrom && this.variantFrom.plan.era === era ? this.variantFrom : null;
      if (reusable) {
        this.variantTo = reusable;
        this.variantFrom = previousTarget;
      } else {
        this.variantFrom?.dispose();
        this.variantFrom = previousTarget;
        this.variantTo = this.buildVariant(era);
      }
    }
    this.blendValue = target;
    this.applyMorph();
    if (this.blendValue >= 1 && this.variantFrom) {
      this.variantFrom.dispose();
      this.variantFrom = null;
      this.applyMorph();
    }
  }

  /** Pushes the transition-weighted interior glow into the live materials. */
  applyGlow(weightedGlow: number, flicker: number): void {
    if (this.disposed) {
      return;
    }
    this.variantTo?.setGlow(weightedGlow, flicker);
    this.variantFrom?.setGlow(weightedGlow, flicker);
  }

  /** Releases both variants; the unit stops reacting to era changes. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.variantFrom?.dispose();
    this.variantTo?.dispose();
    this.variantFrom = null;
    this.variantTo = null;
    this.group.removeFromParent();
    this.group.clear();
  }

  private buildVariant(era: EraId): StorefrontVariant {
    const plan = this.planFor(era);
    const textures = plan.textures.map((texture) => this.library.acquire(texture));
    const variant = new StorefrontVariant(plan, this.library, this.ledger, textures);
    this.group.add(variant.group);
    return variant;
  }

  private applyMorph(): void {
    const to = this.variantTo;
    if (!to) {
      return;
    }
    const from = this.variantFrom;
    const channels = from ? lerpMorphChannels(from.plan.channels, to.plan.channels, this.blendValue) : to.plan.channels;
    if (from) {
      from.setFade(1 - this.blendValue);
      from.applyChannels(channels);
    }
    to.setFade(this.blendValue);
    to.applyChannels(channels);
    this.group.userData = {
      storefrontId: this.id,
      lotId: this.lot.id,
      era: to.plan.era,
      fromEra: from ? from.plan.era : null,
      blend: this.blendValue,
      brand: to.plan.programme.brand,
      programme: to.plan.programme.label,
      trading: to.plan.trading,
    };
  }
}

function indexEras(eras: readonly EraConfig[]): Readonly<Record<EraId, EraConfig>> {
  const index = {} as Record<EraId, EraConfig>;
  for (const era of eras) {
    index[era.id] = era;
  }
  return index;
}

/* -------------------------------------------------------------------------- */
/* System                                                                     */
/* -------------------------------------------------------------------------- */

export const STOREFRONT_SYSTEM_ID = "storefronts";

const GLOW_FLICKER = 0.06;

export interface StorefrontSystemOptions {
  /** Layout to populate; defaults to the real block from `./layout`. */
  readonly layout?: CityLayout;
  /** Era dataset; defaults to the real `ERAS` re-exported by `../era/eraTypes`. */
  readonly eras?: readonly EraConfig[];
  /** Initial timeline stop; defaults to the first era. */
  readonly era?: EraId;
  /** Surface factory used for the canvas textures. */
  readonly canvasFactory?: CanvasSurfaceFactory;
  readonly anisotropy?: number;
}

export interface StorefrontSystemStats {
  readonly units: number;
  readonly liveVariants: number;
  readonly morphing: number;
  readonly textures: Readonly<{ created: number; reused: number; disposed: number; live: number }>;
  readonly resources: StorefrontResourceLedger;
  /** How many frontages are trading per era, straight from the live plans. */
  readonly trading: Readonly<Partial<Record<EraId, number>>>;
}

/**
 * The era storefront system.
 *
 * Implements the shared `EraSceneSystem` contract: scene assembly mounts
 * {@link group}, drives {@link update} from the fixed-step loop, raycasts
 * {@link getPickables} for click-to-inspect and calls {@link dispose} on
 * teardown. One storefront unit is generated per ground-floor lot from the real
 * layout, and every unit cross-morphs when the timeline moves.
 */
export class StorefrontSystem implements EraSceneSystem {
  readonly id = STOREFRONT_SYSTEM_ID;
  readonly group = new THREE.Group();
  readonly units: readonly StorefrontUnit[];

  private readonly eras: readonly EraConfig[];
  private readonly library: StorefrontTextureLibrary;
  private readonly ledger = new ResourceLedger();
  private currentEra: EraId;
  private currentBlend = 1;
  private disposed = false;

  constructor(options: StorefrontSystemOptions = {}) {
    const layout = options.layout ?? CITY_LAYOUT;
    this.eras = options.eras ?? ERAS;
    this.library = new StorefrontTextureLibrary({
      canvasFactory: options.canvasFactory,
      anisotropy: options.anisotropy,
    });
    this.group.name = STOREFRONT_SYSTEM_ID;

    const ranks = rankLots(layout.lots);
    this.units = layout.lots.map((lot) => {
      const unit = new StorefrontUnit({
        lot,
        rank: ranks.get(lot.id) ?? 0,
        unitCount: layout.lots.length,
        eras: this.eras,
        library: this.library,
        ledger: this.ledger,
      });
      this.group.add(unit.group);
      return unit;
    });

    const initial = options.era ?? this.eras[0]?.id ?? ERA_IDS[0];
    this.currentEra = initial;
    this.applyEra(initial, 1);
  }

  /** Era the block is currently heading towards. */
  get era(): EraId {
    return this.currentEra;
  }

  get blend(): number {
    return this.currentBlend;
  }

  get stats(): StorefrontSystemStats {
    const trading: Partial<Record<EraId, number>> = {};
    for (const unit of this.units) {
      const plan = unit.plan;
      if (plan.trading) {
        trading[plan.era] = (trading[plan.era] ?? 0) + 1;
      }
    }
    return {
      units: this.units.length,
      liveVariants: this.units.reduce((sum, unit) => sum + unit.variantCount, 0),
      morphing: this.units.filter((unit) => unit.variantCount > 1).length,
      textures: this.library.stats,
      resources: this.ledger.snapshot(),
      trading,
    };
  }

  /** Cross-morphs every storefront to `era` at `blend` in `0..1`. */
  applyEra(era: EraId, blend: number): void {
    if (this.disposed) {
      return;
    }
    const target = clampBlend(blend);
    this.currentEra = era;
    this.currentBlend = target;
    for (const unit of this.units) {
      unit.applyEra(era, target);
    }
  }

  /**
   * Per-frame update: applies the era blend and drives interior glow from the
   * per-era weights, so mid-morph lighting is the weighted blend of both stops.
   */
  update(context: EraUpdateContext): void {
    if (this.disposed) {
      return;
    }
    this.applyEra(context.era, context.blend);
    const weightedGlow = weightedInteriorGlow(context.weights, this.eras);
    for (const [index, unit] of this.units.entries()) {
      unit.applyGlow(weightedGlow, 1 + GLOW_FLICKER * Math.sin(context.elapsed * 1.9 + index * 0.7));
    }
  }

  getPickables(): readonly THREE.Object3D[] {
    return this.units.flatMap((unit) => unit.pickables);
  }

  /** Disposes every variant, texture and geometry the system owns. */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const unit of this.units) {
      unit.dispose();
    }
    this.library.disposeAll();
    this.group.removeFromParent();
    this.group.clear();
  }
}

/** Weighted interior glow of the active transition; 0 when no era is lit. */
export function weightedInteriorGlow(
  weights: Readonly<Record<EraId, number>>,
  eras: readonly EraConfig[] = ERAS,
): number {
  const index = indexEras(eras);
  let total = 0;
  for (const era of ERA_IDS) {
    const weight = weights[era];
    if (!Number.isFinite(weight) || weight === 0) {
      continue;
    }
    total += weight * index[era].storefronts.interiorGlow;
  }
  return total;
}

/** Builds the storefront system for a layout and era dataset. */
export function createStorefrontSystem(options: StorefrontSystemOptions = {}): StorefrontSystem {
  return new StorefrontSystem(options);
}
