/**
 * Tests for src/ui/Tooltip.tsx.
 *
 * RTL render, assertion on text content + visibility toggle on null
 * vs present.
 */

import { render, screen } from '@testing-library/react';
import { Tooltip, activityLabel } from '@/ui/Tooltip';
import { createCitizen, type Citizen } from '@/entities/Citizen';
import type { Citizen as CitizenType } from '@/engine/types';

function makeCitizen(overrides: Partial<CitizenType> = {}): Citizen {
  return createCitizen({ id: 'c-1', name: 'Alex Chen', ...overrides });
}

describe('Tooltip', () => {
  test('renders nothing when citizen is null', () => {
    const { container } = render(<Tooltip citizen={null} x={0} y={0} />);
    expect(container.firstChild).toBeNull();
  });

  test('renders the citizen name and activity label when present', () => {
    const c = makeCitizen();
    render(<Tooltip citizen={c} x={100} y={100} />);
    expect(screen.getByText('Alex Chen')).toBeInTheDocument();
    // createCitizen defaults to 'idle', so activityLabel returns 'Idle'.
    expect(screen.getByText('Idle')).toBeInTheDocument();
  });

  test('hides when citizen is switched to null', () => {
    const c = makeCitizen();
    const { rerender, container } = render(<Tooltip citizen={c} x={100} y={100} />);
    expect(container.firstChild).not.toBeNull();
    rerender(<Tooltip citizen={null} x={100} y={100} />);
    expect(container.firstChild).toBeNull();
  });

  test('reflects the current activity state in the rendered label', () => {
    const c = makeCitizen();
    c.state = 'commuting';
    const { rerender } = render(<Tooltip citizen={c} x={100} y={100} />);
    expect(screen.getByText('Commuting')).toBeInTheDocument();
    c.state = 'working';
    rerender(<Tooltip citizen={c} x={100} y={100} />);
    expect(screen.getByText('Working')).toBeInTheDocument();
  });
});

describe('activityLabel', () => {
  test('maps all CitizenState values to expected human strings', () => {
    expect(activityLabel('idle')).toBe('Idle');
    expect(activityLabel('commuting')).toBe('Commuting');
    expect(activityLabel('working')).toBe('Working');
    expect(activityLabel('shopping')).toBe('Errand');
    expect(activityLabel('resting')).toBe('Sleeping');
    expect(activityLabel('leisure')).toBe('Leisure');
  });
});
