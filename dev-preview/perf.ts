/**
 * Dev preview: the composed game under the adaptive quality governor.
 *
 * Where the other previews isolate one module, this page runs the **whole
 * shipped registry** — the factory floor, the plan graph, the lane comets, the
 * quality constellation, the interface layer, the mission — with the fidelity
 * governor and the performance badge appended exactly as `src/game/systems.ts`
 * composes them. It exists to watch one thing: the frame budget.
 *
 * What the page adds on top of the composed game:
 *
 *  - a **readout** of the governor's own state — active tier, tier target and
 *    ceiling, rolling median / p95 / fps, completed windows, tier changes, the
 *    applied pixel ratio, post-preset, shadow and instance settings, and the
 *    stress rig's draw count;
 *  - a **frame-time chart** measured by this page (not by the governor, whose
 *    measurement path stays allocation-free) so the budget story is visible:
 *    one bar per frame against the active tier's median target;
 *  - **controls** for every tier and for the stress rig, mirroring the badge's
 *    `data-hud="stress-toggle"` acceptance hook;
 *  - the composed **perf badge** itself, which mounts on the HUD overlay anchor
 *    the registry's interface layer publishes.
 *
 * Everything here is presentation: the page never touches simulation state.
 */

import '../src/styles/base.css';

import type { GameFrame } from '../src/game/Game';
import { createSystems, type GameSystems } from '../src/game/systems';
import {
  CALM_TARGET_MS,
  QUALITY_TIERS,
  type QualityTier,
} from '../src/render/qualityTiers';
import { createSampleState } from '../src/sim/fixtures';
import { mountGamePreview, type PreviewHarness } from './harness';

/** Frames the page-local chart keeps. */
export const PERF_CHART_FRAMES = 120;

/** Entity key of this preview page, so tools can address it. */
export const PERF_PREVIEW_ID = 'perf';

/** Live page-side frame-time chart. */
export interface FrameChart {
  readonly samples: number;
  readonly last: number;
  readonly peak: number;
  push(frameMs: number): void;
  setBudget(budgetMs: number): void;
  draw(): void;
}

/**
 * A tiny 2D canvas chart of the frames this page has seen.
 *
 * Deliberately page-local: it is a *picture* of the budget, not a second
 * measurement path, so it may allocate freely while the governor's ring buffer
 * stays fixed.
 */
export function createFrameChart(canvas: HTMLCanvasElement | null): FrameChart {
  const samples = new Float64Array(PERF_CHART_FRAMES);
  let context: CanvasRenderingContext2D | null = null;
  if (canvas) {
    // A host without a 2D canvas (headless CI, a stripped-down preview shell)
    // still gets the readout and the governor; only the picture is skipped.
    try {
      context = canvas.getContext('2d');
    } catch {
      context = null;
    }
  }
  let head = 0;
  let count = 0;
  let budgetMs = CALM_TARGET_MS;
  let last = 0;
  let peak = 0;

  function draw(): void {
    if (!canvas || !context) return;
    const width = canvas.width;
    const height = canvas.height;
    const ceiling = Math.max(budgetMs * 2, peak, 1);
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(4, 10, 20, 0.72)';
    context.fillRect(0, 0, width, height);

    const barWidth = width / PERF_CHART_FRAMES;
    for (let index = 0; index < count; index += 1) {
      const value = samples[(head - count + index + PERF_CHART_FRAMES * 2) % PERF_CHART_FRAMES] ?? 0;
      const barHeight = Math.max(1, Math.min(height, (value / ceiling) * height));
      const over = value > budgetMs;
      context.fillStyle = over ? 'rgba(255, 79, 216, 0.85)' : 'rgba(53, 240, 255, 0.55)';
      context.fillRect(index * barWidth, height - barHeight, Math.max(1, barWidth - 1), barHeight);
    }

    // Tier median target, then its 2× p95 ceiling.
    context.strokeStyle = 'rgba(89, 255, 155, 0.9)';
    context.lineWidth = 1.5;
    const budgetLine = height - (budgetMs / ceiling) * height;
    context.beginPath();
    context.moveTo(0, budgetLine);
    context.lineTo(width, budgetLine);
    context.stroke();
    context.strokeStyle = 'rgba(255, 193, 92, 0.55)';
    context.beginPath();
    context.moveTo(0, height - (budgetMs * 2 > ceiling ? height : (budgetMs * 2 / ceiling) * height));
    context.lineTo(width, height - (budgetMs * 2 > ceiling ? height : (budgetMs * 2 / ceiling) * height));
    context.stroke();

    context.fillStyle = 'rgba(184, 233, 245, 0.85)';
    context.font = '18px ui-monospace, Menlo, Consolas, monospace';
    context.fillText(`${budgetMs.toFixed(1)} ms target`, 8, 22);
    context.fillText(`${last.toFixed(1)} ms last`, 8, 44);
  }

  return {
    get samples() {
      return count;
    },
    get last() {
      return last;
    },
    get peak() {
      return peak;
    },
    push(frameMs: number): void {
      if (!Number.isFinite(frameMs) || frameMs <= 0) return;
      samples[head] = frameMs;
      head = (head + 1) % PERF_CHART_FRAMES;
      if (count < PERF_CHART_FRAMES) count += 1;
      last = frameMs;
      if (frameMs > peak) peak = frameMs;
    },
    setBudget(next: number): void {
      budgetMs = next > 0 ? next : budgetMs;
    },
    draw,
  };
}

