/**
 * Period registry composition suite (headless, node).
 *
 * Proves the aggregation the plan asks for, end to end and without a GPU:
 *
 *  - the registry exposes lookup by `YearId` for exactly 1945, 1965, 1985, 2005
 *    and 2025, and every resolved era carries a year label, era name, historical
 *    caption, palette, audio programme id, room defaults and a non-empty spec
 *    for all ten detail domains,
 *  - the era metadata is *derived* from the owning domain specs (room finishes,
 *    music programmes) rather than duplicated by the registry,
 *  - an incomplete domain spec map is rejected at assembly time with an error
 *    naming the domain and the missing year, so an incomplete era can never
 *    reach the transition engine,
 *  - for every year the ten modules resolved from the registry are instantiated,
 *    built, applied to that year, updated, asked for hotspots and disposed on a
 *    headless kernel, leaving the world graph empty again.
 *
 * The suite also prints the registry summary (year label, era name, domain
 * count, audio programme id) as the recorded composition artifact.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  YEAR_IDS,
  isPeriodDefinition,
  type DomainSpecBase,
  type Hotspot,
  type YearId,
} from '../contracts/period';
import { createKernel, createManualFrameScheduler, type Kernel } from '../core/kernel';
import { CAFE_ROOM_BOUNDS, environmentSpec } from '../domains/environment';
import { MUSIC_SOURCE_SPECS, musicProgram } from '../domains/music/MusicSourceModule';
import {
  DOMAIN_IDS,
  DOMAIN_REGISTRATIONS,
  PERIOD_REGISTRY,
  PERIOD_YEARS,
  EraRegistryError,
  assembleEraDefinitions,
  createEraModules,
  domainSpec,
  resolvePeriod,
  summarizePeriod,
  summarizeRegistry,
  validateDomainRegistrations,
  type DomainId,
  type DomainRegistration,
} from './periodRegistry';

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const openKernels: Kernel[] = [];

afterEach(() => {
  for (const kernel of openKernels.splice(0)) {
    if (!kernel.isDisposed) kernel.dispose();
  }
});

/** A GPU-free kernel with a manual clock, exactly as the composition root runs it. */
function headlessKernel(): Kernel {
  const kernel = createKernel(null, {
    forceHeadless: true,
    autoResize: false,
    resizeTarget: null,
    scheduler: createManualFrameScheduler(),
    seed: 0x1945,
  });
  openKernels.push(kernel);
  return kernel;
}

/* -------------------------------------------------------------------------- */
/* Lookup and completeness                                                    */
/* -------------------------------------------------------------------------- */

