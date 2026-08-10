// Keyboard input mapping. Only touch here: key events and handler delegation.

const KEY_MAP = {
  ArrowLeft: 'moveLeft',
  ArrowRight: 'moveRight',
  ArrowDown: 'softDrop',
  ArrowUp: 'rotateCW',
  ' ': 'hardDrop',
  a: 'moveLeft',
  A: 'moveLeft',
  d: 'moveRight',
  D: 'moveRight',
  s: 'softDrop',
  S: 'softDrop',
  w: 'rotateCW',
  W: 'rotateCW',
  x: 'rotateCW',
  X: 'rotateCW',
  z: 'rotateCCW',
  Z: 'rotateCCW',
  c: 'hold',
  C: 'hold',
  p: 'togglePause',
  P: 'togglePause',
  Escape: 'togglePause',
  Enter: 'startOrRestart',
};

// These fire once per physical press, never on key auto-repeat.
const DISCRETE = new Set(['rotateCW', 'rotateCCW', 'hardDrop', 'hold', 'togglePause', 'startOrRestart']);

export function attachInput(handlers, target = window) {
  function onKeyDown(event) {
    const action = KEY_MAP[event.key];
    if (!action) return;
    if (DISCRETE.has(action) && event.repeat) return;
    event.preventDefault();
    const handler = handlers[action];
    if (handler) handler();
  }
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}