/** Running perf preview. */
export interface PerfPreviewHandle {
  readonly harness: PreviewHarness;
  readonly systems: GameSystems;
  readonly chart: FrameChart;
  readonly root: HTMLElement;
  /** Force a tier through the governor (clamped to the device band). */
  setTier(tier: QualityTier): boolean;
  /** Engage or release the stress rig. */
  setStress(active: boolean): boolean;
  /** Repaint the readout and the chart. */
  refresh(): void;
  dispose(): void;
}

export interface PerfPreviewOptions {
  /** Begin real-time playback immediately. Defaults to `true`. */
  autoStart?: boolean;
  /** Seed for the deterministic sample mission state. */
  seed?: number;
}

function formatReadout(systems: GameSystems, adapterKind: string): string[] {
  const quality = systems.quality;
  const state = quality.state;
  const applied = state.applied;
  const world = systems.world.world;
  const rig = quality.rig;
  return [
    `tier     ${state.tier.toUpperCase().padEnd(8)} ${state.held ? 'held ' : 'auto '} ${applied.targetMs.toFixed(1)} ms target / ${applied.ceilingMs.toFixed(1)} ms ceiling`,
    `frames   ${state.fps > 0 ? state.fps.toFixed(0) : '—'} fps   median ${state.samples > 0 ? state.medianMs.toFixed(1) : '—'} ms   p95 ${state.samples > 0 ? state.p95Ms.toFixed(1) : '—'} ms   ${state.overBudget ? 'OVER BUDGET' : 'inside budget'}`,
    `window   ${state.samples}/${state.window} samples   ${quality.adaptive.windows} windows   ${state.headroom ? 'headroom' : 'tight'}   ${quality.changes} tier changes   demotions ${quality.adaptive.strikes.join('/')}`,
    `render   ${adapterKind} ${rig ? `${rig.count}/${rig.capacity} instances` : 'no rig'}   model ${world?.preset ?? '—'}   post ${applied.post ? applied.postPreset : 'off'}   shadows ${applied.shadows ? 'on' : 'off'}   pixel ratio ${applied.pixelRatio}`,
    `stress   ${state.stress ? `engaged — burning ${rig?.targetMs.toFixed(0) ?? '0'} ms/frame (${rig?.burnedMs.toFixed(1) ?? '0'} ms last)` : 'idle'}`,
  ];
}

/**
 * Mount the composed game plus the frame-budget surface into `container`.
 *
 * The returned handle owns the harness, the governor-composed registry and the
 * page listeners; `dispose()` releases all of them.
 */
