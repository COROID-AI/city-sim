/**
 * Jest test setup.
 *
 * Imported once per test suite via `setupFilesAfterEach` in jest.config.mjs.
 * Adds the @testing-library/jest-dom matchers (toBeInTheDocument, etc.) to the
 * global `expect` so component tests can use them without per-file imports.
 *
 * Also installs a minimal Web Audio API mock so audio modules can be imported
 * and exercised under jsdom (which ships no AudioContext implementation).
 */
import '@testing-library/jest-dom';

/**
 * Minimal AudioContext mock. Implements just enough of the surface area used
 * by the AudioEngine (createGain/createOscillator/createBufferSource/
 * createBiquadFilter, param ramps, start/stop, resume/close) for unit tests.
 */
class MockAudioParam {
  value = 0;
  setValueAtTime(_v: number, _t: number) {}
  linearRampToValueAtTime(_v: number, _t: number) {}
  exponentialRampToValueAtTime(_v: number, _t: number) {}
  cancelScheduledValues(_t: number) {}
}

class MockAudioNode {
  connect(_dest: unknown) {
    return _dest;
  }
  disconnect() {}
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockOscillatorNode extends MockAudioNode {
  frequency = new MockAudioParam();
  detune = new MockAudioParam();
  type = 'sine';
  start() {}
  stop() {}
}

class MockBiquadFilterNode extends MockAudioNode {
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
  type = 'lowpass';
}

class MockAudioBufferSourceNode extends MockAudioNode {
  buffer: unknown = null;
  loop = false;
  start() {}
  stop() {}
}

class MockAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  sampleRate = 44100;
  destination = new MockGainNode();

  createGain() {
    return new MockGainNode();
  }
  createOscillator() {
    return new MockOscillatorNode();
  }
  createBiquadFilter() {
    return new MockBiquadFilterNode();
  }
  createBufferSource() {
    return new MockAudioBufferSourceNode();
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
}

// Install the mock onto the global/window object so `new AudioContext()` works.
if (typeof globalThis !== 'undefined') {
  const g = globalThis as unknown as Record<string, unknown>;
  g.AudioContext = MockAudioContext;
  g.webkitAudioContext = MockAudioContext;
}
if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.AudioContext = MockAudioContext;
  w.webkitAudioContext = MockAudioContext;
}
