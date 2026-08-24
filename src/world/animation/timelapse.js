/**
 * Café timelapse transition controller.
 *
 * Owns the choreographed ~2.5 s transformation that plays whenever the era
 * registry switches café eras. The controller deliberately works with the
 * existing EraModule contract: era groups need no helpers or lifecycle
 * changes. Object names are used as optional staging hints, while unlabelled
 * content still receives a furniture-stage animation.
 *
 * Design notes
 * ------------
 * - All object/material/light lists are prepared once at transition start.
 *   update() only mutates already-allocated values (no per-frame allocations,
 *   no new THREE.Color objects, no group.traverse during the frame).
 * - The shared shell morphs between small per-era style tokens (wall / counter
 *   / frame / glass / light colors + intensity + ambient), so the permanent
 *   architecture reads as "one café evolving" rather than swapping.
 * - A reduced-motion fallback shortens the timeline and collapses the staging
 *   windows for weak hardware (WebGL1, low core count).
 * - Interrupts (dragging the slider mid-transition) retarget cleanly: the
 *   active transition is finalized, the mid-state group becomes the new
 *   outgoing group, and base opacities are captured so there is no frame pop.
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { audio } from './audio.js';

export const TRANSITION_DURATION = 2.5;

// Normalized category starts. The shared stageProgress() envelope gives each
// category roughly half the timeline to settle while preserving the order
// (furniture → counter tech → wall dressing → patrons).
const STAGE = Object.freeze({ furniture: 0, counter: 0.2, walls: 0.42, patrons: 0.62 });
const FALLBACK_STAGE = Object.freeze({ furniture: 0, counter: 0.08, walls: 0.16, patrons: 0.24 });

// Era-appropriate staging per category. Outgoing props withdraw with a
// category flavour; incoming props materialise with a matching one.
const OUT_MOTION = Object.freeze({
  // Fall away / drop out.
  furniture: Object.freeze({ dy: 0.38, dz: 0, ry: 0.5, scale: 0.97 }),
  // Swing out (rotate) then recede.
  counter: Object.freeze({ dy: 0.08, dz: 0, ry: 1.25, scale: 0.97 }),
  // Shrink + fade.
  walls: Object.freeze({ dy: 0.16, dz: 0, ry: 0.32, scale: 0.96 }),
  // Walk away / withdraw.
  patrons: Object.freeze({ dy: 0.52, dz: 0.45, ry: 0.4, scale: 0.97 }),
});
const IN_MOTION = Object.freeze({
  // Grow up from the floor.
  furniture: Object.freeze({ dy: -0.42, dz: 0, ry: -0.12, scale: 0.6 }),
  // Swing into place.
  counter: Object.freeze({ dy: -0.2, dz: 0, ry: 0.55, scale: 0.4 }),
  // Fade / materialise in place.
  walls: Object.freeze({ dy: -0.08, dz: 0, ry: -0.18, scale: 0.01 }),
  // Patrons arrive last.
  patrons: Object.freeze({ dy: -0.36, dz: 0, ry: -0.1, scale: 0.01 }),
});

// Per-era shell style tokens. Era modules may override any field via an
// optional `styleTokens` export; missing fields fall back to these defaults.
const DEFAULT_STYLE = Object.freeze({
  1945: Object.freeze({
    wall: 0xd8c7a4, ceiling: 0xefe8d2, frame: 0x3a2f24,
    glass: 0xbcd6e8, doorGlass: 0xa9c6de,
    counterBody: 0x4a3727, counterFront: 0x32261c, counterTop: 0x6f5537, trim: 0x6b5a3c,
    light: 0xffbf75, ambient: 0xffe4bc, intensity: 0.36, warmth: 1.0,
  }),
  1965: Object.freeze({
    wall: 0xc9b58d, ceiling: 0xeae3cd, frame: 0x4a3523,
    glass: 0xc3d7e6, doorGlass: 0xb3ccdf,
    counterBody: 0x7a5330, counterFront: 0x5a3d24, counterTop: 0x8a6a44, trim: 0x7a5f3d,
    light: 0xffd18a, ambient: 0xffedcf, intensity: 0.52, warmth: 0.78,
  }),
  1985: Object.freeze({
    wall: 0x30313b, ceiling: 0x3c3d4a, frame: 0x1c1d22,
    glass: 0x9fb6d6, doorGlass: 0x8fa9c8,
    counterBody: 0x23262c, counterFront: 0x2c3038, counterTop: 0x40444d, trim: 0x2a2e36,
    light: 0xff72bb, ambient: 0x6c83b8, intensity: 0.62, warmth: 0.48,
  }),
  2005: Object.freeze({
    wall: 0xc3b49c, ceiling: 0xd8cdb8, frame: 0x5a4a38,
    glass: 0xbcd4e4, doorGlass: 0xa9c2d6,
    counterBody: 0x596164, counterFront: 0x4c5253, counterTop: 0x6a7378, trim: 0x555d60,
    light: 0xffd39b, ambient: 0xfff0d8, intensity: 0.7, warmth: 0.3,
  }),
  2025: Object.freeze({
    wall: 0xe4e8e1, ceiling: 0xf0f2ec, frame: 0x2e3236,
    glass: 0xd4e4f0, doorGlass: 0xc2d6e4,
    counterBody: 0x87928d, counterFront: 0x6f7a76, counterTop: 0x9aa6a1, trim: 0x7d8a84,
    light: 0xf3f7ff, ambient: 0xeaf4ff, intensity: 0.86, warmth: 0.05,
  }),
});

const scratchColor = new THREE.Color();
const scratchColor2 = new THREE.Color();

// Shell material keys that morph between era style tokens.
const SHELL_MATERIALS = Object.freeze([
  'wall', 'ceiling', 'frame', 'glass', 'doorGlass',
  'counterBody', 'counterFront', 'counterTop', 'trim',
]);

function styleFor(ctx, era) {
  return era?.styleTokens || DEFAULT_STYLE[era?.year] || DEFAULT_STYLE[2025];
}

function category(object) {
  const text = `${object.name || ''}`.toLowerCase();
  if (/patron|people|person|figure|businessman|woman|teen|girl|man/.test(text)) return 'patrons';
  if (/menu|poster|sign|art|clock|mural|macrame|plant|board|newspaper|decor|photo|wall|boombox|tv|arcade|shelf|decal|notice/.test(text)) return 'walls';
  if (/espresso|register|cash|pastry|sugar|grinder|counter|machine|pos|terminal|cake|jukebox|radio|ipod|equipment|drip|brewer|kettle|scale/.test(text)) return 'counter';
  return 'furniture';
}

function materialList(group, out) {
  group.traverse((object) => {
    if (!object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!material || out.some((entry) => entry.material === material)) continue;
      out.push({ material });
    }
  });
}

function prepareGroup(group, incoming, stages, records, materials) {
  if (!group) return;
  group.traverse((object) => {
    if (!object.isObject3D || object === group) return;
    const stage = stages[category(object)] ?? stages.furniture;
    const motion = incoming ? IN_MOTION[stage] ?? IN_MOTION.furniture : OUT_MOTION[stage] ?? OUT_MOTION.furniture;
    const record = {
      object,
      stage,
      motion,
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
      object.position.y += motion.dy;
      object.position.z += motion.dz ?? 0;
      object.rotation.y += motion.ry;
      const s = 1 - motion.scale;
      object.scale.set(record.sx * s, record.sy * s, record.sz * s);
    }
  });
  materialList(group, materials);
  if (incoming) {
    for (const entry of materials) {
      entry.target = entry.material.opacity ?? 1;
      entry.transparent = entry.material.transparent;
      entry.material.opacity = 0;
      entry.material.transparent = true;
      entry.material.needsUpdate = true;
    }
  } else {
    // Capture the *current* opacity as the fade-out base so an interrupted
    // transition (which presents a mid-fade group) retargets without a pop.
    for (const entry of materials) {
      entry.base = entry.material.opacity ?? 1;
      entry.transparent = entry.material.transparent;
    }
  }
}

function ease(t) { return t * t * (3 - 2 * t); }
function stageProgress(progress, delay) { return THREE.MathUtils.clamp((progress - delay * 0.48) / 0.52, 0, 1); }

function setOpacity(materials, value, incoming) {
  for (const entry of materials) {
    const material = entry.material;
    material.opacity = incoming ? entry.target * value : entry.base * (1 - value);
    material.transparent = material.opacity < 0.999 || entry.transparent;
    material.needsUpdate = true;
  }
}

function lerpColor(material, from, to, progress) {
  if (material?.color) material.color.lerpColors(scratchColor.set(from), scratchColor2.set(to), progress);
}

function applyStyle(ctx, from, to, progress, lights) {
  const shell = ctx.shellMeta;
  if (!shell) return;
  const materials = shell.materials || {};
  for (const key of SHELL_MATERIALS) {
    lerpColor(materials[key], from[key] ?? from.wall, to[key] ?? to.wall, progress);
  }
  for (const entry of lights) {
    const light = entry.light;
    light.color.lerpColors(scratchColor.set(from.light), scratchColor2.set(to.light), progress);
    light.intensity = THREE.MathUtils.lerp(
      entry.baseIntensity * from.intensity,
      entry.baseIntensity * to.intensity,
      progress
    );
  }
  if (ctx.scene?.background?.isColor) {
    ctx.scene.background.lerpColors(scratchColor.set(from.ambient), scratchColor2.set(to.ambient), progress * 0.22);
  }
}

/**
 * Builds the DOM timelapse device: a vignette + drifting dust motes + a
 * sweeping light band + a slowly spinning clock-spin ring. Pure CSS motion so
 * it never contends with the render loop. Returns null outside a browser.
 */
