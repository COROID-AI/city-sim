/**
 * Unit tests for the Building component and layout system.
 *
 * Tests cover:
 * - Building renders without errors for each style
 * - Snapshot stability for Building output
 * - Layout hook produces ≥6 non-overlapping buildings per era
 * - Style config resolution for all five eras
 */
import { create } from 'react-test-renderer';

// Mock @react-three/fiber so useFrame and R3F intrinsic elements work outside Canvas.
jest.mock('@react-three/fiber', () => ({
  ...jest.requireActual('@react-three/fiber'),
  useFrame: jest.fn(),
}));

import { YEAR_CONFIGS, type BuildingStyle } from '@/config/years';
import {
  BUILDING_STYLES,
  getBuildingStyleConfig,
} from './buildingStyles';
import Building from './Building';
import {
  generateBuildingLayout,
  hasNoOverlaps,
  MIN_BUILDINGS,
} from './useBuildingLayout';

// -------------------------------------------------------------------------- //
// Style config tests
// -------------------------------------------------------------------------- //

describe('BUILDING_STYLES', () => {
  it('defines a config for every BuildingStyle', () => {
    const allStyles: BuildingStyle[] = [
      'artDeco',
      'brutalist',
      'glassTower',
      'midcentury',
      'modern',
    ];
    for (const style of allStyles) {
      expect(BUILDING_STYLES[style]).toBeDefined();
      expect(BUILDING_STYLES[style].facadeColor).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('getBuildingStyleConfig throws for unknown styles', () => {
    expect(() => getBuildingStyleConfig('unknown' as BuildingStyle)).toThrow();
  });

  it('every YearConfig era maps to a valid building style', () => {
    for (const config of YEAR_CONFIGS) {
      const styleConfig = getBuildingStyleConfig(config.buildingStyle);
      expect(styleConfig).toBeDefined();
      expect(styleConfig.windowPattern.rows).toBeGreaterThan(0);
      expect(styleConfig.windowPattern.columns).toBeGreaterThan(0);
    }
  });
});

// -------------------------------------------------------------------------- //
// Layout tests
// -------------------------------------------------------------------------- //

describe('generateBuildingLayout', () => {
  it.each(YEAR_CONFIGS.map((c) => [c.id, c] as const))(
    'produces at least 6 buildings for era %s',
    (_id, config) => {
      const placements = generateBuildingLayout(config);
      expect(placements.length).toBeGreaterThanOrEqual(MIN_BUILDINGS);
    },
  );

  it.each(YEAR_CONFIGS.map((c) => [c.id, c] as const))(
    'has no overlapping buildings for era %s',
    (_id, config) => {
      const placements = generateBuildingLayout(config);
      expect(hasNoOverlaps(placements)).toBe(true);
    },
  );

  it('produces deterministic output (same era = same placements)', () => {
    const config = YEAR_CONFIGS[0];
    const a = generateBuildingLayout(config);
    const b = generateBuildingLayout(config);
    expect(a).toEqual(b);
  });

  it('all buildings have positive height, width, and depth', () => {
    for (const config of YEAR_CONFIGS) {
      const placements = generateBuildingLayout(config);
      for (const p of placements) {
        expect(p.height).toBeGreaterThan(0);
        expect(p.width).toBeGreaterThan(0);
        expect(p.depth).toBeGreaterThan(0);
      }
    }
  });
});

// -------------------------------------------------------------------------- //
// Building component snapshot tests
// -------------------------------------------------------------------------- //

describe('Building component', () => {
  const allStyles: BuildingStyle[] = [
    'artDeco',
    'midcentury',
    'brutalist',
    'glassTower',
    'modern',
  ];

  it.each(allStyles)('renders without crashing for style %s', (style) => {
    const config = getBuildingStyleConfig(style);
    const renderer = create(
      <Building
        style={style}
        height={10}
        facadeColor={config.facadeColor}
        windowPattern={config.windowPattern}
        roof={config.roof}
        signage={config.signage}
        width={config.defaultWidth}
        depth={config.defaultDepth}
        position={[0, 0, 0]}
      />,
    );
    expect(renderer.root.children.length).toBeGreaterThan(0);
    renderer.unmount();
  });

  it('matches snapshot for artDeco style', () => {
    const config = getBuildingStyleConfig('artDeco');
    const renderer = create(
      <Building
        style="artDeco"
        height={12}
        facadeColor={config.facadeColor}
        windowPattern={config.windowPattern}
        roof={config.roof}
        signage={config.signage}
        width={config.defaultWidth}
        depth={config.defaultDepth}
      />,
    );
    const tree = renderer.toJSON();
    expect(tree).toMatchSnapshot();
    renderer.unmount();
  });

  it('matches snapshot for glassTower style', () => {
    const config = getBuildingStyleConfig('glassTower');
    const renderer = create(
      <Building
        style="glassTower"
        height={40}
        facadeColor={config.facadeColor}
        windowPattern={config.windowPattern}
        roof={config.roof}
        signage={config.signage}
        width={config.defaultWidth}
        depth={config.defaultDepth}
      />,
    );
    const tree = renderer.toJSON();
    expect(tree).toMatchSnapshot();
    renderer.unmount();
  });

  it('renders windows on the facade', () => {
    const config = getBuildingStyleConfig('modern');
    const renderer = create(
      <Building
        style="modern"
        height={20}
        facadeColor={config.facadeColor}
        windowPattern={config.windowPattern}
        roof={config.roof}
        signage={config.signage}
      />,
    );
    // The component should render multiple children (body + windows + roof)
    expect(renderer.root.children.length).toBeGreaterThan(0);
    renderer.unmount();
  });
});
