/**
 * A recording fake of the `AudioContextLike` surface.
 *
 * The suite builds the *real* café audio graph through this fake: nodes are
 * created, connected, started, stopped and automated exactly as they would be in
 * a browser, but every node remembers what happened so tests can assert the graph
 * and the schedule without an audio device.
 *
 * What is recorded:
 *  - node connections (to nodes *and* to `AudioParam`s, so LFO and FM wiring is
 *    observable),
 *  - every `AudioParam` automation event (value, time, curve type),
 *  - source `start`/`stop` calls with their times,
 *  - generated buffers (so impulse responses and noise beds can be inspected),
 *  - context lifecycle calls (`resume`, `suspend`, `close`).
 */

import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioContextLikeFactory,
  AudioContextStateLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  BiquadFilterTypeLike,
  ConvolverNodeLike,
  DelayNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  OscillatorTypeLike,
  StereoPannerNodeLike,
} from '../../src/audio/types';

/* -------------------------------------------------------------------------- */
/* Parameters                                                                 */
/* -------------------------------------------------------------------------- */

export type FakeParamEventType = 'set' | 'linear' | 'exponential' | 'target' | 'cancel';

export interface FakeParamEvent {
  readonly type: FakeParamEventType;
  /** Target value of the event (`setTargetAtTime` records its target). */
  readonly value: number;
  /** Time the event is scheduled for (ramp events record their end time). */
  readonly time: number;
  readonly timeConstant?: number;
}

/** Recording parameter. Reading `value` returns the last scheduled target. */
export class FakeAudioParam implements AudioParamLike {
  value: number;
  readonly events: FakeParamEvent[] = [];

