/**
 * Machine-SFX suite: how the era *character* changes what the machine sounds
 * like, and how each one-shot behaves.
 *
 * The characters here are fixtures — the 1945 percolator, 1965 lever, 1985
 * semi-automatic, 2005 super-automatic and 2025 multi-group values belong to
 * `domain-music-sources`. What this suite proves is that the engine's synthesis
 * genuinely follows whatever character is injected.
 */

import { describe, expect, it } from 'vitest';
import {
  AudioDescriptorError,
  MACHINE_SFX_KINDS,
  createMachineSfx,
  type ClatterProfileInput,
  type ExtractionProfileInput,
  type GrinderProfileInput,
  type MachineArchetype,
  type MachineCharacterInput,
  type MachineSfx,
  type MilkProfileInput,
  type SteamProfileInput,
  type TillProfileInput,
} from '../../src/audio';
import {
  FakeAudioContext,
  FakeAudioNode,
  FakeAudioParam,
  FakeBufferSourceNode,
  FakeOscillatorNode,
} from './fakeAudioContext';
import type { AudioNodeLike, AudioParamLike } from '../../src/audio/types';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

interface CharacterOverrides {
  readonly extraction?: Partial<ExtractionProfileInput>;
  readonly steam?: SteamProfileInput;
  readonly grinder?: GrinderProfileInput;
  readonly clatter?: ClatterProfileInput;
  readonly milk?: MilkProfileInput;
  readonly till?: TillProfileInput;
}

/** Test-only character for one archetype, with per-test overrides. */
function fixtureCharacter(
  archetype: MachineArchetype,
  overrides: CharacterOverrides = {},
): MachineCharacterInput {
  return {
    id: `fixture-${archetype}`,
    year: '1985',
    extraction: {
      archetype,
      noiseHz: 2800,
      noiseQ: 0.9,
      durationSeconds: 1.6,
      level: 0.5,
      clickLevel: 0.3,
      toneHz: 900,
      ...overrides.extraction,
    },
    steam: { burstSeconds: 1.1, hissHz: 5200, level: 0.5, pressureRise: 0.3, ...overrides.steam },
    grinder: { burrHz: 320, durationSeconds: 1.2, level: 0.5, ...overrides.grinder },
    clatter: {
      material: 'china',
      pieces: 3,
      decaySeconds: 0.45,
      ringHz: 2200,
      ringDecaySeconds: 0.2,
      ...overrides.clatter,
    },
    milk: { knockHz: 220, decaySeconds: 0.3, level: 0.45, steamTail: 0.3, ...overrides.milk },
    till: { drawer: false, beep: false, ...overrides.till },
  };
}

interface Unit {
  readonly unit: MachineSfx;
  readonly context: FakeAudioContext;
  readonly destination: FakeAudioNode;
}

function createUnit(character: MachineCharacterInput, seed = 4711): Unit {
  const context = new FakeAudioContext();
  const destination = asNode(context.createGain());
  const unit = createMachineSfx({ context, destination, character, seed });
  return { unit, context, destination };
}

const asNode = (node: AudioNodeLike): FakeAudioNode => node as unknown as FakeAudioNode;
const asParam = (param: AudioParamLike): FakeAudioParam => param as unknown as FakeAudioParam;

const oscillatorsOfType = (context: FakeAudioContext, type: string): readonly FakeOscillatorNode[] =>
  context.findNodesWhere<FakeOscillatorNode>('oscillator', (node) => node.type === type);

/* -------------------------------------------------------------------------- */
/* Era characters                                                             */
/* -------------------------------------------------------------------------- */

