/**
 * Unit tests for the year state store and its selectors.
 */
import {
  createYearStore,
  selectCurrentYearConfig,
  selectIsTransitioning,
  selectNextYearConfig,
  selectUpcomingYearConfig,
} from '@/store/yearStore';
import { DEFAULT_ERA, YEAR_CONFIGS, getYearConfig } from '@/config/years';
import type { YearState } from '@/store/yearStore';

describe('yearStore', () => {
  describe('initial state', () => {
    it('exposes selectedYear, targetYear, and transitionProgress', () => {
      const store = createYearStore();
      const state = store.getState();

      expect(state.selectedYear).toBe(DEFAULT_ERA);
      expect(state.targetYear).toBe(DEFAULT_ERA);
      expect(state.transitionProgress).toBe(1);
    });

    it('starts at rest (not transitioning)', () => {
      const store = createYearStore();
      expect(selectIsTransitioning(store.getState())).toBe(false);
    });
  });

  describe('setYear', () => {
    it('updates targetYear and resets transitionProgress to 0', () => {
      const store = createYearStore();
      store.getState().setYear('postwar');

      const state = store.getState();
      expect(state.targetYear).toBe('postwar');
      expect(state.transitionProgress).toBe(0);
      // selectedYear must NOT change until the transition completes.
      expect(state.selectedYear).toBe(DEFAULT_ERA);
    });

    it('is a no-op when already at rest on the requested era', () => {
      const store = createYearStore();
      const before = store.getState();

      store.getState().setYear(DEFAULT_ERA);

      const after = store.getState();
      expect(after.targetYear).toBe(before.targetYear);
      expect(after.transitionProgress).toBe(before.transitionProgress);
      expect(after.selectedYear).toBe(before.selectedYear);
    });

    it('retargets when a transition is already in flight', () => {
      const store = createYearStore();
      store.getState().setYear('postwar');
      store.getState().tickTransition(0.4);

      // Retarget to a different era mid-transition.
      store.getState().setYear('eighties');

      const state = store.getState();
      expect(state.targetYear).toBe('eighties');
      expect(state.transitionProgress).toBe(0);
      expect(state.selectedYear).toBe(DEFAULT_ERA);
    });
  });

  describe('tickTransition', () => {
    it('advances progress by the given delta', () => {
      const store = createYearStore();
      store.getState().setYear('sixties');

      store.getState().tickTransition(0.25);
      expect(store.getState().transitionProgress).toBeCloseTo(0.25);

      store.getState().tickTransition(0.25);
      expect(store.getState().transitionProgress).toBeCloseTo(0.5);
    });

    it('clamps progress to 1', () => {
      const store = createYearStore();
      store.getState().setYear('sixties');

      store.getState().tickTransition(2);
      expect(store.getState().transitionProgress).toBe(1);
    });

    it('clamps progress to 0 for negative deltas', () => {
      const store = createYearStore();
      store.getState().setYear('sixties');

      store.getState().tickTransition(-0.5);
      expect(store.getState().transitionProgress).toBe(0);
    });

    it('progress updates from 0 to 1 during a full transition', () => {
      const store = createYearStore();
      store.getState().setYear('postwar');
      expect(store.getState().transitionProgress).toBe(0);

      store.getState().tickTransition(1);
      expect(store.getState().transitionProgress).toBe(1);
    });
  });

  describe('completeTransition', () => {
    it('copies targetYear into selectedYear and snaps progress to 1', () => {
      const store = createYearStore();
      store.getState().setYear('postwar');
      store.getState().tickTransition(0.6);

      store.getState().completeTransition();

      const state = store.getState();
      expect(state.selectedYear).toBe('postwar');
      expect(state.targetYear).toBe('postwar');
      expect(state.transitionProgress).toBe(1);
    });
  });

  describe('selectors', () => {
    const baseState = (overrides: Partial<YearState> = {}): YearState => ({
      selectedYear: DEFAULT_ERA,
      targetYear: DEFAULT_ERA,
      transitionProgress: 1,
      setYear: jest.fn(),
      tickTransition: jest.fn(),
      completeTransition: jest.fn(),
      ...overrides,
    });

    it('selectCurrentYearConfig returns the config for selectedYear', () => {
      const state = baseState({ selectedYear: 'postwar' });
      expect(selectCurrentYearConfig(state)).toEqual(getYearConfig('postwar'));
    });

    it('selectNextYearConfig returns the config for targetYear', () => {
      const state = baseState({ targetYear: 'postwar' });
      expect(selectNextYearConfig(state)).toEqual(getYearConfig('postwar'));
    });

    it('selectNextYearConfig equals current config while at rest', () => {
      const state = baseState();
      expect(selectNextYearConfig(state)).toEqual(
        selectCurrentYearConfig(state),
      );
    });

    it('selectUpcomingYearConfig returns the chronologically-next era', () => {
      const state = baseState({ targetYear: 'postwar' });
      // postwar (1945) -> sixties (1965)
      expect(selectUpcomingYearConfig(state)).toEqual(
        getYearConfig('sixties'),
      );
    });

    it('selectUpcomingYearConfig is undefined for the latest era', () => {
      const state = baseState({ targetYear: 'present' });
      expect(selectUpcomingYearConfig(state)).toBeUndefined();
    });

    it('selectIsTransitioning is true while progress < 1', () => {
      expect(selectIsTransitioning(baseState({ transitionProgress: 0 }))).toBe(
        true,
      );
      expect(
        selectIsTransitioning(baseState({ transitionProgress: 0.5 })),
      ).toBe(true);
    });

    it('selectIsTransitioning is false at progress 1', () => {
      expect(selectIsTransitioning(baseState({ transitionProgress: 1 }))).toBe(
        false,
      );
    });
  });

  describe('year config data integrity', () => {
    it('YEAR_CONFIGS is ordered by year ascending', () => {
      const years = YEAR_CONFIGS.map((c) => c.year);
      const sorted = [...years].sort((a, b) => a - b);
      expect(years).toEqual(sorted);
    });

    it('every era id resolves to a config', () => {
      const ids = [
        'postwar',
        'sixties',
        'eighties',
        'twothousands',
        'present',
      ] as const;
      for (const id of ids) {
        expect(getYearConfig(id)).toBeDefined();
      }
    });
  });
});
