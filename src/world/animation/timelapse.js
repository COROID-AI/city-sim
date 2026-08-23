/**
 * Café timelapse transition controller.
 *
 * The controller deliberately works with the existing EraModule contract: era
 * groups need no helpers or lifecycle changes. Names are used as optional
 * staging hints, while unlabelled content still receives a furniture-stage
 * animation. All object/material/light lists are prepared at transition start;
 * update() only mutates already allocated values.
 */
import * as THREE from '../../../public/js/three/build/three.module.js';

export const TRANSITION_DURATION = 2.5;
// Normalized category starts. The shared stageProgress() envelope gives each
// category roughly half the timeline to settle while preserving the order.
const STAGE = Object.freeze({ furniture: 0, counter: 0.2, walls: 0.42, patrons: 0.62 });
const FALLBACK_STAGE = Object.freeze({ furniture: 0, counter: 0.08, walls: 0.16, patrons: 0.24 });
const DEFAULT_STYLE = Object.freeze({
  1945: { wall: 0xd8c7a4, counter: 0x4a3727, light: 0xffbf75, ambient: 0xffe4bc, intensity: 0.36, warmth: 1.0 },
  1965: { wall: 0xc9b58d, counter: 0x7a5330, light: 0xffd18a, ambient: 0xffedcf, intensity: 0.52, warmth: 0.78 },
  1985: { wall: 0x30313b, counter: 0x23262c, light: 0xff72bb, ambient: 0x6c83b8, intensity: 0.62, warmth: 0.48 },
  2005: { wall: 0xc3b49c, counter: 0x596164, light: 0xffd39b, ambient: 0xfff0d8, intensity: 0.7, warmth: 0.3 },
  2025: { wall: 0xe4e8e1, counter: 0x87928d, light: 0xf3f7ff, ambient: 0xeaf4ff, intensity: 0.86, warmth: 0.05 },
});

const scratchColor = new THREE.Color();
const scratchColor2 = new THREE.Color();

function styleFor(ctx, era) {
  return era?.styleTokens || DEFAULT_STYLE[era?.year] || DEFAULT_STYLE[2025];
}
function category(object) {
  const text = `${object.name || ''}`.toLowerCase();
  if (/patron|people|person|figure|businessman|woman|teen|girl|man/.test(text)) return 'patrons';
  if (/menu|poster|sign|art|clock|mural|macrame|plant|board|newspaper|decor|photo|wall|boombox|tv|arcade/.test(text)) return 'walls';
  if (/espresso|register|cash|pastry|sugar|grinder|counter|machine|pos|terminal|cake|jukebox|radio|ipod|equipment/.test(text)) return 'counter';
  return 'furniture';
}
function materialList(group, out) {
  group.traverse((object) => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || out.some((entry) => entry.material === material)) continue;
      out.push({ material, opacity: material.opacity ?? 1, transparent: material.transparent });
    }
  });
}
function prepareGroup(group, incoming, stages, records, materials) {
  if (!group) return;
  group.traverse((object) => {
    if (!object.isObject3D || object === group) return;
    const stage = stages[category(object)] ?? stages.furniture;
    const record = {
      object,
      stage,
      x: object.position.x,
      y: object.position.y,
      z: object.position.z,
      sx: object.scale.x,
      sy: object.scale.y,
      sz: object.scale.z,
      ry: object.rotation.y,
    };
    records.push(record);
    if (incoming) {
      object.position.y -= 0.42;
      object.scale.multiplyScalar(0.01);
      object.rotation.y -= 0.18;
    }
  });
  materialList(group, materials);
  if (incoming) {
    for (const entry of materials) {
      entry.material.transparent = true;
      entry.material.opacity = 0;
      entry.material.needsUpdate = true;
    }
  }
}
function ease(t) { return t * t * (3 - 2 * t); }
function stageProgress(progress, delay) { return THREE.MathUtils.clamp((progress - delay * 0.48) / 0.52, 0, 1); }
function setOpacity(materials, value, incoming) {
  for (const entry of materials) {
    const material = entry.material;
    material.opacity = incoming ? value : 1 - value;
    material.transparent = incoming || entry.transparent || material.opacity < 0.999;
    material.needsUpdate = true;
  }
}
function applyStyle(ctx, from, to, progress, lights) {
  const shell = ctx.shellMeta;
  if (!shell) return;
  const materials = shell.materials || {};
  const wall = materials.wall;
  const counter = materials.counterBody;
  if (wall?.color) wall.color.lerpColors(scratchColor.set(from.wall), scratchColor2.set(to.wall), progress);
  if (counter?.color) counter.color.lerpColors(scratchColor.set(from.counter), scratchColor2.set(to.counter), progress);
  for (const entry of lights) {
    const light = entry.light;
    light.color.lerpColors(scratchColor.set(from.light), scratchColor2.set(to.light), progress);
    light.intensity = THREE.MathUtils.lerp(entry.baseIntensity * from.intensity, entry.baseIntensity * to.intensity, progress);
  }
  if (ctx.scene?.background?.isColor) {
    ctx.scene.background.lerpColors(scratchColor.set(from.ambient), scratchColor2.set(to.ambient), progress * 0.22);
  }
}
function createCue() {
  if (typeof document === 'undefined') return null;
  let cue = document.getElementById('timelapse-cue');
  if (cue) return cue;
  cue = document.createElement('div');
  cue.id = 'timelapse-cue';
  cue.setAttribute('aria-hidden', 'true');
  cue.style.cssText = 'position:fixed;inset:0;z-index:12;pointer-events:none;opacity:0;transition:opacity .12s ease;background:radial-gradient(ellipse at center,transparent 45%,rgba(232,181,92,.3) 100%);mix-blend-mode:screen;';
  const sweep = document.createElement('div');
  sweep.style.cssText = 'position:absolute;top:0;bottom:0;width:22%;background:linear-gradient(90deg,transparent,rgba(255,245,205,.22),transparent);transform:translateX(-130%);';
  cue.appendChild(sweep);
  cue._sweep = sweep;
  document.body.appendChild(cue);
  return cue;
}

