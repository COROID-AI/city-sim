import { keyToAction } from './keyboard';
import { Direction } from '../game/types';

/** Minimal stub matching the only property `keyToAction` reads. */
function keyEvent(key: string): { key: string } {
  return { key };
}

describe('keyToAction', () => {
  it('maps ArrowLeft to a left move', () => {
    expect(keyToAction(keyEvent('ArrowLeft') as KeyboardEvent)).toEqual({
      type: 'move',
      dir: Direction.Left,
    });
  });

  it('maps ArrowRight to a right move', () => {
    expect(keyToAction(keyEvent('ArrowRight') as KeyboardEvent)).toEqual({
      type: 'move',
      dir: Direction.Right,
    });
  });

  it('maps ArrowDown to a soft drop', () => {
    expect(keyToAction(keyEvent('ArrowDown') as KeyboardEvent)).toEqual({
      type: 'softDrop',
    });
  });

  it('maps ArrowUp to a clockwise rotate', () => {
    expect(keyToAction(keyEvent('ArrowUp') as KeyboardEvent)).toEqual({
      type: 'rotate',
      dir: 'cw',
    });
  });

  it('returns null for every non-arrow key', () => {
    const others = [
      'a',
      'A',
      'Enter',
      ' ',
      'Space',
      'w',
      's',
      'd',
      'Escape',
      'Shift',
      'Tab',
      '1',
      'F5',
      '',
    ];
    for (const k of others) {
      expect(keyToAction(keyEvent(k) as KeyboardEvent)).toBeNull();
    }
  });

  it('returns null for empty/unknown keys', () => {
    expect(keyToAction(keyEvent('Unidentified') as KeyboardEvent)).toBeNull();
  });
});