  constructor(value = 0) {
    this.value = value;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.value = value;
    this.events.push({ type: 'set', value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.value = value;
    this.events.push({ type: 'linear', value, time: endTime });
  }

  exponentialRampToValueAtTime(value: number, endTime: number): void {
    this.value = value;
    this.events.push({ type: 'exponential', value, time: endTime });
  }

  setTargetAtTime(target: number, startTime: number, timeConstant: number): void {
    this.value = target;
    this.events.push({ type: 'target', value: target, time: startTime, timeConstant });
  }

  cancelScheduledValues(startTime: number): void {
    this.events.push({ type: 'cancel', value: this.value, time: startTime });
  }

  /** Targets of every ramp scheduled on this parameter, in order. */
  get rampTargets(): readonly number[] {
    return this.events
      .filter((event) => event.type === 'linear' || event.type === 'exponential')
      .map((event) => event.value);
  }

  /** Last ramp target, or `null` when nothing was ramped. */
  get lastRampTarget(): number | null {
    const targets = this.rampTargets;
    return targets.length === 0 ? null : (targets[targets.length - 1] ?? null);
  }

  /** True when a ramp of any kind was scheduled. */
  get wasRamped(): boolean {
    return this.rampTargets.length > 0;
  }

  /** Time of the last event recorded. */
  get lastEventTime(): number {
    return this.events.length === 0 ? 0 : (this.events[this.events.length - 1]?.time ?? 0);
  }
}

/* -------------------------------------------------------------------------- */
/* Nodes                                                                      */
/* -------------------------------------------------------------------------- */

/** Base recording node. */
export class FakeAudioNode implements AudioNodeLike {
  readonly kind: string;
  readonly id: number;
  /** Nodes and 3D connections this node feeds. */
  readonly connections: (FakeAudioNode | FakeAudioParam)[] = [];
  /** Connections made into `AudioParam`s (LFO/FM modulation). */
  readonly paramConnections: FakeAudioParam[] = [];
  /** Named parameters, for automation inspection. */
  readonly params: Record<string, FakeAudioParam> = {};
  disconnectCalls = 0;

  constructor(kind: string, id: number) {
    this.kind = kind;
    this.id = id;
  }

  connect(
    destination: AudioNodeLike | AudioParamLike,
    outputIndex?: number,
    inputIndex?: number,
  ): AudioNodeLike {
    void outputIndex;
    void inputIndex;
    this.connections.push(destination as FakeAudioNode | FakeAudioParam);
    if (destination instanceof FakeAudioParam) this.paramConnections.push(destination);
    return this;
  }

  disconnect(destination?: AudioNodeLike | AudioParamLike): void {
    this.disconnectCalls += 1;
    if (destination === undefined) {
      this.connections.length = 0;
      this.paramConnections.length = 0;
      return;
    }
    const index = this.connections.indexOf(destination as FakeAudioNode | FakeAudioParam);
    if (index >= 0) this.connections.splice(index, 1);
    if (destination instanceof FakeAudioParam) {
      const paramIndex = this.paramConnections.indexOf(destination);
      if (paramIndex >= 0) this.paramConnections.splice(paramIndex, 1);
    }
  }

  /** Node destinations only. */
  get nodeTargets(): readonly FakeAudioNode[] {
    return this.connections.filter((entry): entry is FakeAudioNode => entry instanceof FakeAudioNode);
  }

  get isConnected(): boolean {
    return this.connections.length > 0;
  }

  /** True when this node feeds `target`. */
  feeds(target: FakeAudioNode | FakeAudioParam): boolean {
    return this.connections.includes(target);
  }
}

export class FakeGainNode extends FakeAudioNode implements GainNodeLike {
  readonly gain = new FakeAudioParam(1);

  constructor(id: number) {
    super('gain', id);
    this.params['gain'] = this.gain;
  }
}

export class FakeOscillatorNode extends FakeAudioNode implements OscillatorNodeLike {
  type: OscillatorTypeLike = 'sine';
  readonly frequency = new FakeAudioParam(440);
  readonly detune = new FakeAudioParam(0);
  startCalls = 0;
  stopCalls = 0;
  startTime: number | null = null;
  stopTime: number | null = null;

  constructor(id: number) {
    super('oscillator', id);
    this.params['frequency'] = this.frequency;
    this.params['detune'] = this.detune;
  }

  start(when = 0): void {
    this.startCalls += 1;
    this.startTime = when;
  }

  stop(when = 0): void {
    this.stopCalls += 1;
    this.stopTime = when;
  }

  get started(): boolean {
    return this.startCalls > 0;
  }

  get stopped(): boolean {
    return this.stopCalls > 0;
  }
}

export class FakeBufferSourceNode extends FakeAudioNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  readonly playbackRate = new FakeAudioParam(1);
  startCalls = 0;
  stopCalls = 0;
  startTime: number | null = null;
  startOffset = 0;
  stopTime: number | null = null;

  constructor(id: number) {
    super('buffer-source', id);
    this.params['playbackRate'] = this.playbackRate;
  }

  start(when = 0, offset = 0): void {
    this.startCalls += 1;
    this.startTime = when;
    this.startOffset = offset;
  }

  stop(when = 0): void {
    this.stopCalls += 1;
    this.stopTime = when;
  }

  get started(): boolean {
    return this.startCalls > 0;
  }

  get stopped(): boolean {
    return this.stopCalls > 0;
  }
}

export class FakeBiquadFilterNode extends FakeAudioNode implements BiquadFilterNodeLike {
  type: BiquadFilterTypeLike = 'lowpass';
  readonly frequency = new FakeAudioParam(1000);
  readonly Q = new FakeAudioParam(1);
  readonly gain = new FakeAudioParam(0);

  constructor(id: number) {
    super('biquad', id);
    this.params['frequency'] = this.frequency;
    this.params['Q'] = this.Q;
    this.params['gain'] = this.gain;
  }
}

export class FakeDelayNode extends FakeAudioNode implements DelayNodeLike {
  readonly delayTime = new FakeAudioParam(0);

  constructor(id: number) {
    super('delay', id);
    this.params['delayTime'] = this.delayTime;
  }
}

export class FakeConvolverNode extends FakeAudioNode implements ConvolverNodeLike {
  buffer: AudioBufferLike | null = null;
  normalize = true;

