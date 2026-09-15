/**
 * Music domain suite (headless, node).
 *
 * Covers the whole contract of the era music sources:
 *
 *  - the five era tables exist for exactly 1945, 1965, 1985, 2005 and 2025, and
 *    each era's programme validates against the frozen audio descriptor types,
 *  - building and moving through the timeline presents exactly one correct
 *    device, with no other era's variant anywhere in the scene graph,
 *  - every device carries the detail families the close-up inspector needs
 *    (cabinet joinery, dial or display, grille and cloth, controls, badge, cable
 *    routing, glow, wear) inside the room,
 *  - `update` animates needles, reels and glow with delta time and freezes them
 *    under `prefers-reduced-motion`,
 *  - programme and mix are routed into the audio target even while it is locked,
 *  - textures are painted in code, deterministically, on both backends.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  YEAR_IDS,
  isSceneModule,
  type PeriodDefinition,
  type YearId,
} from '../../contracts/period';
import { createKernel, type Kernel } from '../../core/kernel';
import {
  normalizeEraMix,
  normalizeMusicProgram,
  type AudioEngineState,
  type AudioMixState,
  type DeviceKind,
  type EraMixDescriptor,
  type EraMixInput,
  type MusicProgramInput,
} from '../../audio';
import {
  ERA_MUSIC_MIXES,
  MUSIC_DEVICE_KINDS,
  MUSIC_MODULE_ID,
  MUSIC_PROGRAMS,
  MUSIC_SOURCE_SPECS,
  createMusicSourceModule,
  describeMusicProgram,
  isMusicAudioTarget,
  musicDeviceKind,
  musicProgramSignature,
  musicSpec,
  presentPartFamilies,
  type MusicAudioTarget,
  type MusicControlKind,
  type MusicDeviceKind,
  type MusicPlacementKind,
  type MusicSourceModule,
} from './MusicSourceModule';
import {
  MUSIC_GLYPH_SPACING,
  Raster,
  createMusicTexture,
  distinctPixelColors,
  drawMusicText,
  isMusicTexture,
  measureMusicText,
  paintMusicSurface,
  parseColor,
  type CanvasFactory,
} from './textures';
import { advanceMusicAnimations, type MusicAnimation } from './devices';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
  vi.restoreAllMocks();
});

function headlessKernel(): Kernel {
  const kernel = createKernel(null, { forceHeadless: true, autoResize: false, resizeTarget: null });
  openKernels.push(kernel);
  return kernel;
}

function periodFor(year: YearId): PeriodDefinition {
  const index = YEAR_IDS.indexOf(year);
  return {
    year,
    label: year,
    name: `Fixture era ${year}`,
    summary: `Fixture era ${year} used by the music suite.`,
    palette: {
      background: '#101010',
      floor: '#332211',
      wall: '#221a12',
      ceiling: '#dddddd',
      accent: '#cc8844',
      lamp: '#ffddaa',
    },
    lighting: {
      ambientColor: '#ffffff',
      ambientIntensity: 0.4,
      keyColor: '#fff4e0',
      keyIntensity: 1.1,
      fillColor: '#a8c4ff',
      fillIntensity: 0.3,
      lampColor: '#ffcc88',
      lampIntensity: 0.9,
      fogDensity: 0.01 + index * 0.002,
    },
    details: [`era-${year}`],
  };
}

/**
 * Recording stand-in for the audio engine's music bus.
 *
 * It runs the era data through the *real* descriptor normalisers, so a malformed
 * programme or mix fails this suite exactly as it would fail the engine.
 */
class RecordingAudioTarget implements MusicAudioTarget {
  state: AudioEngineState = 'locked';
  readonly programIds: (string | null)[] = [];
  readonly mixIds: string[] = [];
  readonly crossfades: number[] = [];
  scheduledNotes = 0;

  private current: EraMixDescriptor | null = null;
  private currentProgram: string | null = null;

  setMusicProgram(
    program: MusicProgramInput | null,
    options: { crossfadeSeconds?: number } = {},
  ): void {
    const descriptor = program === null ? null : normalizeMusicProgram(program, 'music program');
    this.currentProgram = descriptor?.id ?? null;
    this.programIds.push(this.currentProgram);
    this.crossfades.push(options.crossfadeSeconds ?? 0);
  }

  applyMix(mix: EraMixInput, options: { seconds?: number } = {}): EraMixDescriptor {
    const descriptor = normalizeEraMix(mix, 'era mix');
    this.current = descriptor;
    this.mixIds.push(descriptor.id);
    void options;
    return descriptor;
  }

