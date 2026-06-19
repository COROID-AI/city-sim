/// <reference types="@testing-library/jest-dom" />
import { GRID_SIZE } from '@/lib/constants';

describe('test harness smoke test', () => {
  it('resolves the @/ path alias', () => {
    expect(GRID_SIZE).toBeDefined();
  });

  it('encodes the 80x80 grid spec', () => {
    expect(GRID_SIZE).toBe(80);
  });

  it('registers jest-dom custom matchers', () => {
    // jest-dom augments expect with DOM matchers like toBeInTheDocument.
    // If the setup file failed to load, this assertion throws at runtime.
    const el = document.createElement('div');
    document.body.appendChild(el);
    expect(el).toBeInTheDocument();
    expect(typeof expect(el).toBeInTheDocument).toBe('function');
  });
});