  constructor(id: number) {
    super('convolver', id);
  }
}

export class FakeCompressorNode extends FakeAudioNode implements DynamicsCompressorNodeLike {
  readonly threshold = new FakeAudioParam(-24);
  readonly knee = new FakeAudioParam(30);
  readonly ratio = new FakeAudioParam(12);
  readonly attack = new FakeAudioParam(0.003);
  readonly release = new FakeAudioParam(0.25);
  /** Stand-in for the compressor's live gain reduction read out. */
  simulatedReduction = 0;

  constructor(id: number) {
    super('compressor', id);
    this.params['threshold'] = this.threshold;
    this.params['knee'] = this.knee;
    this.params['ratio'] = this.ratio;
    this.params['attack'] = this.attack;
    this.params['release'] = this.release;
  }

  get reduction(): number {
    return this.simulatedReduction;
  }
}

export class FakeStereoPannerNode extends FakeAudioNode implements StereoPannerNodeLike {
  readonly pan = new FakeAudioParam(0);

  constructor(id: number) {
    super('panner', id);
    this.params['pan'] = this.pan;
  }
}

/* -------------------------------------------------------------------------- */
/* Buffers                                                                    */
/* -------------------------------------------------------------------------- */

export class FakeAudioBuffer implements AudioBufferLike {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  private readonly channels: Float32Array[];

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = Math.max(1, Math.trunc(numberOfChannels));
    this.length = Math.max(1, Math.trunc(length));
    this.sampleRate = sampleRate;
    this.channels = Array.from(
      { length: this.numberOfChannels },
      () => new Float32Array(this.length),
    );
  }

  get duration(): number {
    return this.length / this.sampleRate;
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (data === undefined) {
      throw new RangeError(`Channel ${channel} is out of range (0..${this.numberOfChannels - 1}).`);
    }
    return data;
  }

  /** Peak absolute sample value, for inspecting generated noise and tails. */
  peakOf(channel = 0): number {
    const data = this.getChannelData(channel);
    let peak = 0;
    for (const sample of data) peak = Math.max(peak, Math.abs(sample));
    return peak;
  }
}

/* -------------------------------------------------------------------------- */
/* Context                                                                    */
/* -------------------------------------------------------------------------- */

