/**
 * Unit tests for the era-dependent street props, storefront, and billboard
 * configuration and components.
 */
import { render } from '@testing-library/react';
import {
  ERA_STREET_CONFIG,
  getEraStreetConfig,
} from '@/config/storefronts';
import { YEAR_CONFIGS, type EraId } from '@/config/years';

// react-three-fiber JSX elements are not renderable in jsdom; we test the
// data layer and component wiring (props/config) rather than the WebGL tree.
jest.mock('@react-three/drei', () => ({
  Text: ({ children }: { children: React.ReactNode }) =>
    children as unknown as null,
}));

describe('ERA_STREET_CONFIG', () => {
  it('defines a config for every era in YEAR_CONFIGS', () => {
    for (const config of YEAR_CONFIGS) {
      expect(ERA_STREET_CONFIG[config.id]).toBeDefined();
    }
  });

  it('gives each era at least one storefront and one billboard', () => {
    for (const config of YEAR_CONFIGS) {
      const street = ERA_STREET_CONFIG[config.id];
      expect(street.storefronts.length).toBeGreaterThanOrEqual(1);
      expect(street.billboards.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('gives every storefront a name and distinct colors', () => {
    for (const config of YEAR_CONFIGS) {
      for (const sf of ERA_STREET_CONFIG[config.id].storefronts) {
        expect(sf.name.length).toBeGreaterThan(0);
        expect(sf.signColor).toMatch(/^#[0-9a-f]{6}$/i);
        expect(sf.textColor).toMatch(/^#[0-9a-f]{6}$/i);
        expect(sf.awningColor).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('gives every billboard headline copy and colors', () => {
    for (const config of YEAR_CONFIGS) {
      for (const bb of ERA_STREET_CONFIG[config.id].billboards) {
        expect(bb.headline.length).toBeGreaterThan(0);
        expect(bb.boardColor).toMatch(/^#[0-9a-f]{6}$/i);
        expect(bb.textColor).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

describe('phone booth era gating', () => {
  it('hides the phone booth in 1945 (postwar)', () => {
    expect(ERA_STREET_CONFIG.postwar.props.phoneBooth).toBe(false);
  });

  it('shows the phone booth in 1965 (sixties)', () => {
    expect(ERA_STREET_CONFIG.sixties.props.phoneBooth).toBe(true);
  });

  it('shows the phone booth in 1985 (eighties)', () => {
    expect(ERA_STREET_CONFIG.eighties.props.phoneBooth).toBe(true);
  });

  it('hides the phone booth in 2005 (twothousands)', () => {
    expect(ERA_STREET_CONFIG.twothousands.props.phoneBooth).toBe(false);
  });

  it('hides the phone booth in 2025 (present)', () => {
    expect(ERA_STREET_CONFIG.present.props.phoneBooth).toBe(false);
  });
});

describe('getEraStreetConfig', () => {
  it('returns the matching era config', () => {
    const cfg = getEraStreetConfig('sixties');
    expect(cfg.storefronts[0].name).toBe('Mod Fashions');
  });

  it('falls back to present for an unknown era id', () => {
    const cfg = getEraStreetConfig('nonexistent' as EraId);
    expect(cfg).toBe(ERA_STREET_CONFIG.present);
  });
});

describe('Storefront component wiring', () => {
  it('renders without crashing for a valid config', async () => {
    const { default: Storefront } = await import('./Storefront');
    const cfg = ERA_STREET_CONFIG.postwar.storefronts[0];
    const { unmount } = render(
      <Storefront position={[0, 0, 0]} config={cfg} />,
    );
    unmount();
  });
});

describe('Billboard component wiring', () => {
  it('renders without crashing for a valid config', async () => {
    const { default: Billboard } = await import('./Billboard');
    const cfg = ERA_STREET_CONFIG.eighties.billboards[0];
    const { unmount } = render(
      <Billboard position={[0, 0, 0]} config={cfg} />,
    );
    unmount();
  });
});
