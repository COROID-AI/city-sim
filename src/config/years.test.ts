/**
 * Unit tests for the year configuration data model.
 *
 * Covers the pure helper functions (getYearConfig, getNextYearConfig) and
 * validates the integrity of the YEAR_CONFIGS array.
 */
import {
  DEFAULT_ERA,
  YEAR_CONFIGS,
  getYearConfig,
  getNextYearConfig,
  type EraId,
} from '@/config/years';

describe('years config', () => {
  describe('YEAR_CONFIGS', () => {
    it('contains exactly five eras', () => {
      expect(YEAR_CONFIGS).toHaveLength(5);
    });

    it('is ordered by year ascending', () => {
      const years = YEAR_CONFIGS.map((c) => c.year);
      const sorted = [...years].sort((a, b) => a - b);
      expect(years).toEqual(sorted);
    });

    it('has unique era ids', () => {
      const ids = YEAR_CONFIGS.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('has unique labels', () => {
      const labels = YEAR_CONFIGS.map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);
    });

    it('has density values in [0, 1]', () => {
      for (const config of YEAR_CONFIGS) {
        expect(config.density).toBeGreaterThanOrEqual(0);
        expect(config.density).toBeLessThanOrEqual(1);
      }
    });

    it('has positive maxHeight values', () => {
      for (const config of YEAR_CONFIGS) {
        expect(config.maxHeight).toBeGreaterThan(0);
      }
    });

    it('has valid hex palette strings', () => {
      for (const config of YEAR_CONFIGS) {
        expect(config.palette).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });
  });

  describe('DEFAULT_ERA', () => {
    it('is the latest era (present)', () => {
      expect(DEFAULT_ERA).toBe('present');
    });

    it('resolves to a valid config', () => {
      expect(getYearConfig(DEFAULT_ERA)).toBeDefined();
    });
  });

  describe('getYearConfig', () => {
    it('returns the config for a known era id', () => {
      const config = getYearConfig('postwar');
      expect(config).toBeDefined();
      expect(config?.id).toBe('postwar');
      expect(config?.label).toBe('1945');
      expect(config?.year).toBe(1945);
    });

    it('returns the correct config for each era', () => {
      const expected: Record<EraId, string> = {
        postwar: '1945',
        sixties: '1965',
        eighties: '1985',
        twothousands: '2005',
        present: '2025',
      };
      for (const id of Object.keys(expected) as EraId[]) {
        expect(getYearConfig(id)?.label).toBe(expected[id]);
      }
    });

    it('returns undefined for an unknown era id', () => {
      // Type assertion to test the runtime fallback path.
      expect(getYearConfig('unknown' as EraId)).toBeUndefined();
    });
  });

  describe('getNextYearConfig', () => {
    it('returns the chronologically-next era for the first era', () => {
      expect(getNextYearConfig('postwar')?.id).toBe('sixties');
    });

    it('returns the chronologically-next era for a middle era', () => {
      expect(getNextYearConfig('sixties')?.id).toBe('eighties');
      expect(getNextYearConfig('eighties')?.id).toBe('twothousands');
      expect(getNextYearConfig('twothousands')?.id).toBe('present');
    });

    it('returns undefined for the latest era (no successor)', () => {
      expect(getNextYearConfig('present')).toBeUndefined();
    });

    it('returns undefined for an unknown era id', () => {
      expect(getNextYearConfig('unknown' as EraId)).toBeUndefined();
    });
  });
});