describe('era machine characters', () => {
  it('bubbles through a percolator and hums under a super-automatic', () => {
    const percolator = createUnit(
      fixtureCharacter('percolator', { extraction: { bubbleRate: 8, durationSeconds: 1.5 } }),
    );
    const percolatorShot = percolator.unit.trigger('extraction');
    expect(percolatorShot.archetype).toBe('percolator');
    expect(percolatorShot.emitted).toBe(true);
    // Percolation: a stream of short rising blips.
    expect(oscillatorsOfType(percolator.context, 'sine').length).toBeGreaterThan(4);
    expect(oscillatorsOfType(percolator.context, 'sawtooth')).toHaveLength(0);
    const bubbleFrequencies = oscillatorsOfType(percolator.context, 'sine').map(
      (node) => node.frequency.value,
    );
    expect(Math.max(...bubbleFrequencies)).toBeGreaterThan(Math.min(...bubbleFrequencies));

    const automatic = createUnit(fixtureCharacter('super-automatic'));
    const automaticShot = automatic.unit.trigger('extraction');
    expect(automaticShot.archetype).toBe('super-automatic');
    // No bubbles, but a motor tone plus a solenoid click (triangle thud).
    expect(oscillatorsOfType(automatic.context, 'sine')).toHaveLength(0);
    expect(oscillatorsOfType(automatic.context, 'sawtooth').length).toBe(1);
    expect(oscillatorsOfType(automatic.context, 'triangle').length).toBe(1);
    expect(automaticShot.nodes).toBeLessThan(percolatorShot.nodes);
  });

  it('gives a lever machine a fast, heavy hiss and a semi-automatic a pump pulse', () => {
    const lever = createUnit(fixtureCharacter('lever'));
    const leverShot = lever.unit.trigger('extraction');
    const leverEnvelopes = lever.context.findNodes('gain').flatMap((node) => {
      const events = asParam((node as unknown as { gain: AudioParamLike }).gain).events;
      return events.filter((event) => event.type === 'linear').length > 0 ? [events] : [];
    });
    expect(leverEnvelopes.length).toBeGreaterThan(0);
    const leverFirstRamp = leverEnvelopes[0]?.find((event) => event.type === 'linear');
    expect(leverFirstRamp?.time).toBeLessThan(0.01);
    // No modulation of a parameter anywhere: no LFOs, no pump.
    expect(lever.context.nodes.some((node) => node.paramConnections.length > 0)).toBe(false);

    const semi = createUnit(fixtureCharacter('semi-automatic'));
    const semiShot = semi.unit.trigger('extraction');
    expect(semiShot.archetype).toBe('semi-automatic');
    // The pump is an LFO wired straight into the extraction envelope.
    expect(semi.context.nodes.some((node) => node.paramConnections.length > 0)).toBe(true);
    expect(semiShot.nodes).toBeGreaterThan(leverShot.nodes);
  });

  it('pulls two groups on a 2025-style machine', () => {
    const single = createUnit(fixtureCharacter('semi-automatic'));
    single.unit.trigger('extraction');
    const group = createUnit(fixtureCharacter('multi-group'));
    const shot = group.unit.trigger('extraction');
    expect(shot.archetype).toBe('multi-group');

    const singleNoise = single.context.findNodesWhere<FakeBufferSourceNode>(
      'buffer-source',
      () => true,
    );
    const groupedNoise = group.context.findNodesWhere<FakeBufferSourceNode>('buffer-source', () => true);
    // Both hiss through their extraction bed and add a portafilter click; the
    // multi-group machine pulls a second, later shot on top.
    expect(singleNoise).toHaveLength(2);
    expect(groupedNoise).toHaveLength(singleNoise.length + 1);
    // The second group starts later, which is what makes it read as "two shots".
    const starts = groupedNoise.map((node) => node.startTime ?? 0).sort((a, b) => a - b);
    expect((starts[starts.length - 1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThan(0.1);
  });

  it('shapes cup clatter from the saucer material and the piece count', () => {
    const paper = createUnit(fixtureCharacter('manual', { clatter: { material: 'paper', pieces: 2 } }));
    const porcelain = createUnit(
      fixtureCharacter('manual', { clatter: { material: 'porcelain', pieces: 5, saucer: false } }),
    );
    const paperShot = paper.unit.trigger('cupClatter');
    const porcelainShot = porcelain.unit.trigger('cupClatter');

    expect(paperShot.material).toBe('paper');
    expect(porcelainShot.material).toBe('porcelain');
    expect(
      paper.context.findNodesWhere<FakeBufferSourceNode>('buffer-source', () => true),
    ).toHaveLength(2);
    expect(
      porcelain.context.findNodesWhere<FakeBufferSourceNode>('buffer-source', () => true),
    ).toHaveLength(5);

    const paperRing = Math.max(...oscillatorsOfType(paper.context, 'triangle').map((n) => n.frequency.value));
    const porcelainRing = Math.max(
      ...oscillatorsOfType(porcelain.context, 'triangle').map((n) => n.frequency.value),
    );
    expect(porcelainRing).toBeGreaterThan(paperRing);

    // Porcelain rings on longer than paper; the saucer adds its own low ring.
    expect(porcelainShot.durationSeconds).toBeGreaterThan(paperShot.durationSeconds);
    const paperRamps = paper.context.nodes.filter((node) => node.kind === 'gain');
    expect(paperRamps.length).toBeGreaterThan(0);
  });

  it('rises in pressure on a steam purge and can sputter', () => {
    const steady = createUnit(fixtureCharacter('semi-automatic', { steam: { pressureRise: 0.6 } }));
    const sputtering = createUnit(
      fixtureCharacter('semi-automatic', { steam: { pressureRise: 0.6, chatterHz: 12 } }),
    );
    steady.unit.trigger('steamPurge');
    sputtering.unit.trigger('steamPurge');

    // Chatter is a 12 Hz square LFO modulating the purge level.
    const chatter = oscillatorsOfType(sputtering.context, 'square').filter(
      (node) => Math.abs(node.frequency.value - 12) < 0.5,
    );
    expect(chatter).toHaveLength(1);
    expect(oscillatorsOfType(steady.context, 'square')).toHaveLength(0);
    expect(sputtering.context.nodes.some((node) => node.paramConnections.length > 0)).toBe(true);
    expect(steady.context.nodes.some((node) => node.paramConnections.length > 0)).toBe(false);

    // Both are broadband hiss through a highpass at the character's hiss band.
    const highpass = sputtering.context.findNodesWhere<FakeAudioNode & { frequency: AudioParamLike }>(
      'biquad',
      (node) => (node as unknown as { type: string }).type === 'highpass',
    );
    expect(highpass.length).toBeGreaterThan(0);
    const hissHz = highpass[0]?.frequency.value ?? 0;
    // The hiss band follows the character's 5200 Hz, shifted by this trigger's
    // pitch randomisation (0.94..1.06).
    expect(hissHz).toBeGreaterThan(5200 * 0.93);
    expect(hissHz).toBeLessThan(5200 * 1.07);
  });

  it('drops the milk knock in pitch and leaves a steam tail', () => {
    const milk = createUnit(fixtureCharacter('manual', { milk: { knockHz: 240, steamTail: 0.5 } }));
    const shot = milk.unit.trigger('milkKnock');
    expect(shot.emitted).toBe(true);

    const knock = oscillatorsOfType(milk.context, 'triangle')[0];
    expect(knock).toBeDefined();
    const knockPitch = 240 * shot.pitchFactor;
    const drop = knock?.frequency.events.find((event) => event.type === 'exponential');
    expect(drop).toBeDefined();
    // The pitcher knock falls in pitch as it decays.
    expect(drop?.value ?? 0).toBeLessThan(knockPitch);
    expect(drop?.value ?? 0).toBeCloseTo(knockPitch * 0.72, 3);
    // Knock body plus the steam tail that follows it.
    expect(
      milk.context.findNodesWhere<FakeBufferSourceNode>('buffer-source', () => true),
    ).toHaveLength(2);
  });

  it('beeps only where the era provides a till, twice when it is contactless', () => {
    const noTill = createUnit(fixtureCharacter('percolator'));
    const nodesBefore = noTill.context.nodes.length;
    const noTillShot = noTill.unit.trigger('till');
    expect(noTillShot.emitted).toBe(false);
    expect(noTillShot.nodes).toBe(0);
    expect(noTill.context.nodes.length).toBe(nodesBefore);

    const till = createUnit(
      fixtureCharacter('manual', { till: { drawer: true, beep: true, beepHz: 1180 } }),
    );
    const tillShot = till.unit.trigger('till');
    expect(tillShot.emitted).toBe(true);
    expect(oscillatorsOfType(till.context, 'square').length).toBe(2); // drawer + one beep

    const contactless = createUnit(
      fixtureCharacter('multi-group', {
        till: { beep: true, contactless: true, beepHz: 1180 },
      }),
    );
    const contactlessShot = contactless.unit.trigger('till');
    expect(contactlessShot.emitted).toBe(true);
    const beeps = oscillatorsOfType(contactless.context, 'sine').map((node) => node.frequency.value);
    expect(beeps).toHaveLength(2);
    expect((beeps[1] ?? 0)).toBeGreaterThan(beeps[0] ?? 0);
  });
});

/* -------------------------------------------------------------------------- */
/* Trigger parameters                                                         */
/* -------------------------------------------------------------------------- */

describe('trigger parameters and randomisation', () => {
  it('emits every one-shot kind and reports what it emitted', () => {
    const { unit } = createUnit(
      fixtureCharacter('multi-group', { till: { drawer: true, beep: true } }),
    );
    for (const kind of MACHINE_SFX_KINDS) {
      const record = unit.trigger(kind, undefined, 3);
      expect(record.kind).toBe(kind);
      expect(record.time).toBe(3);
      expect(record.emitted).toBe(true);
      expect(record.nodes).toBeGreaterThanOrEqual(3);
      expect(record.durationSeconds).toBeGreaterThan(0);
      expect(record.pitchFactor).toBeGreaterThan(0.5);
      expect(record.pitchFactor).toBeLessThan(1.2);
    }
    expect(unit.triggerCount).toBe(MACHINE_SFX_KINDS.length);
  });

  it('applies explicit pitch, duration, level and velocity overrides', () => {
    const { unit } = createUnit(fixtureCharacter('manual'));
    const record = unit.trigger('grinder', { pitch: 1.5, duration: 0.5, level: 1.75, velocity: 0.4 });
    expect(record.pitchFactor).toBe(1.5);
    expect(record.durationFactor).toBe(0.5);
    expect(record.levelFactor).toBe(1.75);
    expect(record.velocity).toBe(0.4);
    expect(record.durationSeconds).toBeLessThan(1.2);
    expect(record.seed).toBeGreaterThan(0);
    const explicit = unit.trigger('grinder', { seed: 99 });
    expect(explicit.seed).toBe(99);
  });

  it('randomises every trigger, deterministically per seed', () => {
    const sequence = (seed: number): string => {
      const { unit } = createUnit(fixtureCharacter('multi-group', { clatter: { pieces: 4 } }), seed);
      const records = [
        unit.trigger('cupClatter'),
        unit.trigger('grinder'),
        unit.trigger('cupClatter'),
        unit.trigger('steamPurge'),
      ];
      return JSON.stringify(records);
    };

    expect(sequence(1234)).toBe(sequence(1234));
    expect(sequence(1234)).not.toBe(sequence(5678));

    const { unit } = createUnit(fixtureCharacter('manual'));
    const first = unit.trigger('grinder');
    const second = unit.trigger('grinder');
    expect(second.seed).not.toBe(first.seed);
    expect(second.pitchFactor).not.toBe(first.pitchFactor);
  });

  it('scales with the unit level and follows character swaps', () => {
    const { unit } = createUnit(fixtureCharacter('manual'));
    const loud = unit.trigger('steamPurge');
    unit.setLevel(0.25, 0.2, 10);
    expect(asParam(unit.output.gain).lastRampTarget).toBeCloseTo(0.25, 6);
    const quiet = unit.trigger('steamPurge');
    expect(quiet.level).toBeLessThan(loud.level);

    unit.setCharacter(fixtureCharacter('percolator', { extraction: { bubbleRate: 9 } }));
    expect(unit.character.extraction.archetype).toBe('percolator');
    expect(unit.trigger('extraction').archetype).toBe('percolator');
    expect(unit.trigger('cupClatter').material).toBe('china');
  });

  it('sums concurrent one-shots for the limiter estimate', () => {
    const { unit } = createUnit(fixtureCharacter('multi-group'));
    const at = 5;
    expect(unit.pendingLevel(at)).toBe(0);
    const first = unit.trigger('grinder', undefined, at);
    const single = unit.pendingLevel(at);
    expect(single).toBeGreaterThan(0);
    unit.trigger('grinder', undefined, at);
    unit.trigger('steamPurge', undefined, at);
    expect(unit.pendingLevel(at)).toBeGreaterThan(single * 2);
    expect(unit.activeOneShotCount).toBe(3);
    expect(first.level).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

describe('machine SFX lifecycle', () => {
  it('reaps finished one-shots and disconnects their nodes', () => {
    const { unit, context } = createUnit(fixtureCharacter('multi-group'));
    unit.trigger('cupClatter', undefined, 0);
    unit.trigger('steamPurge', undefined, 0);
    expect(context.connectedNodes.length).toBeGreaterThan(0);

    expect(unit.reap(100)).toBe(2);
    expect(unit.activeOneShotCount).toBe(0);
    // Only the unit's own level stage stays connected to its destination.
    expect(context.connectedNodes.every((node) => node === asNode(unit.output))).toBe(true);
    expect(context.runningSources).toHaveLength(0);
  });

  it('reports the destination it was handed and releases it on dispose', () => {
    const { unit, context, destination } = createUnit(fixtureCharacter('manual'));
    unit.trigger('grinder', undefined, 0);
    expect(asNode(unit.output).feeds(destination)).toBe(true);

    unit.dispose();
    expect(unit.disposed).toBe(true);
    expect(destination.isConnected).toBe(false);
    expect(context.connectedNodes).toHaveLength(0);
    expect(context.runningSources).toHaveLength(0);
    // Disposing twice is safe, and nothing can be triggered afterwards.
    unit.dispose();
    const afterDispose = unit.trigger('grinder');
    expect(afterDispose.emitted).toBe(false);
    expect(afterDispose.nodes).toBe(0);
  });

  it('rejects a character without an extraction archetype', () => {
    const context = new FakeAudioContext();
    const destination = context.createGain();
    expect(() =>
      createMachineSfx({
        context,
        destination,
        character: { year: '1945' } as unknown as MachineCharacterInput,
      }),
    ).toThrowError(AudioDescriptorError);
    expect(() =>
      createMachineSfx({
        context,
        destination,
        character: fixtureCharacter('manual', { clatter: { material: 'wood' as never } }),
      }),
    ).toThrowError(AudioDescriptorError);
  });
});