class TimelapseController {
  constructor() {
    this.active = null;
    this.reduced = false;
    this.raf = 0;
    this.lastTime = 0;
    this.tick = (time) => {
      if (!this.active) { this.raf = 0; return; }
      const delta = this.lastTime ? (time - this.lastTime) / 1000 : 0;
      this.lastTime = time;
      this.update(delta);
      if (this.active && typeof requestAnimationFrame === 'function') {
        this.raf = requestAnimationFrame(this.tick);
      } else {
        this.raf = 0;
      }
    };
  }
  begin(ctx, outgoing, incoming, fromEra, toEra, finalizeOutgoing) {
    if (this.active) {
      this.active.finalizeOutgoing();
      this.active = null;
    }
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const reduced = this.reduced || (ctx.renderer?.capabilities?.isWebGL2 === false) || (nav?.hardwareConcurrency && nav.hardwareConcurrency <= 2);
    const stages = reduced ? FALLBACK_STAGE : STAGE;
    const transition = {
      ctx, outgoing, incoming, fromEra, toEra, finalizeOutgoing,
      elapsed: 0, duration: reduced ? 0.85 : TRANSITION_DURATION, stages,
      outgoingRecords: [], incomingRecords: [], outgoingMaterials: [], incomingMaterials: [], lights: [], cue: createCue(),
      from: styleFor(ctx, fromEra), to: styleFor(ctx, toEra), finalized: false,
      finalizeOutgoing() { if (this.finalized) return; this.finalized = true; this.finalizeOutgoing(); },
    };
    if (outgoing) prepareGroup(outgoing, false, stages, transition.outgoingRecords, transition.outgoingMaterials);
    if (incoming) prepareGroup(incoming, true, stages, transition.incomingRecords, transition.incomingMaterials);
    ctx.shell?.traverse((object) => {
      if (object.isLight) transition.lights.push({ light: object, baseIntensity: object.intensity });
    });
    this.active = transition;
    if (transition.cue) transition.cue.style.opacity = '1';
    if (!this.raf && typeof requestAnimationFrame === 'function') {
      this.lastTime = 0;
      this.raf = requestAnimationFrame(this.tick);
    }
  }
  update(delta = 0) {
    const t = this.active;
    if (!t) return;
    t.elapsed = Math.min(t.duration, t.elapsed + Math.min(delta, 0.1));
    const progress = t.elapsed / t.duration;
    const eased = ease(progress);
    for (const record of t.outgoingRecords) {
      const p = stageProgress(eased, t.stages[record.stage] ?? 0);
      const e = ease(p);
      record.object.position.y = record.y + (record.stage === 'patrons' ? 0.55 * e : 0.42 * e);
      record.object.rotation.y = record.ry + 0.55 * e;
      const scale = 1 - 0.99 * e;
      record.object.scale.set(record.sx * scale, record.sy * scale, record.sz * scale);
    }
    for (const record of t.incomingRecords) {
      const p = stageProgress(eased, t.stages[record.stage] ?? 0);
      const e = ease(p);
      record.object.position.y = record.y - 0.42 * (1 - e);
      record.object.rotation.y = record.ry - 0.18 * (1 - e);
      record.object.scale.set(record.sx * (0.01 + 0.99 * e), record.sy * (0.01 + 0.99 * e), record.sz * (0.01 + 0.99 * e));
    }
    setOpacity(t.outgoingMaterials, eased, false);
    setOpacity(t.incomingMaterials, eased, true);
    applyStyle(t.ctx, t.from, t.to, eased, t.lights);
    if (t.cue?._sweep) t.cue._sweep.style.transform = `translateX(${progress * 560 - 130}%)`;
    if (progress >= 1) {
      t.finalizeOutgoing();
      if (t.incoming) {
        for (const record of t.incomingRecords) {
          record.object.position.set(record.x, record.y, record.z);
          record.object.rotation.y = record.ry;
          record.object.scale.set(record.sx, record.sy, record.sz);
        }
      }
      for (const entry of t.incomingMaterials) { entry.material.opacity = entry.opacity; entry.material.transparent = entry.transparent; entry.material.needsUpdate = true; }
      if (t.cue) t.cue.style.opacity = '0';
      this.active = null;
    }
  }
}

export const timelapse = new TimelapseController();
export function transitionTo(ctx, outgoing, incoming, fromEra, toEra, finalizeOutgoing) {
  timelapse.begin(ctx, outgoing, incoming, fromEra, toEra, finalizeOutgoing);
}
export function updateTransitions(delta) { timelapse.update(delta); }
export function setReducedMotion(enabled) { timelapse.reduced = Boolean(enabled); }
export function getStyleTokens(year) { return DEFAULT_STYLE[year] || DEFAULT_STYLE[2025]; }
