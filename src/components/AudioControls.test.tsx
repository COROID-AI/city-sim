/**
 * Unit tests for the AudioControls component.
 *
 * Verifies the mute toggle renders, reflects store state, and dispatches
 * toggleMute on click. Also checks the SFX indicator data attribute.
 */
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useAudioStore } from '@/store/audioStore';
import AudioControls from './AudioControls';

function resetStore() {
  useAudioStore.setState({
    muted: false,
    volume: 0.6,
    unlocked: false,
    sfxPulse: false,
  });
}

describe('AudioControls', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the mute toggle button', () => {
    render(<AudioControls />);
    expect(
      screen.getByTestId('audio-mute-toggle'),
    ).toBeInTheDocument();
  });

  it('reflects unmuted state initially', () => {
    render(<AudioControls />);
    const toggle = screen.getByTestId('audio-mute-toggle');
    expect(toggle).toHaveAttribute('data-muted', 'false');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('dispatches toggleMute when clicked', () => {
    render(<AudioControls />);
    fireEvent.click(screen.getByTestId('audio-mute-toggle'));
    expect(useAudioStore.getState().muted).toBe(true);
  });

  it('shows muted state after toggling', () => {
    render(<AudioControls />);
    fireEvent.click(screen.getByTestId('audio-mute-toggle'));
    const toggle = screen.getByTestId('audio-mute-toggle');
    expect(toggle).toHaveAttribute('data-muted', 'true');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the SFX indicator', () => {
    render(<AudioControls />);
    const indicator = screen.getByTestId('audio-sfx-indicator');
    expect(indicator).toHaveAttribute('data-pulse', 'false');
  });

  it('reflects SFX pulse state from the store', () => {
    useAudioStore.setState({ sfxPulse: true });
    render(<AudioControls />);
    expect(screen.getByTestId('audio-sfx-indicator')).toHaveAttribute(
      'data-pulse',
      'true',
    );
  });

  it('shows an unlock hint before the first interaction', () => {
    render(<AudioControls />);
    expect(screen.getByTestId('audio-unlock-hint')).toBeInTheDocument();
  });

  it('hides the unlock hint once unlocked', () => {
    useAudioStore.setState({ unlocked: true });
    render(<AudioControls />);
    expect(
      screen.queryByTestId('audio-unlock-hint'),
    ).not.toBeInTheDocument();
  });
});