function createCue() {
  if (typeof document === 'undefined') return null;
  let cue = document.getElementById('timelapse-cue');
  if (cue) return cue;
  cue = document.createElement('div');
  cue.id = 'timelapse-cue';
  cue.setAttribute('aria-hidden', 'true');
  cue.style.cssText =
    'position:fixed;inset:0;z-index:12;pointer-events:none;opacity:0;' +
    'transition:opacity .12s ease;' +
    'background:radial-gradient(ellipse at center,transparent 42%,rgba(232,181,92,.30) 100%);' +
    'mix-blend-mode:screen;';

  // Light sweep (a bright band that travels across the room).
  const sweep = document.createElement('div');
  sweep.id = 'timelapse-sweep';
  sweep.style.cssText =
    'position:absolute;top:0;bottom:0;width:22%;' +
    'background:linear-gradient(90deg,transparent,rgba(255,245,205,.22),transparent);' +
    'transform:translateX(-130%);';
  cue.appendChild(sweep);

  // Clock-spin ring (slowly rotating hands / spokes overlay).
  const clock = document.createElement('div');
  clock.id = 'timelapse-clock';
  clock.style.cssText =
    'position:absolute;left:50%;top:50%;width:min(46vw,46vh);height:min(46vw,46vh);' +
    'margin-left:-23vw;margin-top:-23vh;border-radius:50%;opacity:.5;' +
    'border:1px solid rgba(255,240,205,.4);' +
    'box-shadow:0 0 0 1px rgba(232,181,92,.16), inset 0 0 0 1px rgba(232,181,92,.16);';
  const spoke = document.createElement('div');
  spoke.style.cssText =
    'position:absolute;left:50%;top:50%;width:50%;height:2px;transform-origin:0 50%;' +
    'background:rgba(255,240,205,.55);';
  clock.appendChild(spoke);
  cue.appendChild(clock);
  cue._clock = clock;
  cue._spoke = spoke;

  // Dust motes drifting in the light.
  const motes = document.createElement('div');
  motes.id = 'timelapse-motes';
  motes.style.cssText = 'position:absolute;inset:0;overflow:hidden;opacity:.5;';
  for (let i = 0; i < 16; i++) {
    const m = document.createElement('div');
    const size = 1 + Math.random() * 2.5;
    const left = (Math.random() * 100).toFixed(1);
    const top = (Math.random() * 100).toFixed(1);
    const dur = (3 + Math.random() * 4).toFixed(2);
    m.style.cssText =
      `position:absolute;left:${left}%;top:${top}%;width:${size}px;height:${size}px;` +
      `border-radius:50%;background:rgba(255,244,210,.9);` +
      `animation:tlMoteDrift ${dur}s ease-in-out infinite;`;
    motes.appendChild(m);
  }
  cue.appendChild(motes);

  document.body.appendChild(cue);

  // Inject the mote keyframes once.
  if (!document.getElementById('timelapse-mote-style')) {
    const style = document.createElement('style');
    style.id = 'timelapse-mote-style';
    style.textContent =
      '@keyframes tlMoteDrift{' +
      '0%{transform:translate(0,0);opacity:.15}' +
      '25%{transform:translate(12px,-18px);opacity:.7}' +
      '50%{transform:translate(-8px,10px);opacity:.35}' +
      '75%{transform:translate(20px,-6px);opacity:.8}' +
      '100%{transform:translate(0,0);opacity:.15}}';
    document.head.appendChild(style);
  }
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
      // Retarget: abandon the in-flight transition. Its incoming group is the
      // new outgoing group, so finalizing only removes the old outgoing era.
      this.active.finalizeOutgoing();
      this.active = null;
    }
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const reduced =
      this.reduced ||
      (ctx.renderer?.capabilities?.isWebGL2 === false) ||
      (nav?.hardwareConcurrency && nav.hardwareConcurrency <= 2);
    const stages = reduced ? FALLBACK_STAGE : STAGE;
    const transition = {
      ctx, outgoing, incoming, fromEra, toEra, finalizeOutgoing,
      elapsed: 0, duration: reduced ? 0.85 : TRANSITION_DURATION, stages,
      outgoingRecords: [], incomingRecords: [],
      outgoingMaterials: [], incomingMaterials: [],
      lights: [], cue: createCue(), reduced,
      from: styleFor(ctx, fromEra), to: styleFor(ctx, toEra), finalized: false,
      finalizeOutgoing() {
        if (this.finalized) return;
        this.finalized = true;
        this.finalizeOutgoing();
      },
    };
    if (outgoing) prepareGroup(outgoing, false, stages, transition.outgoingRecords, transition.outgoingMaterials);
    if (incoming) prepareGroup(incoming, true, stages, transition.incomingRecords, transition.incomingMaterials);
    ctx.shell?.traverse((object) => {
      if (object.isLight) transition.lights.push({ light: object, baseIntensity: object.intensity });
    });
    this.active = transition;
    if (transition.cue) {
      transition.cue.style.opacity = '1';
      if (transition.cue._spoke) transition.cue._spoke.style.transform = 'rotate(0deg)';
    }
    // Crossfade the era audio to the incoming year.
    audio.setEra(toEra);
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
      const m = record.motion;
      record.object.position.y = record.y + m.dy * e;
      record.object.position.z = record.z + (m.dz ?? 0) * e;
      record.object.rotation.y = record.ry + m.ry * e;
      const scale = 1 - m.scale * e;
      record.object.scale.set(record.sx * scale, record.sy * scale, record.sz * scale);
    }
    for (const record of t.incomingRecords) {
      const p = stageProgress(eased, t.stages[record.stage] ?? 0);
      const e = ease(p);
      const m = record.motion;
      record.object.position.y = record.y + m.dy * (1 - e);
      record.object.position.z = record.z + (m.dz ?? 0) * (1 - e);
      record.object.rotation.y = record.ry + m.ry * (1 - e);
      const s = 1 - m.scale * (1 - e);
      record.object.scale.set(record.sx * s, record.sy * s, record.sz * s);
    }
    setOpacity(t.outgoingMaterials, eased, false);
    setOpacity(t.incomingMaterials, eased, true);
    applyStyle(t.ctx, t.from, t.to, eased, t.lights);

    if (t.cue) {
      const cue = t.cue;
      if (cue._sweep) cue._sweep.style.transform = `translateX(${progress * 560 - 130}%)`;
      if (cue._spoke) cue._spoke.style.transform = `rotate(${progress * 720}deg)`;
    }
    audio.update(delta);

    if (progress >= 1) {
      t.finalizeOutgoing();
      if (t.incoming) {
        for (const record of t.incomingRecords) {
          record.object.position.set(record.x, record.y, record.z);
          record.object.rotation.y = record.ry;
          record.object.scale.set(record.sx, record.sy, record.sz);
        }
      }
      for (const entry of t.incomingMaterials) {
        entry.material.opacity = entry.target;
        entry.material.transparent = entry.material.opacity < 0.999 || entry.transparent;
        entry.material.needsUpdate = true;
      }
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