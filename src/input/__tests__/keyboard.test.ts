import { describe, expect, it } from '@jest/globals';
import { mapKeyToAction } from '../keyboard';

describe('mapKeyToAction', () => {
  it('maps ArrowLeft to a left move', () => {
    expect(mapKeyToAction('ArrowLeft')).toEqual({
      type: 'move',
      dir: 'left',
    });
  });

  it('maps ArrowRight to a right move', () => {
    expect(mapKeyToAction('ArrowRight')).toEqual({
      type: 'move',
      dir: 'right',
    });
  });

  it('maps ArrowDown to a soft drop', () => {
    expect(mapKeyToAction('ArrowDown')).toEqual({ type: 'softDrop' });
  });

  it('maps ArrowUp to a clockwise rotation', () => {
    expect(mapKeyToAction('ArrowUp')).toEqual({ type: 'rotate', dir: 1 });
  });

  it('returns a fresh action object on every call', () => {
    expect(mapKeyToAction('ArrowLeft')).not.toBe(mapKeyToAction('ArrowLeft'));
  });

  it.each([
    'a',
    'w',
    's',
    'd',
    'Enter',
    ' ',
    'Shift',
    'Control',
    'arrowup',
    '',
  ])('ignores non-arrow key %j', (key) => {
    expect(mapKeyToAction(key)).toBeNull();
  });
});