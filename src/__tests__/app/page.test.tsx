/**
 * Smoke render test for the app shell (src/app/page.tsx).
 *
 * Guarantees the fullscreen city canvas and the four UI overlay anchor
 * containers exist in the DOM so downstream tasks can populate them.
 *
 * Test ID mapping (task shorthand -> actual data-testid in page.tsx):
 *   top-bar       -> ui-top-bar
 *   event-log     -> ui-event-log
 *   time-controls -> ui-time-controls
 *   minimap       -> ui-minimap
 * The page.tsx source is authoritative; the task description uses shorthand.
 */
import { afterEach, describe, expect, it } from '@jest/globals';
import { cleanup, render, screen } from '@testing-library/react';
import Home from '@/app/page';

// Surface @testing-library/jest-dom matcher types (toBeInTheDocument, etc.)
// for tsc --noEmit. jest.setup.ts imports the runtime side at test time.
/// <reference types="@testing-library/jest-dom" />

afterEach(() => {
  cleanup();
});

describe('app/page.tsx shell', () => {
  it('renders the fullscreen city canvas', () => {
    render(<Home />);
    const canvas = screen.getByTestId('city-canvas');
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.tagName).toBe('CANVAS');
  });

  it('renders the four UI overlay anchors', () => {
    render(<Home />);
    // getByTestId throws if the element is absent, so resolution alone
    // proves the anchor exists; toBeTruthy() asserts a non-null node.
    expect(screen.getByTestId('ui-top-bar')).toBeTruthy();
    expect(screen.getByTestId('ui-event-log')).toBeTruthy();
    expect(screen.getByTestId('ui-time-controls')).toBeTruthy();
    expect(screen.getByTestId('ui-minimap')).toBeTruthy();
  });
});
