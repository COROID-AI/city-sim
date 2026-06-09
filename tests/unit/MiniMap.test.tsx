/**
 * MiniMap — unit tests.
 *
 * Spec reference: §6.4 Dashboard Layout.
 *
 * Mounts the MiniMap with a hand-rolled CitySnapshot, asserts the
 * canvas element appears with the expected testid, and re-renders
 * with a fresh snapshot to confirm the component doesn't throw on
 * prop changes.
 */
import { act, createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { MiniMap } from '@/ui/MiniMap';
import { buildCitySnapshot } from '@/ui/CitySnapshot';

function mount(snapshot: ReturnType<typeof buildCitySnapshot>): {
  host: HTMLElement;
  root: Root;
  rerender(next: ReturnType<typeof buildCitySnapshot>): void;
  cleanup(): void;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(MiniMap, { snapshot }));
  });
  return {
    host,
    root,
    rerender(next) {
      act(() => {
        root.render(createElement(MiniMap, { snapshot: next }));
      });
    },
    cleanup() {
      act(() => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe('MiniMap', () => {
  it('renders a <canvas> with the city-minimap testid', () => {
    const snap = buildCitySnapshot({
      day: 1,
      hour: 0,
      minute: 0,
      budget: 0,
      openCompanies: 0,
      totalCompanies: 0,
    });
    const c = mount(snap);
    const canvas = c.host.querySelector('canvas[data-testid="city-minimap-canvas"]');
    expect(canvas).not.toBeNull();
    const section = c.host.querySelector('[data-testid="city-minimap"]');
    expect(section).not.toBeNull();
    c.cleanup();
  });

  it('re-renders without throwing when the snapshot changes', () => {
    const a = buildCitySnapshot({
      day: 1,
      hour: 0,
      minute: 0,
      budget: 0,
      openCompanies: 0,
      totalCompanies: 0,
      citizens: [],
    });
    const c = mount(a);
    const b = buildCitySnapshot({
      day: 2,
      hour: 1,
      minute: 30,
      budget: 100,
      openCompanies: 1,
      totalCompanies: 2,
      worldBounds: { min: { x: -10, y: -10 }, max: { x: 110, y: 110 } },
    });
    expect(() => c.rerender(b)).not.toThrow();
    expect(c.host.querySelector('canvas')).not.toBeNull();
    c.cleanup();
  });
});