  getMixState(): AudioMixState {
    const mix = this.current;
    // Mirrors the engine's bus-tone formula so the module reads back the same
    // era volume and tone the browser build reports.
    const musicToneHz = mix
      ? mix.music.toneHz * (0.65 + 0.5 * mix.brightness) * mix.music.brightness
      : 0;
    return {
      state: this.state,
      year: mix?.year ?? null,
      mixId: mix?.id ?? null,
      programId: this.currentProgram,
      ambienceId: null,
      machineCharacterId: mix?.machine.character.id ?? null,
      machineArchetype: mix?.machine.character.extraction.archetype ?? null,
      musicLevel: mix?.music.level ?? 0,
      musicToneHz,
      ambienceLevel: mix?.ambience.level ?? 0,
      ambienceDensity: mix?.ambience.density ?? 0,
      machineLevel: mix?.machine.level ?? 0,
      masterLevel: mix?.master ?? 1,
      reverbDryWet: mix?.reverb.dryWet ?? 0,
      reverbSeconds: mix?.reverb.sizeSeconds ?? 0,
      limiterReduction: 1,
      mutes: { music: false, ambience: false, machine: false },
      sends: {
        music: mix?.music.send ?? 0,
        ambience: mix?.ambience.send ?? 0,
        machine: mix?.machine.send ?? 0,
      },
      activeMusicVoices: 0,
      scheduledNotes: this.scheduledNotes,
      murmurBlips: 0,
      machineTriggers: 0,
    };
  }
}

/** Expected era mapping: visible device kind, tone profile and placement. */
const ERA_DEVICES: Readonly<
  Record<YearId, { kind: MusicDeviceKind; engine: DeviceKind; placement: MusicPlacementKind }>
> = Object.freeze({
  '1945': { kind: 'wireless-set', engine: 'wireless', placement: 'wall-shelf' },
  '1965': { kind: 'jukebox', engine: 'jukebox', placement: 'wall-floor' },
  '1985': { kind: 'boombox', engine: 'boombox', placement: 'counter-top' },
  '2005': { kind: 'ipod-dock', engine: 'ipod', placement: 'counter-top' },
  '2025': { kind: 'smart-speaker', engine: 'phone', placement: 'storefront-ledge' },
});

/** Part-name fragment that proves the era's primary control family exists. */
const CONTROL_PART: Readonly<Record<MusicControlKind, string>> = Object.freeze({
  knob: 'knob',
  rocker: 'rocker',
  slider: 'slider',
  keypad: 'keypad',
  touch: 'touch',
  'click-wheel': 'click-wheel',
});

function deviceGroupsUnder(root: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name.startsWith('music:') && object.userData['music'] !== undefined) {
      found.push(object);
    }
  });
  return found;
}

function worldBox(node: THREE.Object3D): THREE.Box3 {
  node.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(node);
}

function countNodes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse(() => {
    count += 1;
  });
  return count;
}

function buildAt(
  module: MusicSourceModule,
  kernel: Kernel,
  year: YearId,
  engine?: MusicAudioTarget,
): void {
  const period = periodFor(year);
  kernel.setYear(year);
  const context = kernel.createBuildContext(period, engine ? { services: { audio: engine } } : {});
  if (module.spec === undefined) module.build(context);
  else module.applyPeriod(period, context);
}

/* -------------------------------------------------------------------------- */
/* Era tables                                                                 */
/* -------------------------------------------------------------------------- */

