/**
 * Tooltip unit tests (spec §6.4).
 */
import { render, screen } from '@testing-library/react';
import Tooltip, { TOOLTIP_OFFSET, type TooltipContent } from '@/ui/Tooltip';
import { Citizen } from '@/entities/Citizen';
import type { Building, BuildingDef } from '@/engine/types';

/** Minimal BuildingDef factory for tests. */
function makeDef(name: string, capacity: number): BuildingDef {
  return {
    id: name,
    name,
    type: 'house',
    width: 1,
    height: 1,
    cost: 0,
    upkeep: 0,
    capacity,
    color: '#000000',
  };
}

/** Build a Building instance. */
function makeBuilding(name: string, capacity: number): Building {
  return {
    id: name,
    type: 'house',
    zone: 'residential',
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    def: makeDef(name, capacity),
  };
}

describe('Tooltip', () => {
  it('renders nothing when content is null', () => {
    const { container } = render(<Tooltip content={null} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('tooltip')).toBeNull();
  });

  it('renders citizen name + currentActivity for a citizen payload', () => {
    const citizen = new Citizen({ x: 0, y: 0 }, { name: 'Ada Lovelace', employed: true });
    citizen.activity = 'working';
    const content: TooltipContent = { kind: 'citizen', citizen, x: 100, y: 200 };

    render(<Tooltip content={content} />);

    expect(screen.getByTestId('tooltip-citizen-name').textContent).toBe('Ada Lovelace');
    expect(screen.getByTestId('tooltip-citizen-activity').textContent).toBe('Working');
  });

  it('renders building name + occupancy (count/capacity) for a building payload', () => {
    const building = makeBuilding('Apartment', 4);
    const content: TooltipContent = {
      kind: 'building',
      building,
      occupancy: 2,
      x: 50,
      y: 60,
    };

    render(<Tooltip content={content} />);

    expect(screen.getByTestId('tooltip-building-name').textContent).toBe('Apartment');
    expect(screen.getByTestId('tooltip-building-occupancy').textContent).toBe(
      'Occupancy: 2/4',
    );
  });

  it('is positioned at x/y + TOOLTIP_OFFSET (12px) with a dark translucent background', () => {
    const citizen = new Citizen({ x: 0, y: 0 }, { name: 'Test', employed: true });
    citizen.activity = 'sleeping';
    const content: TooltipContent = { kind: 'citizen', citizen, x: 30, y: 40 };

    render(<Tooltip content={content} />);

    const tooltip = screen.getByTestId('tooltip');
    expect(tooltip.style.left).toBe(`${30 + TOOLTIP_OFFSET}px`);
    expect(tooltip.style.top).toBe(`${40 + TOOLTIP_OFFSET}px`);
    // Dark translucent background (rgba with alpha < 1).
    expect(tooltip.style.backgroundColor).toMatch(/rgba\(/);
  });
});
