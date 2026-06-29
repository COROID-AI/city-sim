import { render, screen } from '@testing-library/react';
import React from 'react';
import TimeCityPage from '@/app/time-city/page';

// Mock the Three.js canvas component to avoid WebGL in jsdom
jest.mock('@/app/time-city/components/TimeCityCanvas', () => {
  function MockCanvas() {
    return React.createElement('canvas', { 'data-testid': 'mock-canvas' });
  }
  return MockCanvas;
});

describe('TimeCityPage', () => {
  it('renders the scene header with title', () => {
    render(<TimeCityPage />);
    const header = screen.getByTestId('scene-header');
    expect(header).toBeInTheDocument();
    expect(screen.getByText('Time City')).toBeInTheDocument();
  });

  it('renders a canvas element', () => {
    render(<TimeCityPage />);
    const canvas = screen.getByTestId('mock-canvas');
    expect(canvas).toBeInTheDocument();
    expect(canvas.tagName.toLowerCase()).toBe('canvas');
  });
});
