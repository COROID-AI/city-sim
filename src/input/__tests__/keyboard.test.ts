import { describe, expect, it } from '@jest/globals';
import { mapKeyToAction } from '../keyboard';

describe('mapKeyToAction', () => {
  it('maps ArrowLeft to a move-left action', () => {
    expect(mapKeyToAction('ArrowLeft')).toEqual({ type: 'move', dir: 'left' });
  });

  it('maps ArrowRight to a move-right action', () => {
    expect(mapKeyToAction('ArrowRight')).toEqual({ type: 'move', dir: 'right' });
  });

  it('maps ArrowDown to a soft-drop action', () => {
    expect(mapKeyToAction('ArrowDown')).toEqual({ type: 'softDrop' });
  });

  it('maps ArrowUp to a clockwise rotate action', () => {
    expect(mapKeyToAction('ArrowUp')).toEqual({ type: 'rotate', dir: 1 });
  });

  it('returns null for non-arrow keys', () => {
    for (const key of ['w', 'a', 's', 'd', 'Enter', ' ', 'ArrowFoo', '']) {
      expect(mapKeyToAction(key)).toBeNull();
    }
  });
});