describe('era music tables', () => {
  it('supplies exactly the five café eras, and nothing else', () => {
    expect(Object.keys(MUSIC_SOURCE_SPECS).sort()).toEqual([...YEAR_IDS].sort());
    expect(Object.keys(MUSIC_PROGRAMS).sort()).toEqual([...YEAR_IDS].sort());
    expect(Object.keys(ERA_MUSIC_MIXES).sort()).toEqual([...YEAR_IDS].sort());
    expect(MUSIC_DEVICE_KINDS).toHaveLength(YEAR_IDS.length);
    for (const year of YEAR_IDS) {
      expect(musicSpec(year).year).toBe(year);
      expect(musicSpec(year).deviceId).toContain(year);
      expect(musicSpec(year).programId).toBe(MUSIC_PROGRAMS[year].id);
    }
  });

  it('presents the era-correct device with its own placement', () => {
    for (const year of YEAR_IDS) {
      const spec = musicSpec(year);
      const expected = ERA_DEVICES[year];
      expect(spec.kind).toBe(expected.kind);
      expect(spec.placement.kind).toBe(expected.placement);
      expect(musicDeviceKind(year)).toBe(expected.engine);
      expect(spec.cabinet.width).toBeGreaterThan(0);
      expect(spec.cabinet.height).toBeGreaterThan(0);
      expect(spec.cabinet.depth).toBeGreaterThan(0);
      expect(spec.cabinet.joinery.length).toBeGreaterThan(20);
      expect(spec.controls.count).toBeGreaterThan(0);
      expect(spec.controls.labels.length).toBeGreaterThan(0);
      expect(spec.grille.coneCount).toBeGreaterThan(0);
      expect(spec.speaker.coneDiameter).toBeGreaterThan(0);
      expect(spec.wear.length).toBeGreaterThanOrEqual(3);
    }
    // Device kinds are all different: one device per era, five distinct objects.
    expect(new Set(YEAR_IDS.map((year) => musicSpec(year).kind)).size).toBe(YEAR_IDS.length);
  });

  it('keeps every era audibly distinct from its neighbours', () => {
    const signatures = YEAR_IDS.map((year) => musicProgramSignature(MUSIC_PROGRAMS[year]));
    expect(new Set(signatures).size).toBe(YEAR_IDS.length);
    expect(new Set(YEAR_IDS.map((year) => describeMusicProgram(year).musicLevel)).size).toBe(
      YEAR_IDS.length,
    );
    expect(new Set(YEAR_IDS.map((year) => describeMusicProgram(year).musicToneHz)).size).toBe(
      YEAR_IDS.length,
    );
    expect(new Set(YEAR_IDS.map((year) => MUSIC_PROGRAMS[year].tempo)).size).toBe(YEAR_IDS.length);
    expect(new Set(YEAR_IDS.map((year) => describeMusicProgram(year).deviceKind)).size).toBe(
      YEAR_IDS.length,
    );
    for (let index = 1; index < YEAR_IDS.length; index += 1) {
      const previous = YEAR_IDS[index - 1];
      const current = YEAR_IDS[index];
      if (previous === undefined || current === undefined) continue;
      const a = describeMusicProgram(previous);
      const b = describeMusicProgram(current);
      let differences = 0;
      for (const field of ['programId', 'tempo', 'keyRoot', 'deviceKind', 'musicLevel'] as const) {
        if (a[field] !== b[field]) differences += 1;
      }
      expect(differences).toBeGreaterThanOrEqual(4);
    }
  });

  it('validates every era programme and mix against the frozen audio descriptors', () => {
    for (const year of YEAR_IDS) {
      const program = normalizeMusicProgram(MUSIC_PROGRAMS[year], `program ${year}`);
      const mix = normalizeEraMix(ERA_MUSIC_MIXES[year], `mix ${year}`);
      expect(program.year).toBe(year);
      expect(program.id).toBe(musicSpec(year).programId);
      expect(program.device.kind).toBe(ERA_DEVICES[year].engine);
      expect(program.voices.length).toBeGreaterThanOrEqual(4);
      expect(program.stepsPerLoop).toBeGreaterThan(0);
      expect(program.loopDurationSeconds).toBeGreaterThan(1);
      expect(mix.year).toBe(year);
      expect(mix.music.level).toBeGreaterThan(0);
      expect(mix.music.toneHz).toBeGreaterThanOrEqual(200);
      expect(mix.reverb.dryWet).toBeGreaterThan(0);
      // The era programme must actually make sound: at least one audible voice.
      expect(program.voices.some((voice) => !voice.mute && voice.pattern.length > 0)).toBe(true);
      // And it plays from the device the era shows.
      expect(musicSpec(year).kind).toBe(ERA_DEVICES[year].kind);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

describe('device lifecycle across the timeline', () => {
  it('is a SceneModule, builds one group and reports one active device', () => {
    const kernel = headlessKernel();
    const engine = new RecordingAudioTarget();
    const module = createMusicSourceModule({ engine });

    expect(isSceneModule(module)).toBe(true);
    expect(module.id).toBe(MUSIC_MODULE_ID);
    expect(module.activeDevice()).toBeNull();

    const baseline = kernel.world.children.length;
    buildAt(module, kernel, '1945', engine);

    expect(module.root?.name).toBe('music');
    expect(kernel.world.children.length).toBe(baseline + 1);
    expect(module.activeDeviceNodeName()).toBe('music:1945:wireless-1945');
    expect(deviceGroupsUnder(kernel.world)).toHaveLength(1);

    const device = module.activeDevice();
    expect(device).not.toBeNull();
    expect(device?.kind).toBe('wireless-set');
    expect(device?.year).toBe('1945');
    expect(device?.placement).toBe('wall-shelf');
    expect(device?.partCount).toBeGreaterThan(40);
    expect(device?.meshCount).toBeGreaterThan(30);
    expect(device?.accessoryLabels).toHaveLength(2);

    const hotspots = module.getHotspots();
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0]?.id).toBe('music-source-1945');
    expect(hotspots[0]?.year).toBe('1945');
    expect(hotspots[0]?.kind).toBe('interactive');
    expect(hotspots[0]?.moduleId).toBe(MUSIC_MODULE_ID);
    expect(hotspots[0]?.anchor?.name).toBe('music:1945:wireless-1945');
    expect(hotspots[0]?.label).toContain('1945');
    expect(hotspots[0]?.description).toContain('Valve ensemble');
    expect(hotspots[0]?.radius).toBeGreaterThan(0.3);
  });

  it('moves through all five years with exactly one device in the scene graph', () => {
    const kernel = headlessKernel();
    const engine = new RecordingAudioTarget();
    const module = createMusicSourceModule({ engine });
    const baseline = kernel.world.children.length;

    for (const year of YEAR_IDS) {
      buildAt(module, kernel, year, engine);
      const groups = deviceGroupsUnder(kernel.world);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.name).toBe(`music:${year}:${musicSpec(year).deviceId}`);
      expect(module.spec?.year).toBe(year);
      expect(module.activeDevice()?.kind).toBe(ERA_DEVICES[year].kind);
      expect(module.activeDevice()?.placement).toBe(ERA_DEVICES[year].placement);
      // No other era's variant survives in the graph.
      for (const other of YEAR_IDS) {
        if (other === year) continue;
        expect(groups.some((group) => group.name.startsWith(`music:${other}:`))).toBe(false);
      }
      expect(module.getHotspots()[0]?.year).toBe(year);
    }

    const described = module.describe();
    expect(described.built).toBe(true);
    expect(described.program.year).toBe('2025');
    expect(described.program.deviceKind).toBe('phone');

    module.dispose();
    expect(kernel.world.children.length).toBe(baseline);
    expect(module.activeDevice()).toBeNull();
    // Hotspots fall back to the last configured era for the overlay.
    expect(module.getHotspots()[0]?.year).toBe('2025');
  });

  it('is idempotent for a repeated year and releases everything on dispose', () => {
    const kernel = headlessKernel();
    const engine = new RecordingAudioTarget();
    const module = createMusicSourceModule({ engine });
    const baselineChildren = kernel.world.children.length;
    const baselineNodes = countNodes(kernel.world);

    const textureDispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const materialDispose = vi.spyOn(THREE.Material.prototype, 'dispose');

    buildAt(module, kernel, '1985', engine);
    const afterFirst = countNodes(kernel.world);
    const textures = module.describe().textureCount;
    expect(textures).toBeGreaterThan(3);

    const programCalls = engine.programIds.length;
    buildAt(module, kernel, '1985', engine);
    expect(deviceGroupsUnder(kernel.world)).toHaveLength(1);
    expect(countNodes(kernel.world)).toBe(afterFirst);
    expect(engine.programIds.length).toBe(programCalls + 1);

    module.dispose();
    expect(textureDispose).toHaveBeenCalledTimes(textures);
    expect(geometryDispose.mock.calls.length).toBeGreaterThan(20);
    expect(materialDispose.mock.calls.length).toBeGreaterThan(5);
    expect(kernel.world.children.length).toBe(baselineChildren);
    expect(countNodes(kernel.world)).toBe(baselineNodes);
    module.dispose();
    expect(kernel.world.children.length).toBe(baselineChildren);
  });

  it('places every device inside the room on its shelf, wall or counter', () => {
    const kernel = headlessKernel();
    const engine = new RecordingAudioTarget();
    const module = createMusicSourceModule({ engine });
    const { width, depth, height } = kernel.bounds;

    for (const year of YEAR_IDS) {
      buildAt(module, kernel, year, engine);
      const root = module.root;
      expect(root).toBeDefined();
      if (!root) continue;
      const box = worldBox(root);
      expect(box.min.x, `${year} min.x`).toBeGreaterThanOrEqual(-width / 2 - 1e-6);
      expect(box.max.x, `${year} max.x`).toBeLessThanOrEqual(width / 2 + 1e-6);
      expect(box.min.z, `${year} min.z`).toBeGreaterThanOrEqual(-depth / 2 - 1e-6);
      expect(box.max.z, `${year} max.z`).toBeLessThanOrEqual(depth / 2 + 1e-6);
      expect(box.min.y, `${year} min.y`).toBeGreaterThanOrEqual(-1e-6);
      expect(box.max.y, `${year} max.y`).toBeLessThanOrEqual(height);

      const device = module.activeDevice();
      expect(device).not.toBeNull();
      if (!device) continue;
      // Rests on its support: on the counter / ledge / shelf at surface height, or
      // on the floor for the floor-standing jukebox. (The cable run legitimately
      // continues down the wall to the socket, so the whole-group box is only
      // checked for staying above floor level.)
      if (device.placement === 'wall-floor') {
        expect(device.surfaceHeight).toBe(0);
        expect(box.min.y).toBeLessThan(0.1);
      } else {
        expect(device.surfaceHeight).toBeGreaterThan(0.9);
        const cabinet = root.getObjectByName('cabinet.plinth');
        expect(cabinet).toBeDefined();
        if (cabinet) {
          const cabinetBox = worldBox(cabinet);
          expect(Math.abs(cabinetBox.min.y - device.surfaceHeight)).toBeLessThan(0.06);
        }
        expect(box.min.y).toBeGreaterThan(0);
      }
      // Against the wall or counter the era calls for.
      if (device.zone === 'left-wall') {
        expect(device.worldPosition.x).toBeLessThan(-width / 2 + 0.6);
      }
      if (device.zone === 'right-wall') {
        expect(device.worldPosition.x).toBeGreaterThan(width / 2 - 0.8);
      }
      if (device.zone === 'storefront-right') {
        expect(device.worldPosition.z).toBeGreaterThan(depth / 2 - 1.6);
      }
      if (device.zone.startsWith('counter')) {
        const counter = module.layout.counter;
        expect(Math.abs(device.worldPosition.z - counter.center.z)).toBeLessThan(0.5);
        expect(Math.abs(device.worldPosition.y - counter.surfaceHeight)).toBeLessThan(1e-6);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Detail                                                                     */
/* -------------------------------------------------------------------------- */

describe('close-up device detail', () => {
  it('gives every device joinery, dial, grille, controls, badge, cable, glow and wear', () => {
    const kernel = headlessKernel();
    const module = createMusicSourceModule({ engine: new RecordingAudioTarget() });

    for (const year of YEAR_IDS) {
      buildAt(module, kernel, year);
      const spec = musicSpec(year);
      const families = module.partFamilies();
      for (const family of ['cabinet', 'controls', 'dial', 'grille', 'badge', 'glow', 'wear']) {
        expect(families).toContain(family);
      }
      if (spec.cable.route !== 'none') expect(families).toContain('cable');
      if (module.activeDevice()?.support) expect(families).toContain('support');

      // Cabinet joinery: a body plus plinth / moulding / corner detail.
      expect(module.hasPart('cabinet.body')).toBe(true);
      expect(module.partsWithPrefix('cabinet.').length).toBeGreaterThanOrEqual(4);
      // Controls of the era's own type, with legends in the data.
      const controlParts = module.partsWithPrefix('controls.');
      expect(controlParts.length).toBeGreaterThanOrEqual(4);
      expect(controlParts.some((path) => path.includes(CONTROL_PART[spec.controls.kind]))).toBe(true);
      // Dial or display, and something that moves on it.
      const dialParts = module.partsWithPrefix('dial.');
      expect(dialParts.length).toBeGreaterThanOrEqual(2);
      expect(dialParts.some((path) => /needle|screen|glass|display/.test(path))).toBe(true);
      // Grille and cloth with real drivers.
      const grilleParts = module.partsWithPrefix('grille.');
      expect(grilleParts.some((path) => /cloth|wrap/.test(path))).toBe(true);
      expect(grilleParts.filter((path) => path.includes('cone')).length).toBeGreaterThanOrEqual(
        spec.speaker.coneCount,
      );
      // Badge plate with its lettering and retaining screws.
      expect(module.hasPart('badge.plate')).toBe(true);
      expect(module.partsWithPrefix('badge.').length).toBeGreaterThanOrEqual(3);
      // Cable routing with a plug.
      if (spec.cable.route !== 'none') {
        expect(module.hasPart('cable.run')).toBe(true);
        expect(module.partsWithPrefix('cable.').some((path) => path.includes('plug'))).toBe(true);
        expect(module.partsWithPrefix('cable.').some((path) => path.includes('clip'))).toBe(true);
      }
      // Glow and wear.
      expect(module.partsWithPrefix('glow.').length).toBeGreaterThanOrEqual(1);
      expect(module.partsWithPrefix('wear.').length).toBeGreaterThanOrEqual(3);
      // The era's companion props are present as real parts.
      expect(module.partsWithPrefix('accessory.').length).toBeGreaterThanOrEqual(1);
      for (const accessory of spec.accessories) {
        expect(accessory.label.length).toBeGreaterThan(0);
        expect(accessory.detail.length).toBeGreaterThan(10);
      }
    }
  });

  it('carries emissive dials, indicators and lamps that light up close', () => {
    const kernel = headlessKernel();
    const module = createMusicSourceModule({ engine: new RecordingAudioTarget() });

    for (const year of YEAR_IDS) {
      buildAt(module, kernel, year);
      const root = module.root;
      if (!root) throw new Error(`no group for ${year}`);
      let emissiveParts = 0;
      let maxIntensity = 0;
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const standard = material as THREE.MeshStandardMaterial;
          if (standard.emissive && standard.emissiveIntensity > 0) {
            emissiveParts += 1;
            maxIntensity = Math.max(maxIntensity, standard.emissiveIntensity);
          }
        }
      });
      expect(emissiveParts).toBeGreaterThanOrEqual(3);
      expect(maxIntensity).toBeGreaterThanOrEqual(1);
      expect(module.describe().animatedPartCount).toBeGreaterThanOrEqual(2);

      // Every texture on the device was painted in code: no image, font or audio
      // file can appear on a material map.
      const maps: THREE.Texture[] = [];
      root.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const material of materials) {
          const standard = material as THREE.MeshStandardMaterial;
          if (standard.map) maps.push(standard.map);
          if (standard.emissiveMap) maps.push(standard.emissiveMap);
        }
      });
      expect(maps.length).toBeGreaterThan(0);
      expect(maps.every((map) => isMusicTexture(map))).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Animation and reduced motion                                               */
/* -------------------------------------------------------------------------- */

describe('animation', () => {
  it('drives reels, sliding pointers and meters with delta time', () => {
    const kernel = headlessKernel();
    const module = createMusicSourceModule({
      engine: new RecordingAudioTarget(),
      reducedMotion: false,
    });
    buildAt(module, kernel, '1985');
    expect(module.reducedMotion).toBe(false);

    const root = module.root;
    if (!root) throw new Error('no music group');
    const reel = root.getObjectByName('controls.reel-1-1');
    const pointer = root.getObjectByName('dial.needle');
    const meter = root.getObjectByName('dial.meter-needle-left');
    expect(reel).toBeDefined();
    expect(pointer).toBeDefined();
    expect(meter).toBeDefined();
    if (!reel || !pointer || !meter) return;

    const context = { year: '1985' as YearId, elapsedSeconds: 0, frame: 0 };
    const pointerStart = pointer.position.x;
    const meterStart = meter.rotation.z;

    module.update(0.5, context);
    const reelAfter = reel.rotation.z;
    expect(Math.abs(reelAfter)).toBeGreaterThan(0.5);
    expect(pointer.position.x).not.toBe(pointerStart);
    expect(meter.rotation.z).not.toBe(meterStart);

    module.update(1, context);
    expect(Math.abs(reel.rotation.z)).toBeGreaterThan(Math.abs(reelAfter));
    expect(module.describe().updates).toBe(2);
  });

  it('freezes animated detail under prefers-reduced-motion', () => {
    const kernel = headlessKernel();
    const module = createMusicSourceModule({ engine: new RecordingAudioTarget() });
    buildAt(module, kernel, '1985');
    module.setReducedMotion(true);
    expect(module.reducedMotion).toBe(true);

    const root = module.root;
    if (!root) throw new Error('no music group');
    const reel = root.getObjectByName('controls.reel-1-1');
    if (!reel) throw new Error('no reel');
    const context = { year: '1985' as YearId, elapsedSeconds: 0, frame: 0 };
    module.update(0.5, context);
    const first = reel.rotation.z;
    module.update(0.5, context);
    expect(reel.rotation.z).toBe(first);

    // Resuming motion lets the part move again.
    module.setReducedMotion(false);
    module.update(0.5, context);
    expect(reel.rotation.z).not.toBe(first);
  });

  it('parks every animation at its rest pose when reduced motion is on', () => {
    const node = new THREE.Object3D();
    const material = new THREE.MeshStandardMaterial();
    const animations: MusicAnimation[] = [
      { name: 'needle', kind: 'needle', node, axis: 'z', base: 0.25, amplitude: 0.5, rate: 1 },
      { name: 'reel', kind: 'reel', node, axis: 'y', base: 0, amplitude: 0, rate: 2 },
      {
        name: 'glow',
        kind: 'glow',
        node,
        axis: 'y',
        base: 0,
        amplitude: 0.4,
        rate: 1,
        material,
        intensity: 2,
      },
    ];
    advanceMusicAnimations(animations, 3, 0.5, true);
    expect(node.rotation.z).toBe(0.25);
    expect(node.rotation.y).toBe(0);
    expect(material.emissiveIntensity).toBe(2);

    // A phase where the glow pulse is not at its rest point, so motion shows.
    advanceMusicAnimations(animations, 0.375, 0, false);
    expect(node.rotation.z).not.toBe(0.25);
    expect(node.rotation.y).toBeGreaterThan(0);
    expect(material.emissiveIntensity).not.toBe(2);
  });

  it('animates something on every era, including the glow', () => {
    const kernel = headlessKernel();
    const module = createMusicSourceModule({
      engine: new RecordingAudioTarget(),
      reducedMotion: false,
    });
    for (const year of YEAR_IDS) {
      buildAt(module, kernel, year);
      const described = module.describe();
      expect(described.animatedPartCount).toBeGreaterThanOrEqual(2);
      // Running the frame loop never starts playback: the target stays locked.
      module.update(0.25, { year, elapsedSeconds: 0.25, frame: 1 });
      expect(module.routing.awaitingUnlock).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Audio routing                                                              */
/* -------------------------------------------------------------------------- */

describe('routing into the audio engine music bus', () => {
  it('applies the era programme and mix while the engine is locked, without starting it', () => {
    const kernel = headlessKernel();
    const engine = new RecordingAudioTarget();
    engine.state = 'locked';
    const module = createMusicSourceModule({ engine, crossfadeSeconds: 0.4 });

    buildAt(module, kernel, '1965', engine);

    expect(engine.programIds).toEqual(['orchestral-pop-1965']);
    expect(engine.mixIds).toEqual(['music-mix-1965']);
    expect(engine.crossfades).toEqual([0.4]);
    expect(module.routing.engineAttached).toBe(true);
    expect(module.routing.awaitingUnlock).toBe(true);
    expect(module.routing.programId).toBe('orchestral-pop-1965');
    expect(module.routing.mixId).toBe('music-mix-1965');
    // Nothing was scheduled and no private audio graph was created.
    expect(engine.scheduledNotes).toBe(0);
    expect(module.engine).toBe(engine);
    expect(module.appliedMusicLevel()).toBeCloseTo(ERA_MUSIC_MIXES['1965'].music.level, 6);
    expect(module.appliedMusicToneHz()).toBeCloseTo(
      ERA_MUSIC_MIXES['1965'].music.toneHz *
        (0.65 + 0.5 * ERA_MUSIC_MIXES['1965'].brightness) *
        (ERA_MUSIC_MIXES['1965'].music.brightness ?? 1),
      4,
    );
    expect(isMusicAudioTarget(engine)).toBe(true);
  });

  it('routes a different programme into each era and reads the level back', () => {
    const kernel = headlessKernel();
    const engine = new RecordingAudioTarget();
    const module = createMusicSourceModule({ engine });

    const levels: number[] = [];
    const tones: number[] = [];
    for (const year of YEAR_IDS) {
      buildAt(module, kernel, year, engine);
      expect(module.routing.programId).toBe(MUSIC_PROGRAMS[year].id);
      expect(module.routing.mixId).toBe(ERA_MUSIC_MIXES[year].id);
      expect(engine.getMixState().year).toBe(year);
      levels.push(module.appliedMusicLevel());
      tones.push(module.appliedMusicToneHz());
    }
    expect(new Set(levels).size).toBe(YEAR_IDS.length);
    expect(new Set(tones).size).toBe(YEAR_IDS.length);
    expect(engine.mixIds).toHaveLength(YEAR_IDS.length);

    // Taking delivery through the build context services works the same way.
    const viaServices = createMusicSourceModule();
    buildAt(viaServices, kernel, '2005', engine);
    expect(viaServices.routing.programId).toBe('dock-pop-2005');
    expect(viaServices.engine).toBe(engine);
  });

  it('tolerates a suspended engine, and reports detached routing without one', () => {
    const kernel = headlessKernel();
    const engine = new RecordingAudioTarget();
    engine.state = 'suspended';
    const module = createMusicSourceModule({ engine });
    buildAt(module, kernel, '2025', engine);
    expect(module.routing.engineState).toBe('suspended');
    expect(module.routing.awaitingUnlock).toBe(true);
    expect(module.routing.programId).toBe('stream-pop-2025');

    // No engine at all: the device still builds, routing simply reports detached.
    const detached = createMusicSourceModule();
    buildAt(detached, kernel, '1945');
    expect(detached.routing.engineAttached).toBe(false);
    expect(detached.activeDevice()?.kind).toBe('wireless-set');
    expect(detached.appliedMusicLevel()).toBe(0);
  });

  it('exposes a provider the registry can hand to the audio scene module', () => {
    const module = createMusicSourceModule();
    for (const year of YEAR_IDS) {
      expect(module.provider.program?.(year)?.id).toBe(MUSIC_PROGRAMS[year].id);
      expect(module.provider.mix(year)?.id).toBe(ERA_MUSIC_MIXES[year].id);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Procedural textures                                                        */
/* -------------------------------------------------------------------------- */

/** Minimal 2D context stand-in, so the canvas backend can be exercised in node. */
function fakeCanvasFactory(): CanvasFactory {
  return (width, height) =>
    ({
      width,
      height,
      getContext: () => ({
        createImageData: (w: number, h: number) => ({
          width: w,
          height: h,
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData: () => undefined,
      }),
    }) as unknown as HTMLCanvasElement;
}

describe('procedural textures', () => {
  it('paints deterministically in code and names everything in the module namespace', () => {
    const first = createMusicTexture({
      kind: 'grille-cloth',
      base: '#9aa2a8',
      accent: '#5c646b',
      scale: 6,
    });
    expect(first.source).toBe('data');
    expect(first.kind).toBe('grille-cloth');
    expect(isMusicTexture(first.texture)).toBe(true);
    expect(first.texture.name.startsWith('music:')).toBe(true);

    const a = paintMusicSurface({ kind: 'grille-cloth', base: '#9aa2a8', accent: '#5c646b', scale: 6 });
    const b = paintMusicSurface({ kind: 'grille-cloth', base: '#9aa2a8', accent: '#5c646b', scale: 6 });
    expect([...a.data]).toEqual([...b.data]);
    expect(distinctPixelColors(a)).toBeGreaterThan(8);
    first.texture.dispose();
  });

  it('paints an era-specific finish, grille and dial for each device family', () => {
    const kinds = ['veneer', 'bakelite', 'rexine', 'plastic', 'aluminium', 'painted-steel'] as const;
    for (const kind of kinds) {
      const raster = paintMusicSurface({ kind, base: '#7a2f26', accent: '#3a170f', scale: 6 });
      expect(distinctPixelColors(raster)).toBeGreaterThan(8);
    }

    // Grille cloth and dial glass differ between the eras that use them.
    const cloth1945 = paintMusicSurface({ kind: 'grille-cloth', base: '#d8c9a3', accent: '#a8895f', scale: 10 });
    const cloth1985 = paintMusicSurface({ kind: 'grille-cloth', base: '#9aa2a8', accent: '#5c646b', scale: 10 });
    expect([...cloth1945.data]).not.toEqual([...cloth1985.data]);

    const dial = paintMusicSurface({
      kind: 'dial-glass',
      base: '#efe3c4',
      accent: '#ffbb55',
      scale: 5,
      lines: ['HOME', 'LIGHT', 'FORCES'],
    });
    expect(distinctPixelColors(dial)).toBeGreaterThan(20);
  });

  it('uses the canvas backend when one is available', () => {
    const created = createMusicTexture(
      { kind: 'badge', base: '#c9a24a', accent: '#3d2817', lines: ['VALE & FOSTER', 'MODEL R4'] },
      { canvasFactory: fakeCanvasFactory(), key: 'badge' },
    );
    expect(created.source).toBe('canvas');
    expect(created.canvas).not.toBeNull();
    expect(created.texture).toBeInstanceOf(THREE.CanvasTexture);
    created.texture.dispose();
  });

  it('draws legible model plates and dial legends with the code-defined font', () => {
    const raster = new Raster(64, 32);
    const ink = parseColor('#ffffff');
    const advance = drawMusicText(raster, 'R4', 2, 2, ink, 2);
    expect(advance).toBeGreaterThan(0);
    // `drawMusicText` also consumes the gap after the last glyph.
    expect(advance).toBe(measureMusicText('R4', 2) + MUSIC_GLYPH_SPACING * 2);
    let painted = 0;
    for (let offset = 3; offset < raster.data.length; offset += 4) {
      if ((raster.data[offset] ?? 0) > 0) painted += 1;
    }
    expect(painted).toBeGreaterThan(20);
    expect(measureMusicText('', 1)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Module surface                                                             */
/* -------------------------------------------------------------------------- */

describe('module surface', () => {
  it('reports a complete diagnostics snapshot', () => {
    const kernel = headlessKernel();
    const module = createMusicSourceModule({ engine: new RecordingAudioTarget() });
    buildAt(module, kernel, '2005');
    const described = module.describe();
    expect(described.moduleId).toBe(MUSIC_MODULE_ID);
    expect(described.built).toBe(true);
    expect(described.nodeName).toBe('music:2005:ipod-dock-2005');
    expect(described.geometryCount).toBeGreaterThan(40);
    expect(described.materialCount).toBeGreaterThan(5);
    expect(described.textureCount).toBeGreaterThan(3);
    expect(described.device?.accessoryLabels).toContain('Cable clutter');
    expect(described.program.tempo).toBe(108);
    expect(described.programSignature).toContain('dock-pop-2005');
    expect(described.program.instruments).toContain('electric-piano');
    expect(presentPartFamilies(new Map())).toEqual([]);
  });

  it('reports the initial era before the first build', () => {
    const module = createMusicSourceModule({ initialYear: '1985' });
    expect(module.year).toBe('1985');
    expect(module.getHotspots()[0]?.year).toBe('1985');
    expect(module.getHotspots()[0]?.label).toContain('boombox');
    expect(module.describe().built).toBe(false);
    expect(module.partFamilies()).toEqual([]);
  });
});