export function mountPerfPreview(
  container: HTMLElement,
  options: PerfPreviewOptions = {},
): PerfPreviewHandle {
  // The shipped registry, with the interface mounted inside this page's root so
  // the composed HUD (and the badge that hangs off its overlay anchor) render.
  const systems = createSystems({ interfaceHost: container });
  const readout = container.querySelector<HTMLElement>('#perf-readout');
  const chart = createFrameChart(container.querySelector<HTMLCanvasElement>('#perf-chart'));

  const stressButton = container.querySelector<HTMLButtonElement>('[data-coroid-stress-toggle]');
  const autoButton = container.querySelector<HTMLButtonElement>('[data-coroid-tier-hold]');
  const tierButtons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-coroid-tier]'),
  );
  const onTierClick = (event: Event): void => {
    const button = event.currentTarget as HTMLButtonElement | null;
    const tier = button?.dataset.coroidTier as QualityTier | undefined;
    if (tier) {
      // Pinning is what makes a tier inspectable on a host that cannot hold it
      // adaptively: the measurement keeps running, the tiers stop moving.
      systems.quality.holdTier(tier);
      // Repaint immediately: a control must not wait for the next frame.
      refresh();
    }
  };
  const onAutoClick = (): void => {
    systems.quality.holdTier(null);
    refresh();
  };
  const onStressClick = (): void => {
    systems.quality.toggleStress();
    refresh();
  };
  for (const button of tierButtons) button.addEventListener('click', onTierClick);
  autoButton?.addEventListener('click', onAutoClick);
  stressButton?.addEventListener('click', onStressClick);

  let lastFrameAt = 0;
  let lines = ['waiting for the first frame…'];

  const harness = mountGamePreview({
    container,
    adapter: 'auto',
    systems: [...systems.list],
    state: createSampleState({ seed: options.seed ?? 20260918 }),
    overlay: false,
    autoStart: options.autoStart !== false,
    onFrame: (frame: GameFrame) => {
      const now = performance.now();
      if (lastFrameAt > 0) chart.push(now - lastFrameAt);
      lastFrameAt = now;
      chart.setBudget(systems.quality.applied.targetMs);
      if (frame.frame === 1 || frame.frame % 6 === 0) refresh();
    },
  });

  function refresh(): void {
    lines = formatReadout(systems, harness.adapter.kind);
    if (readout) {
      readout.textContent = lines.join('\n');
      readout.dataset.tier = systems.quality.tier;
      readout.dataset.stress = systems.quality.stressActive ? 'on' : 'off';
      readout.dataset.mode = systems.quality.holding ? 'held' : 'auto';
    }
    for (const button of tierButtons) {
      button.setAttribute(
        'aria-pressed',
        systems.quality.holding && button.dataset.coroidTier === systems.quality.tier
          ? 'true'
          : 'false',
      );
    }
    autoButton?.setAttribute('aria-pressed', systems.quality.holding ? 'false' : 'true');
    if (stressButton) {
      const active = systems.quality.stressActive;
      stressButton.setAttribute('aria-pressed', active ? 'true' : 'false');
      stressButton.textContent = active ? 'Stress rig: on' : 'Stress rig: off';
    }
    chart.draw();
  }

  refresh();

  return {
    harness,
    systems,
    chart,
    root: container,
    setTier(tier: QualityTier): boolean {
      const moved = systems.quality.setTier(tier);
      refresh();
      return moved;
    },
    setStress(active: boolean): boolean {
      const moved = systems.quality.setStress(active);
      refresh();
      return moved;
    },
    refresh,
    dispose(): void {
      for (const button of tierButtons) button.removeEventListener('click', onTierClick);
      autoButton?.removeEventListener('click', onAutoClick);
      stressButton?.removeEventListener('click', onStressClick);
      harness.dispose();
    },
  };
}

/** Every tier, for tooling and for the legend. */
export const PERF_PREVIEW_TIERS: readonly QualityTier[] = QUALITY_TIERS;

declare global {
  interface Window {
    /** The running preview, for console and acceptance tooling. */
    coroidPerf?: PerfPreviewHandle;
  }
}

function autoboot(): void {
  if (typeof document === 'undefined') return;
  const container = document.getElementById(PERF_PREVIEW_ID);
  if (!container) return;
  try {
    window.coroidPerf = mountPerfPreview(container);
  } catch (error) {
    console.error('[coroid] failed to mount the frame budget preview', error);
    if (container instanceof HTMLElement) {
      container.textContent = 'Frame budget preview unavailable — no renderer in this browser.';
    }
  }
}

autoboot();