/** Recording audio context. */
export class FakeAudioContext implements AudioContextLike {
  readonly destination: FakeAudioNode;
  readonly sampleRate: number;
  readonly nodes: FakeAudioNode[] = [];
  readonly buffers: FakeAudioBuffer[] = [];
  currentTime = 0;
  state: AudioContextStateLike = 'suspended';
  resumeCalls = 0;
  suspendCalls = 0;
  closeCalls = 0;
  private nextId = 1;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.destination = this.register(new FakeAudioNode('destination', this.nextId));
  }

  private register<T extends FakeAudioNode>(node: T): T {
    this.nextId += 1;
    this.nodes.push(node);
    return node;
  }

  createGain(): GainNodeLike {
    return this.register(new FakeGainNode(this.nextId));
  }

  createOscillator(): OscillatorNodeLike {
    return this.register(new FakeOscillatorNode(this.nextId));
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    return this.register(new FakeBiquadFilterNode(this.nextId));
  }

  createDelay(): DelayNodeLike {
    return this.register(new FakeDelayNode(this.nextId));
  }

  createConvolver(): ConvolverNodeLike {
    return this.register(new FakeConvolverNode(this.nextId));
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    return this.register(new FakeBufferSourceNode(this.nextId));
  }

  createDynamicsCompressor(): DynamicsCompressorNodeLike {
    return this.register(new FakeCompressorNode(this.nextId));
  }

  createStereoPanner(): StereoPannerNodeLike {
    return this.register(new FakeStereoPannerNode(this.nextId));
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    const buffer = new FakeAudioBuffer(numberOfChannels, length, sampleRate);
    this.buffers.push(buffer);
    return buffer;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCalls += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    this.state = 'closed';
    return Promise.resolve();
  }

  /* -- inspection helpers -------------------------------------------------- */

  /** Every node of a given kind (`'gain'`, `'oscillator'`, `'biquad'`, ...). */
  findNodes(kind: string): readonly FakeAudioNode[] {
    return this.nodes.filter((node) => node.kind === kind);
  }

  /** Nodes of a kind, narrowed by a predicate (for example biquad filter type). */
  findNodesWhere<T extends FakeAudioNode>(
    kind: string,
    predicate: (node: T) => boolean,
  ): readonly T[] {
    const found: T[] = [];
    for (const node of this.findNodes(kind)) {
      const typed = node as unknown as T;
      if (predicate(typed)) found.push(typed);
    }
    return found;
  }

  countNodes(kind: string): number {
    return this.findNodes(kind).length;
  }

  /** Nodes that feed `target` (either a node or a parameter). */
  inputsOf(target: FakeAudioNode | FakeAudioParam): readonly FakeAudioNode[] {
    return this.nodes.filter((node) => node.feeds(target));
  }

  /** Every started source in the graph. */
  get sources(): readonly (FakeOscillatorNode | FakeBufferSourceNode)[] {
    return this.nodes.filter(
      (node): node is FakeOscillatorNode | FakeBufferSourceNode =>
        node instanceof FakeOscillatorNode || node instanceof FakeBufferSourceNode,
    );
  }

  /** Sources that were started but never stopped. */
  get runningSources(): readonly (FakeOscillatorNode | FakeBufferSourceNode)[] {
    return this.sources.filter((source) => source.started && !source.stopped);
  }

  /** Nodes that still hold at least one connection. */
  get connectedNodes(): readonly FakeAudioNode[] {
    return this.nodes.filter((node) => node.isConnected);
  }

  /** Automation across the whole graph, in node creation order. */
  get automationLog(): readonly {
    readonly node: FakeAudioNode;
    readonly param: string;
    readonly event: FakeParamEvent;
  }[] {
    const log: { node: FakeAudioNode; param: string; event: FakeParamEvent }[] = [];
    for (const node of this.nodes) {
      for (const [name, param] of Object.entries(node.params)) {
        for (const event of param.events) log.push({ node, param: name, event });
      }
    }
    return log;
  }

  /** Every ramp target recorded for `param`. */
  rampTargetsOf(param: FakeAudioParam): readonly number[] {
    return param.rampTargets;
  }

  /** Parameters whose recorded ramp targets include `value` (within `epsilon`). */
  paramsRampedTo(value: number, epsilon = 1e-6): readonly FakeAudioParam[] {
    const found: FakeAudioParam[] = [];
    for (const node of this.nodes) {
      for (const param of Object.values(node.params)) {
        if (param.rampTargets.some((target) => Math.abs(target - value) <= epsilon)) {
          found.push(param);
        }
      }
    }
    return found;
  }
}

export interface FakeContextFactory {
  /** Contexts created so far, in creation order. */
  readonly contexts: FakeAudioContext[];
  readonly factory: AudioContextLikeFactory;
}

/**
 * Factory that records every context it hands to the engine. The engine must only
 * call it from its gesture gate, which the suite uses to prove nothing is
 * created before `unlock()`.
 */
export function createFakeAudioContextFactory(sampleRate = 48000): FakeContextFactory {
  const contexts: FakeAudioContext[] = [];
  return {
    contexts,
    factory: () => {
      const context = new FakeAudioContext(sampleRate);
      contexts.push(context);
      return context;
    },
  };
}

/** The first created context, or a descriptive failure. */
export function requireContext(factory: FakeContextFactory): FakeAudioContext {
  const context = factory.contexts[0];
  if (context === undefined) {
    throw new Error('No audio context has been created yet.');
  }
  return context;
}
