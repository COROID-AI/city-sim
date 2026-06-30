/**
 * Unit tests for the EffectsControls component.
 *
 * Verifies the particle and bloom toggle buttons render, reflect store state,
 * and dispatch the correct toggle actions on click.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useEffectsStore } from '@/store/effectsStore';
import EffectsControls from './EffectsControls';

function resetStore() {
  useEffectsStore.setState({
    particlesEnabled: true,
    bloomEnabled: true,
  });
}

describe('EffectsControls', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the particles toggle button', () => {
    render(<EffectsControls />);
    expect(screen.getByTestId('particles-toggle')).toBeInTheDocument();
  });

  it('renders the bloom toggle button', () => {
    render(<EffectsControls />);
    expect(screen.getByTestId('bloom-toggle')).toBeInTheDocument();
  });

  it('reflects enabled state initially for both toggles', () => {
    render(<EffectsControls />);
    expect(screen.getByTestId('particles-toggle')).toHaveAttribute(
      'data-enabled',
      'true',
    );
    expect(screen.getByTestId('bloom-toggle')).toHaveAttribute(
      'data-enabled',
      'true',
    );
  });

  it('dispatches toggleParticles when the particles button is clicked', () => {
    render(<EffectsControls />);
    fireEvent.click(screen.getByTestId('particles-toggle'));
    expect(useEffectsStore.getState().particlesEnabled).toBe(false);
  });

  it('dispatches toggleBloom when the bloom button is clicked', () => {
    render(<EffectsControls />);
    fireEvent.click(screen.getByTestId('bloom-toggle'));
    expect(useEffectsStore.getState().bloomEnabled).toBe(false);
  });

  it('reflects disabled state after toggling particles off', () => {
    render(<EffectsControls />);
    fireEvent.click(screen.getByTestId('particles-toggle'));
    expect(screen.getByTestId('particles-toggle')).toHaveAttribute(
      'data-enabled',
      'false',
    );
    expect(screen.getByTestId('particles-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('reflects disabled state after toggling bloom off', () => {
    render(<EffectsControls />);
    fireEvent.click(screen.getByTestId('bloom-toggle'));
    expect(screen.getByTestId('bloom-toggle')).toHaveAttribute(
      'data-enabled',
      'false',
    );
    expect(screen.getByTestId('bloom-toggle')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('renders the FX label', () => {
    render(<EffectsControls />);
    expect(screen.getByTestId('effects-label')).toHaveTextContent('FX');
  });
});