describe('period registry lookup', () => {
  it('resolves exactly the five requested years', () => {
    expect(PERIOD_YEARS).toEqual(['1945', '1965', '1985', '2005', '2025']);
    expect(Object.keys(PERIOD_REGISTRY).sort()).toEqual([...YEAR_IDS].sort());

    for (const year of YEAR_IDS) {
      expect(resolvePeriod(year)).toBe(PERIOD_REGISTRY[year]);
      expect(resolvePeriod(year).year).toBe(year);
    }
  });

  it('throws for a year outside the timeline instead of returning an empty era', () => {
    expect(() => resolvePeriod('1955' as YearId)).toThrow(EraRegistryError);
    expect(() => resolvePeriod('1955' as YearId)).toThrow(/1955/);
  });

  it('carries label, name, caption, palette, audio program, room defaults and all ten specs', () => {
    for (const year of YEAR_IDS) {
      const era = resolvePeriod(year);

      expect(isPeriodDefinition(era)).toBe(true);
      expect(era.label).toBe(year);
      expect(era.name.length).toBeGreaterThan(0);
      expect(era.summary.length).toBeGreaterThan(0);
      expect(era.details.length).toBeGreaterThan(0);

      for (const key of ['background', 'floor', 'wall', 'ceiling', 'accent', 'lamp'] as const) {
        expect(era.palette[key]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      expect(era.lighting.lampIntensity).toBeGreaterThan(0);

      expect(era.audioProgramId.length).toBeGreaterThan(0);
      expect(era.audioProgram.id).toBe(era.audioProgramId);
      expect(era.audioProgram.deviceId.length).toBeGreaterThan(0);

      expect(era.roomDefaults.bounds).toEqual(CAFE_ROOM_BOUNDS);
      expect(era.roomDefaults.bounds.width).toBeGreaterThan(0);
      expect(era.roomDefaults.eyeHeight).toBeGreaterThan(0);
      expect(era.roomDefaults.cameraDistance).toBeGreaterThan(0);

      expect(Object.keys(era.domains).sort()).toEqual([...DOMAIN_IDS].sort());
      for (const id of DOMAIN_IDS) {
        const spec = era.domains[id];
        expect(spec, `era ${year} domain ${id}`).toBeDefined();
        expect(spec.year).toBe(year);
        expect(Object.keys(spec).length).toBeGreaterThan(0);
      }
    }
  });

  it('derives era metadata and specs from the owning domains rather than duplicating them', () => {
    for (const year of YEAR_IDS) {
      const era = resolvePeriod(year);
      const room = environmentSpec(year);
      const program = musicProgram(year);

      expect(era.name).toBe(room.name);
      expect(era.summary).toBe(room.summary);
      expect(era.details).toEqual(room.tags);
      expect(era.palette.wall).toBe(room.paint.wallBase);
      expect(era.palette.lamp).toBe(room.signage.lampColor);
      expect(era.audioProgramId).toBe(program.id);

      // The aggregated specs are the domain modules' own objects, not copies.
      expect(era.domains['environment']).toBe(room);
      expect(era.domains['music']).toBe(MUSIC_SOURCE_SPECS[year]);
    }
  });

  it('exposes a domain spec lookup by year and domain', () => {
    for (const year of YEAR_IDS) {
      const era = resolvePeriod(year);
      for (const id of DOMAIN_IDS) {
        expect(domainSpec(year, id)).toBe(era.domains[id]);
      }
    }
    expect(() => domainSpec('1985', 'nope' as DomainId)).toThrow(/nope/);
  });

  it('is plain frozen data, so importing the registry has no runtime side effects', () => {
    expect(Object.isFrozen(PERIOD_REGISTRY)).toBe(true);
    for (const year of YEAR_IDS) {
      const era = resolvePeriod(year);
      expect(Object.isFrozen(era)).toBe(true);
      expect(Object.isFrozen(era.domains)).toBe(true);
      expect(era).not.toBeInstanceOf(THREE.Object3D);
      expect(era.domains['environment']).not.toBeInstanceOf(THREE.Object3D);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Assembly-time validation                                                   */
/* -------------------------------------------------------------------------- */

/** Rebuilds the registration list with one year removed from one domain's map. */
function withMissingYear(id: DomainId, drop: YearId): readonly DomainRegistration[] {
  const registration = DOMAIN_REGISTRATIONS.find((entry) => entry.id === id);
  if (!registration) throw new Error(`Test fixture missing domain ${id}.`);
  const specs: Record<string, DomainSpecBase> = { ...registration.specs };
  delete specs[drop];
  return DOMAIN_REGISTRATIONS.map((entry) =>
    entry.id === id ? ({ ...entry, specs } as unknown as DomainRegistration) : entry,
  );
}

describe('registry assembly', () => {
  it('accepts the complete production registry', () => {
    expect(() => validateDomainRegistrations()).not.toThrow();
    expect(() => assembleEraDefinitions()).not.toThrow();
    expect(DOMAIN_REGISTRATIONS.map((entry) => entry.id)).toEqual([...DOMAIN_IDS]);
    expect(DOMAIN_REGISTRATIONS).toHaveLength(10);
  });

  it('rejects a domain spec map that omits a year, naming the domain and the missing year', () => {
    for (const id of DOMAIN_IDS) {
      for (const drop of YEAR_IDS) {
        const registrations = withMissingYear(id, drop);

        expect(() => assembleEraDefinitions(registrations)).toThrow(EraRegistryError);
        expect(() => assembleEraDefinitions(registrations)).toThrow(
          new RegExp(`"${id}"[\\s\\S]*"${drop}"`),
        );
      }
    }
  });

  it('rejects a registry that omits a whole domain', () => {
    for (const id of DOMAIN_IDS) {
      const registrations = DOMAIN_REGISTRATIONS.filter((entry) => entry.id !== id);
      expect(() => assembleEraDefinitions(registrations)).toThrow(EraRegistryError);
      expect(() => assembleEraDefinitions(registrations)).toThrow(new RegExp(id));
    }
  });

  it('rejects duplicate and unknown domain registrations', () => {
    const first = DOMAIN_REGISTRATIONS[0];
    expect(first).toBeDefined();
    const duplicate = [...DOMAIN_REGISTRATIONS, first!];
    expect(() => assembleEraDefinitions(duplicate)).toThrow(/registered more than once/);

    const bogus = [
      ...DOMAIN_REGISTRATIONS,
      { ...first!, id: 'bogus' } as unknown as DomainRegistration,
    ];
    expect(() => assembleEraDefinitions(bogus)).toThrow(/not one of the ten detail domains/);
  });
});

/* -------------------------------------------------------------------------- */
/* Headless composition                                                       */
/* -------------------------------------------------------------------------- */

describe('headless composition across the five eras', () => {
  it('builds, applies and disposes all ten domain modules for every year', () => {
    for (const year of YEAR_IDS) {
      const kernel = headlessKernel();
      const period = resolvePeriod(year);
      const instances = createEraModules(year, {
        bounds: period.roomDefaults.bounds,
        seed: 0x1945,
      });

      // Ten modules, one per domain, in canonical order.
      expect(instances.map((instance) => instance.id)).toEqual([...DOMAIN_IDS]);
      expect(instances.map((instance) => instance.moduleId)).toEqual(
        DOMAIN_REGISTRATIONS.map((registration) => registration.moduleId),
      );

      const environment = instances.find((instance) => instance.id === 'environment');
      expect(environment).toBeDefined();
      const services = Object.freeze({ environmentModule: environment!.module });

      kernel.setYear(year);
      const ownedByModule = new Map<string, THREE.Object3D[]>();
      const hotspotsByModule = new Map<string, readonly Hotspot[]>();

      for (const instance of instances) {
        const before = new Set(kernel.world.children);

        instance.module.build(kernel.createBuildContext(period, { services }));
        const raised = kernel.world.children.filter((child) => !before.has(child));
        expect(raised.length, `${instance.id} build raises scene nodes`).toBeGreaterThan(0);
        expect(instance.module.id).toBe(instance.moduleId);

        // Move the timeline onto the same year and animate one frame.
        instance.module.applyPeriod(period, kernel.createBuildContext(period, { services }));
        instance.module.update(1 / 60, {
          year,
          elapsedSeconds: kernel.elapsedSeconds,
          frame: kernel.frame,
        });
        hotspotsByModule.set(instance.id, instance.module.getHotspots());

        ownedByModule.set(
          instance.id,
          kernel.world.children.filter((child) => !before.has(child)),
        );
      }

      // All ten modules coexist in the scene graph.
      expect(kernel.world.children.length).toBeGreaterThanOrEqual(instances.length);

      for (const instance of instances) {
        // `dispose` is idempotent per the SceneModule contract.
        instance.module.dispose();
        instance.module.dispose();
      }

      // Every node a module added is released, and the world graph is empty.
      for (const [id, owned] of ownedByModule) {
        for (const node of owned) {
          expect(node.parent, `${id} released ${node.name}`).toBeNull();
          expect(kernel.world.children.includes(node), `${id} kept ${node.name}`).toBe(false);
        }
      }
      expect(kernel.world.children).toHaveLength(0);

      for (const hotspots of hotspotsByModule.values()) {
        for (const hotspot of hotspots) {
          expect(hotspot.id.length).toBeGreaterThan(0);
          expect(hotspot.year === undefined || hotspot.year === year).toBe(true);
        }
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Composition artifact                                                       */
/* -------------------------------------------------------------------------- */

describe('registry artifacts', () => {
  it('emits the registry summary (year label, era name, domain count, audio program id)', () => {
    const summary = summarizeRegistry();

    expect(summary).toHaveLength(YEAR_IDS.length);
    for (const row of summary) {
      expect(row.label).toBe(row.year);
      expect(row.name.length).toBeGreaterThan(0);
      expect(row.domainCount).toBe(DOMAIN_IDS.length);
      expect(row.audioProgramId.length).toBeGreaterThan(0);
      expect(summarizePeriod(row.year)).toEqual(row);
    }

    const lines = summary.map(
      (row) => `[period-registry] ${row.label} | ${row.name} | domains=${row.domainCount} | audio=${row.audioProgramId}`,
    );
    console.log(`\n${lines.join('\n')}\n`);

    expect(lines).toHaveLength(YEAR_IDS.length);
    expect(lines.every((line) => line.includes('domains=10'))).toBe(true);
  });
});
