import { describe, expect, it } from '@jest/globals';

import {
  YEARS,
  getYearConfig,
  type YearConfig,
} from './years';

const REQUIRED_KEYS: ReadonlyArray<keyof YearConfig> = [
  'year',
  'label',
  'buildings',
  'vehicles',
  'storefronts',
  'ads',
  'pedestrianOutfits',
];

const EXPECTED_YEARS = [1945, 1965, 1985, 2005, 2025];

describe('years config', () => {
  it('exports exactly five year entries', () => {
    expect(YEARS).toHaveLength(5);
  });

  it('contains the expected years in chronological order', () => {
    expect(YEARS.map((y) => y.year)).toEqual(EXPECTED_YEARS);
  });

  it.each(EXPECTED_YEARS)(
    'includes a config for year %i',
    (year) => {
      expect(getYearConfig(year)).toBeDefined();
    },
  );

  it.each(YEARS.map((y) => y.year))(
    'year %i config has all required fields',
    (year) => {
      const config = getYearConfig(year);
      expect(config).toBeDefined();
      if (!config) return;

      for (const key of REQUIRED_KEYS) {
        expect(config).toHaveProperty(key);
      }

      expect(typeof config.year).toBe('number');
      expect(typeof config.label).toBe('string');
      expect(config.label.length).toBeGreaterThan(0);
      expect(Array.isArray(config.buildings)).toBe(true);
      expect(config.buildings.length).toBeGreaterThan(0);
      expect(Array.isArray(config.vehicles)).toBe(true);
      expect(config.vehicles.length).toBeGreaterThan(0);
      expect(Array.isArray(config.storefronts)).toBe(true);
      expect(config.storefronts.length).toBeGreaterThan(0);
      expect(Array.isArray(config.ads)).toBe(true);
      expect(config.ads.length).toBeGreaterThan(0);
      expect(Array.isArray(config.pedestrianOutfits)).toBe(true);
      expect(config.pedestrianOutfits.length).toBeGreaterThan(0);
    },
  );

  it('keeps all data serializable (no functions or class instances)', () => {
    const json = JSON.parse(JSON.stringify(YEARS));
    expect(json).toEqual(YEARS);
  });

  it('uses valid hex color strings for all color fields', () => {
    const hexRegex = /^#[0-9a-fA-F]{6}$/;
    for (const config of YEARS) {
      for (const building of config.buildings) {
        for (const color of building.facadeColors) {
          expect(color).toMatch(hexRegex);
        }
        for (const color of building.roofColors) {
          expect(color).toMatch(hexRegex);
        }
      }
      for (const vehicle of config.vehicles) {
        for (const color of vehicle.bodyColors) {
          expect(color).toMatch(hexRegex);
        }
      }
      for (const storefront of config.storefronts) {
        expect(storefront.signColor).toMatch(hexRegex);
        expect(storefront.accentColor).toMatch(hexRegex);
      }
      for (const ad of config.ads) {
        expect(ad.backgroundColor).toMatch(hexRegex);
        expect(ad.textColor).toMatch(hexRegex);
      }
      for (const outfit of config.pedestrianOutfits) {
        for (const color of outfit.topColors) {
          expect(color).toMatch(hexRegex);
        }
        for (const color of outfit.bottomColors) {
          expect(color).toMatch(hexRegex);
        }
      }
    }
  });
});
