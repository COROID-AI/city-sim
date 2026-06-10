// Jest setup — runs before every test suite.
//
// Polyfill TextEncoder/TextDecoder on globalThis. The jsdom <26
// environment used by Jest 29 does not provide them, and direct
// imports of `jsdom` (e.g. tests that want a real DOM) pull in
// `whatwg-url`, which dereferences `TextEncoder` at module load.
if (typeof globalThis.TextEncoder === 'undefined') {
  const { TextEncoder, TextDecoder } = require('util');
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// Stub a minimal 2D canvas context. jsdom <26 does not implement
// HTMLCanvasElement.getContext('2d'), which would return null and
// make Renderer createRenderer throw. This is enough for the unit
// tests to spy on `arc`/`fill`/`fillRect` calls.
if (typeof globalThis.HTMLCanvasElement !== 'undefined') {
  const noop = () => {};
  const makeCtx = () => {
    const ctx = {
      canvas: null,
      fillStyle: '#000',
      strokeStyle: '#000',
      globalAlpha: 1,
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      font: '10px sans-serif',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      fillRect: noop,
      clearRect: noop,
      strokeRect: noop,
      fillText: noop,
      strokeText: noop,
      beginPath: noop,
      closePath: noop,
      moveTo: noop,
      lineTo: noop,
      arc: noop,
      fill: noop,
      stroke: noop,
      save: noop,
      restore: noop,
      translate: noop,
      scale: noop,
      rotate: noop,
      setTransform: noop,
      resetTransform: noop,
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      measureText: () => ({ width: 0 }),
      drawImage: noop,
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      putImageData: noop,
    };
    return ctx;
  };
  const proto = globalThis.HTMLCanvasElement.prototype;
  if (!proto._citySimContextStubbed) {
    proto.getContext = function getContext() {
      return makeCtx();
    };
    proto._citySimContextStubbed = true;
  }
}

// React 19's `act` from `react` requires `IS_REACT_ACT_ENVIRONMENT` to be
// truthy. Without this flag, calls to `act()` throw
//   "act(...) is not supported in production builds of React."
// The flag must be set on `globalThis` BEFORE the `react` module is
// required, so this file is registered via Jest's `setupFiles` (which
// runs before the test framework's transform pipeline).
// React 19's `act` export is only available in the development build
// of `react` (the production build throws "act(...) is not supported
// in production builds of React"). Force the dev build so tests can
// use `act`.
process.env.NODE_ENV = 'test';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
