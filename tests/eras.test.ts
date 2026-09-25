import { describe, expect, it } from 'vitest';
import { ERAS, allEras, eraFor } from '../src/config/eras';
import { YEARS, type EraDefinition } from '../src/config/types';

const eras = allEras();

function paletteKey(era: EraDefinition): string {
  return [era.palette.skyTop, era.palette.skyBottom, era.palette.fog, era.palette.horizon, era.palette.sun].join('|');
}

function vehicleKindSet(era: EraDefinition): string {
  return Array.from(new Set(era.vehicles.map((vehicle) => vehicle.kind)))
    .sort()
    .join(',');
}

function storefrontNames(era: EraDefinition): string {
  return era.storefronts.map((storefront) => storefront.name).join('|');
}

function adCopy(era: EraDefinition): string {
  return era.advertisements.map((ad) => ad.copy).join('|');
}

function outfitPalettes(era: EraDefinition): string[] {
  return era.outfits.map((outfit) => outfit.colors.join(','));
}

function accessorySet(era: EraDefinition): string {
  return Array.from(new Set(era.outfits.map((outfit) => outfit.accessory)))
    .sort()
    .join(',');
}

describe('era registry', () => {
  it('contains exactly the five selectable years, in timeline order', () => {
    expect(Object.keys(ERAS).map(Number).sort((a, b) => a - b)).toEqual([1945, 1965, 1985, 2005, 2025]);
    expect(allEras().map((era) => era.year)).toEqual([...YEARS]);
    expect(YEARS).toEqual([1945, 1965, 1985, 2005, 2025]);
  });

  it('looks eras up by year', () => {
    for (const year of YEARS) {
      expect(eraFor(year).year).toBe(year);
      expect(eraFor(year)).toBe(ERAS[year]);
    }
  });

  it('populates every required content field for every era', () => {
    for (const era of eras) {
      expect(era.title.length, `${era.year} title`).toBeGreaterThan(4);
      expect(era.tagline.length, `${era.year} tagline`).toBeGreaterThan(15);
      expect(era.facts.length, `${era.year} facts`).toBeGreaterThanOrEqual(4);
      expect(era.bannerText.length, `${era.year} banner`).toBeGreaterThan(4);

      // Palette + grade
      expect(era.palette.skyTop).toMatch(/^#[0-9a-f]{6}$/i);
      expect(era.palette.skyBottom).toMatch(/^#[0-9a-f]{6}$/i);
      expect(era.palette.fog).toMatch(/^#[0-9a-f]{6}$/i);
      expect(era.palette.fogDensity).toBeGreaterThan(0);
      expect(era.palette.fogDensity).toBeLessThan(0.02);
      expect(era.palette.sunPosition).toHaveLength(3);
      for (const channel of era.palette.sunPosition) expect(Number.isFinite(channel)).toBe(true);

      expect(era.grade.saturation).toBeGreaterThan(0);
      expect(era.grade.gamma).toBeGreaterThan(0.5);
      expect(era.grade.grain).toBeGreaterThanOrEqual(0);
      expect(era.grade.bloom).toBeGreaterThan(0);

      // Architecture
      expect(era.architecture.styles.length).toBeGreaterThanOrEqual(3);
      expect(era.architecture.facadeColors.length).toBeGreaterThanOrEqual(4);
      expect(era.architecture.maxFloors).toBeGreaterThan(era.architecture.minFloors);
      expect(era.architecture.glassRatio).toBeGreaterThanOrEqual(0);
      expect(era.architecture.glassRatio).toBeLessThanOrEqual(1);

      // Content volumes
      expect(era.vehicles.length, `${era.year} vehicles`).toBeGreaterThanOrEqual(6);
      expect(era.storefronts.length, `${era.year} storefronts`).toBeGreaterThanOrEqual(4);
      expect(era.advertisements.length, `${era.year} ads`).toBeGreaterThanOrEqual(3);
      expect(era.outfits.length, `${era.year} outfits`).toBeGreaterThanOrEqual(6);
      expect(era.audio.ambience.length, `${era.year} ambience`).toBeGreaterThanOrEqual(4);

      for (const vehicle of era.vehicles) {
        expect(vehicle.count).toBeGreaterThan(0);
        expect(vehicle.length).toBeGreaterThan(0);
        expect(vehicle.movingRatio).toBeGreaterThanOrEqual(0);
        expect(vehicle.movingRatio).toBeLessThanOrEqual(1);
      }
      for (const storefront of era.storefronts) {
        expect(storefront.name.length).toBeGreaterThan(2);
        expect(storefront.display.length).toBeGreaterThan(3);
      }
      for (const ad of era.advertisements) {
        expect(ad.copy.length).toBeGreaterThan(4);
        expect(ad.colors.length).toBeGreaterThanOrEqual(2);
      }
      for (const outfit of era.outfits) {
        expect(outfit.colors).toHaveLength(3);
        expect(outfit.hem).toBeGreaterThan(0.2);
        expect(outfit.hem).toBeLessThan(0.95);
      }
      for (const layer of era.audio.ambience) {
        expect(layer.gain).toBeGreaterThan(0);
        expect(layer.filterHz).toBeGreaterThan(10);
        expect(layer.label.length).toBeGreaterThan(2);
      }
      expect(era.audio.music.tempo).toBeGreaterThan(40);
      expect(era.audio.engineBaseHz).toBeGreaterThan(0);
    }
  });

  it('gives every era a fleet big enough to fill the block (>=16 vehicles)', () => {
    for (const era of eras) {
      const total = era.vehicles.reduce((sum, vehicle) => sum + vehicle.count, 0);
      expect(total, `${era.year} fleet size`).toBeGreaterThanOrEqual(16);
    }
  });

  it('keeps the sky/light palettes mutually distinct', () => {
    const keys = eras.map(paletteKey);
    expect(new Set(keys).size).toBe(eras.length);
    const tops = eras.map((era) => era.palette.skyTop);
    expect(new Set(tops).size).toBe(eras.length);
    const fogs = eras.map((era) => era.palette.fog);
    expect(new Set(fogs).size).toBe(eras.length);
  });

  it('keeps vehicle-type sets mutually distinct', () => {
    const sets = eras.map(vehicleKindSet);
    expect(new Set(sets).size).toBe(eras.length);
  });

  it('keeps storefront names and window copy mutually distinct', () => {
    const names = eras.map(storefrontNames);
    expect(new Set(names).size).toBe(eras.length);
    const displays = eras.map((era) => era.storefronts.map((storefront) => storefront.display).join('|'));
    expect(new Set(displays).size).toBe(eras.length);
    // No storefront name is reused by another decade.
    const all = eras.flatMap((era) => era.storefronts.map((storefront) => storefront.name));
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps advertisement copy mutually distinct', () => {
    const copies = eras.map(adCopy);
    expect(new Set(copies).size).toBe(eras.length);
    const all = eras.flatMap((era) => era.advertisements.map((ad) => ad.copy));
    expect(new Set(all).size).toBe(all.length);
  });

  it('keeps outfit swatch triples and accessories mutually distinct', () => {
    const all = eras.flatMap(outfitPalettes);
    expect(new Set(all).size).toBe(all.length);
    const accessories = eras.map(accessorySet);
    expect(new Set(accessories).size).toBe(eras.length);
    const silhouettes = eras.map((era) =>
      Array.from(new Set(era.outfits.map((outfit) => outfit.silhouette)))
        .sort()
        .join(','),
    );
    expect(new Set(silhouettes).size).toBeGreaterThanOrEqual(4);
  });

  it('declares the period tell-tales each decade is known for', () => {
    expect(ERAS[1945].vehicles.some((vehicle) => vehicle.kind === 'streetcar')).toBe(true);
    expect(ERAS[1945].props.tramRails).toBe(true);
    expect(ERAS[1945].architecture.waterTowers).toBe(true);
    expect(ERAS[1945].advertisements.every((ad) => ad.format === 'painted' || ad.format === 'poster')).toBe(true);
    expect(ERAS[1945].outfits.some((outfit) => outfit.accessory === 'fedora')).toBe(true);

    expect(ERAS[1965].storefronts.some((storefront) => storefront.signFormat === 'neon')).toBe(true);
    expect(ERAS[1965].vehicles.some((vehicle) => vehicle.kind === 'muscle-car')).toBe(true);

    expect(ERAS[1985].vehicles.some((vehicle) => vehicle.kind === 'van')).toBe(true);
    expect(ERAS[1985].advertisements.some((ad) => ad.format === 'billboard')).toBe(true);
    expect(ERAS[1985].architecture.satelliteDishes).toBe(true);

    expect(ERAS[2005].vehicles.some((vehicle) => vehicle.kind === 'suv')).toBe(true);
    expect(ERAS[2005].advertisements.some((ad) => ad.format === 'led')).toBe(true);

    expect(ERAS[2025].vehicles.some((vehicle) => vehicle.kind === 'ev')).toBe(true);
    expect(ERAS[2025].vehicles.some((vehicle) => vehicle.kind === 'scooter')).toBe(true);
    expect(ERAS[2025].advertisements.some((ad) => ad.format === 'media-facade')).toBe(true);
    expect(ERAS[2025].props.bikeLane).toBe(true);
    expect(ERAS[2025].outfits.some((outfit) => outfit.accessory === 'phone')).toBe(true);
  });

  it('gives each decade its own street furniture and transit mode', () => {
    const lamps = eras.map((era) => era.props.lampStyle);
    expect(new Set(lamps).size).toBe(eras.length);
    const transit = eras.map((era) => era.props.transit);
    expect(new Set(transit).size).toBeGreaterThanOrEqual(3);
    expect(ERAS[1945].props.telephonePoles).toBe(true);
    expect(ERAS[2025].props.telephonePoles).toBe(false);
    expect(ERAS[2025].props.bikeLane).toBe(true);
    expect(ERAS[1945].props.bikeLane).toBe(false);
  });
});
