import { describe, expect, it } from 'vitest';
import { allEras } from '../src/config/eras';
import { buildSignContent, signageSignature } from '../src/world/signage';
import type { EraDefinition, SignFormat } from '../src/config/types';

const eras = allEras();

function formats(era: EraDefinition, source: 'storefront' | 'advertisement' | 'all'): SignFormat[] {
  return buildSignContent(era)
    .filter((content) => source === 'all' || content.source === source)
    .map((content) => content.format);
}

describe('era content - signage', () => {
  it('produces a non-empty draw specification for every era without a canvas', () => {
    for (const era of eras) {
      const content = buildSignContent(era);
      expect(content.length, `${era.year} signage entries`).toBe(
        era.storefronts.length + era.advertisements.length,
      );
      for (const entry of content) {
        expect(entry.text.length).toBeGreaterThan(2);
        expect(entry.draw.lines.length).toBeGreaterThan(0);
        expect(entry.draw.lines.join(' ').length).toBeGreaterThan(2);
        expect(entry.draw.background).toMatch(/^#/);
        expect(entry.draw.foreground).toMatch(/^#/);
        expect(entry.width).toBeGreaterThan(0);
        expect(entry.height).toBeGreaterThan(0);
        expect(entry.colors.length).toBeGreaterThanOrEqual(2);
        expect(typeof entry.draw.glow).toBe('boolean');
        expect(typeof entry.draw.scroll).toBe('boolean');
        expect(entry.id.length).toBeGreaterThan(2);
      }
      // Glowing formats must be flagged as emissive so the bloom pass catches them.
      for (const entry of content) {
        if (entry.format === 'neon' || entry.format === 'led' || entry.format === 'ticker' || entry.format === 'media-facade') {
          expect(entry.emissive, `${era.year} ${entry.id} should glow`).toBe(true);
          expect(entry.intensity).toBeGreaterThan(0);
        }
        if (entry.format === 'painted' || entry.format === 'poster') {
          expect(entry.emissive, `${era.year} ${entry.id} should be matte`).toBe(false);
          expect(entry.draw.border).toBe(true);
        }
      }
    }
  });

  it('returns a distinct signage signature for every decade', () => {
    const signatures = eras.map(signageSignature);
    expect(new Set(signatures).size).toBe(eras.length);
  });

  it('gives every decade a different advertisement format list', () => {
    const lists = eras.map((era) => formats(era, 'advertisement').join('|'));
    expect(new Set(lists).size).toBe(eras.length);
    const sets = eras.map((era) => Array.from(new Set(formats(era, 'advertisement'))).sort().join(','));
    expect(new Set(sets).size).toBe(eras.length);
  });

  it('uses the full painted → neon → ticker → LED → media-facade progression', () => {
    expect(formats(eras[0], 'advertisement')).toContain('painted');
    expect(formats(eras[1], 'advertisement')).toContain('neon');
    expect(formats(eras[2], 'advertisement')).toContain('ticker');
    expect(formats(eras[3], 'advertisement')).toContain('led');
    expect(formats(eras[4], 'advertisement')).toContain('media-facade');
  });

  it('introduces scrolling copy only from the ticker era onwards', () => {
    for (const era of eras) {
      const hasScroll = buildSignContent(era).some((content) => content.scrolling);
      // 1945 and 1965 are painted / static neon; ticker and media-facade copy
      // animates from 1985 onwards (2005's LED boards are still static).
      if (era.year <= 1965 || era.year === 2005) expect(hasScroll, `${era.year} scrolling`).toBe(false);
      else expect(hasScroll, `${era.year} scrolling`).toBe(true);
    }
  });
});

describe('era content - pedestrian outfits', () => {
  it('gives every pair of decades a different outfit silhouette mix', () => {
    const mixes = eras.map((era) =>
      era.outfits
        .map((outfit) => outfit.silhouette)
        .sort()
        .join(','),
    );
    expect(new Set(mixes).size).toBe(eras.length);
  });

  it('moves the accessories forward in time (hats → phones)', () => {
    expect(eras[0].outfits.some((outfit) => outfit.accessory === 'day-dress')).toBe(true);
    expect(eras[0].outfits.some((outfit) => outfit.accessory === 'phone')).toBe(false);
    expect(eras[4].outfits.some((outfit) => outfit.accessory === 'phone')).toBe(true);
    expect(eras[4].outfits.some((outfit) => outfit.accessory === 'helmet')).toBe(true);
    expect(eras[2].outfits.some((outfit) => outfit.accessory === 'headband')).toBe(true);
  });

  it('labels every outfit in period terms', () => {
    for (const era of eras) {
      for (const outfit of era.outfits) {
        expect(outfit.label.length, `${era.year} ${outfit.id}`).toBeGreaterThan(3);
        expect(outfit.accessoryColor).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});
