/**
 * Era registry — single shared registry for all time-period café modules.
 *
 * EraModule contract:
 *   {
 *     id: string,                     // stable era id, e.g. 'year-2025'
 *     label: string,                  // human label, e.g. '2025'
 *     year: number,                   // the slider year this era maps to
 *     build(ctx) -> THREE.Group,     // called when the era group is created
 *     enter(ctx, group),             // called when the era becomes active
 *     exit(ctx),                     // called when the era is deactivated
 *     assets: string[]               // static asset paths this era needs
 *   }
 *
 * ctx is the shared scene context provided by the app bootstrap:
 *   { scene, renderer, camera, controls, clock, HUD, THREE }
 */
import era1945 from './1945/index.js';

import { era1965 } from './1965/index.js';
import era2005 from './2005/index.js';

export const ERA_YEARS = Object.freeze([1945, 1965, 1985, 2005, 2025]);

const BY_ID = new Map();   // id -> EraModule
const BY_YEAR = new Map(); // year -> EraModule

// Era modules self-register here so the application scaffold remains era-agnostic.
// The other years are still supplied by their placeholder until their modules land.

let activeId = null;
let activeYear = null;
let activeCtx = null;

// Load the completed 1945 interior before the scaffold supplies fallbacks.
registerEra('postwar-1945', era1945);

export function registerEra(id, module) {
  if (!id || typeof id !== 'string') {
    throw new Error(`[eras/registry] registerEra requires a string id, got ${id}`);
  }
  if (!module || typeof module.build !== 'function') {
    throw new Error(`[eras/registry] era "${id}" must provide a build(ctx) function`);
  }
  if (module.assets && !Array.isArray(module.assets)) {
    throw new Error(`[eras/registry] era "${id}" assets must be an array`);
  }
  BY_ID.set(id, module);
  const year = module.year ?? Number.parseInt(id.replace(/^\D+/g, ''), 10);
  if (Number.isFinite(year) && ERA_YEARS.includes(year)) {
    // A completed era imported above must not be replaced by the scaffold's
    // all-years placeholder registration.
    if (BY_YEAR.has(year) && String(id).startsWith('placeholder-')) return module;
    BY_YEAR.set(year, module);
  }
  return module;
}

export function getEra(id) {
  return BY_ID.get(id);
}

export function getEraForYear(year) {
  return BY_YEAR.get(year);
}

export function getActiveEra() {
  return activeId ? BY_ID.get(activeId) : null;
}

export function getActiveYear() {
  return activeYear;
}

export function switchTo(year, ctx) {
  if (!ERA_YEARS.includes(year)) {
    throw new Error(
      `[eras/registry] unknown era year ${year}; expected one of ${ERA_YEARS.join(', ')}`
    );
  }
  if (!ctx) {
    throw new Error('[eras/registry] switchTo requires a context object');
  }
  const next = BY_YEAR.get(year);
  if (!next) {
    throw new Error(`[eras/registry] no era registered for year ${year}`);
  }
  if (activeId === next.id) {
    activeCtx = ctx;
    if (typeof next.enter === 'function') {
      next.enter(ctx, getEraGroup(ctx, next.id));
    }
    return next;
  }
  if (activeId && activeCtx) {
    const prev = BY_ID.get(activeId);
    if (prev && typeof prev.exit === 'function') {
      prev.exit(activeCtx);
    }
    const prevGroup = ctx.scene.getObjectByName(`era-group:${activeId}`);
    if (prevGroup) ctx.scene.remove(prevGroup);
  }
  const group = next.build(ctx);
  if (group) {
    group.name = `era-group:${next.id}`;
    ctx.scene.add(group);
  }
  activeId = next.id;
  activeYear = year;
  activeCtx = ctx;
  if (typeof next.enter === 'function') {
    next.enter(ctx, group);
  }
  return next;
}

function getEraGroup(ctx, id) {
  return ctx.scene.getObjectByName(`era-group:${id}`) ?? null;
}

// Real 1965 era — imported above, registered here so the shared registry
// (and the 1965 slider position) is owned by the era module, replacing the
// 1965 placeholder.
registerEra(era1965.id, era1965);
registerEra(era2005.id, era2005);