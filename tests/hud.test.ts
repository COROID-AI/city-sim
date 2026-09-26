// @vitest-environment happy-dom
/**
 * HUD, terminal, inspector panels and codex.
 *
 * Everything here runs over the shared foundation contracts: the real
 * `createSampleState` fixture, the real reducer (`applyDomainEvents`) and the
 * real interface modules under happy-dom. The assertions are about observable
 * behaviour — what the overlay prints from a snapshot, which provenance chip a
 * log line carries, what the inspector lists, where focus goes when a panel
 * opens and closes, and what the live region announces — rather than about
 * internal bookkeeping.
 *
 * `src/styles/hud.css` is read as a file so the contrast floor (4.5:1 for body
 * text) and the tabular-monospaced counter contract are checked directly against
 * the shipped stylesheet.
 */

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { createDomainEventChannel } from '../src/game/events';
import { createRng } from '../src/game/loop';
import type { SystemContext, SystemUpdate } from '../src/game/systems';
import { createSampleState } from '../src/sim/fixtures';
import {
  applyDomainEvents,
  createInitialState,
  createSnapshot,
  makeDomainEvent,
  type DomainEvent,
  type GameState,
} from '../src/sim/state';
import {
  PROVENANCE_LABELS,
  createEventLog,
  createHudOverlay,
  createObjectiveBanner,
  describeEventText,
  formatInteger,
  formatPercent,
  formatSimClock,
  formatTokens,
  isProvenanceKind,
  logEntryFor,
  provenanceForEvent,
  readBudget,
  readClock,
  readInvariants,
  readLaneOccupancy,
  readPhase,
  readPlanOutline,
  readPlanPhases,
  type ObjectiveChange,
  type HudOverlayHandle,
  type HudPanelAction,
  type HudState,
  type ProvenanceKind,
} from '../src/ui/hud';
import {
  PANEL_KINDS,
  PANEL_TITLES,
  createCodexConcepts,
  createFocusTrap,
  createPanelHost,
  listFocusable,
  type PanelHost,
  type TaskContractMap,
} from '../src/ui/panels';
import { PREVIEW_BRIEFINGS, bootHudPreview, createMissionDirector } from '../dev-preview/hud';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const HUD_KEYS = [
  'overlay',
  'banner',
  'objective',
  'mission-status',
  'budget',
  'budget-bar',
  'budget-fill',
  'invariants',
  'credits',
  'reputation',
  'clock',
  'phase',
  'lane-occupancy',
  'event-log',
  'live',
] as const;

const hosts: HTMLElement[] = [];
const disposers: (() => void)[] = [];

function createHost(id = 'hud-test-host'): HTMLElement {
  const host = document.createElement('div');
  host.id = id;
  document.body.append(host);
  hosts.push(host);
  return host;
}

function previewSnapshot(): HudState {
  return createSnapshot(createSampleState());
}

function advance(state: GameState, events: readonly DomainEvent[]): HudState {
  return createSnapshot(applyDomainEvents(state, events));
}

function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

/** Execution contract used by the inspector tests. */
const INSPECTOR_CONTRACTS: TaskContractMap = {
  'task-gates': {
    readSet: ['src/sim/state.ts', 'src/sim/fixtures.ts'],
    writeSet: ['src/sim/verification.ts', 'tests/verification.test.ts'],
    checks: [
      {
        id: 'check-gate-repair',
        kind: 'typecheck',
        assertion: 'The verification module compiles with no errors.',
        targetFile: 'src/sim/verification.ts',
        evidence: 'command',
        status: 'passed',
      },
      {
        id: 'check-gate-evidence',
        kind: 'test',
        assertion: 'Repairs close when their check passes again.',
        targetFile: 'tests/verification.test.ts',
        evidence: 'command',
        status: 'failed',
        detail: 'one assertion still red',
      },
    ],
    criteria: [
      {
        key: 'criterion-release-readiness',
        label: 'Nothing ships while a repair objective is open.',
        requiredEvidence: 'command',
        lifecycle: 'final_invariant',
        satisfiedByCheckIds: ['check-gate-repair'],
        provenance: 'user_requirement',
      },
    ],
    claims: [
      {
        id: 'claim-brief',
        statement: 'The game must show what Coroid is while it plays.',
        authority: 'user_requirement',
      },
      {
        id: 'claim-slice',
        statement: 'Gate state lives in the shared verification slice.',
        authority: 'repository_observation',
      },
      {
        id: 'claim-repair',
        statement: 'Repairs are modelled per check, not per task.',
        authority: 'architect_choice',
      },
    ],
  },
};

interface Surface {
  readonly host: HTMLElement;
  readonly overlay: HudOverlayHandle;
  readonly panels: PanelHost;
  readonly announcements: string[];
}

function createSurface(options: { contracts?: TaskContractMap; host?: HTMLElement } = {}): Surface {
  const host = options.host ?? createHost();
  const announcements: string[] = [];
  let panels: PanelHost;
  const overlay = createHudOverlay({
    host,
    onIntent: (intent) => panels.togglePanel(intent.panel),
  });
  panels = createPanelHost({
    host,
    contracts: options.contracts,
    announce: (message) => announcements.push(message),
  });
  const surface: Surface = { host, overlay, panels, announcements };
  disposers.push(() => {
    panels.dispose();
    overlay.dispose();
    host.remove();
  });
  return surface;
}

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  while (hosts.length > 0) hosts.pop()?.remove();
  document.body.textContent = '';
});

/* -------------------------------------------------------------------------- */
/* Readings                                                                   */
/* -------------------------------------------------------------------------- */

describe('HUD readings', () => {
  it('derives the budget, invariants, clock, phase and lane occupancy from the fixture', () => {
    const state = previewSnapshot();

    const budget = readBudget(state);
    expect(budget.budget).toBe(200_000);
    expect(budget.spent).toBeGreaterThan(18_400);
    expect(budget.remaining).toBe(budget.budget - budget.spent);
    expect(budget.label).toBe(`${formatTokens(budget.spent)} / ${formatTokens(budget.budget)}`);
    expect(budget.depleted).toBe(false);

    const invariants = readInvariants(state);
    expect(invariants.total).toBe(state.quality.order.length);
    expect(invariants.held).toBe(1); // determinism is measured at its target
    expect(invariants.label).toBe('1/5');
    expect(invariants.heldIds).toContain('metric-determinism');

    const clock = readClock(state);
    // The fixture script settles at t+12.47s with a 45 minute deadline.
    expect(clock.elapsedMs).toBe(12_470);
    expect(clock.elapsedLabel).toBe('00:12');
    expect(clock.elapsedClock).toBe('t+00:12');
    expect(clock.remainingLabel).toBe('44:47 left');
    expect(clock.expired).toBe(false);

    const occupancy = readLaneOccupancy(state);
    expect(occupancy.total).toBe(5);
    // Two lanes carry the running tasks; the third running task waits in a queue.
    expect(occupancy.busy).toBe(2);
    expect(occupancy.queued).toBe(1);
    expect(occupancy.label).toBe('2/5 lanes busy');

    const phase = readPhase(state);
    expect(phase.label).toBe('Phase 3 of 5');
    expect(phase.caption).toContain('Build');
  });

  it('layers the plan into dependency phases', () => {
    const state = previewSnapshot();
    const rows = readPlanOutline(state);
    expect(rows.map((row) => row.id)).toEqual([...state.plan.order]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 2, 3, 2, 4]);
    expect(rows.find((row) => row.id === 'task-review')?.dependencies).toEqual([
      'task-gates',
      'task-constellation',
    ]);
    expect(rows.find((row) => row.id === 'task-shell')?.dependents).toContain('task-contract');

    const phases = readPlanPhases(state);
    expect(phases.map((entry) => entry.label)).toEqual([
      'Phase 1',
      'Phase 2',
      'Phase 3',
      'Phase 4',
      'Phase 5',
    ]);
    expect(phases[4]?.taskIds).toEqual(['task-review']);
  });

  it('formats counters, clocks and quantities for the interface', () => {
    expect(formatSimClock(90_000)).toBe('01:30');
    expect(formatSimClock(3_723_000)).toBe('1:02:03');
    expect(formatInteger(4_960)).toBe('4,960');
    expect(formatInteger(1_234_567)).toBe('1,234,567');
    expect(formatTokens(164_600)).toBe('164.6k');
    expect(formatTokens(950)).toBe('950');
    expect(formatPercent(0.584)).toBe('58%');
  });

  it('maps every domain event to its provenance kind', () => {
    const cases: [DomainEvent, ProvenanceKind][] = [
      [makeDomainEvent('mission/started', {}, 0), 'user_requirement'],
      [makeDomainEvent('economy/deadline', { deadlineMs: 1_000 }, 10), 'user_requirement'],
      [makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 'task-shell' }, 20), 'architect_choice'],
      [makeDomainEvent('plan/task-updated', { taskId: 'task-shell', status: 'passed' }, 30), 'architect_choice'],
      [
        makeDomainEvent('verification/run', { gateId: 'gate-typecheck', status: 'passed', coverage: 1 }, 40),
        'repository_observation',
      ],
      [makeDomainEvent('economy/spend', { credits: 10, contextTokens: 100 }, 50), 'repository_observation'],
    ];
    for (const [event, expected] of cases) {
      expect(provenanceForEvent(event)).toBe(expected);
      expect(isProvenanceKind(expected)).toBe(true);
    }
    expect(isProvenanceKind('guesswork')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Overlay                                                                    */
/* -------------------------------------------------------------------------- */

describe('HUD top overlay', () => {
  it('renders the mission readouts and keeps stable data-hud hooks', () => {
    const surface = createSurface();
    const state = previewSnapshot();
    surface.overlay.update(state);

    for (const key of HUD_KEYS) {
      expect(surface.overlay.query(key), `missing data-hud="${key}"`).not.toBeNull();
    }

    const budget = readBudget(state);
    expect(surface.overlay.query('budget')?.textContent).toBe(budget.label);
    expect(surface.overlay.query('budget-fill')?.style.width).toBe(
      `${(budget.remainingFraction * 100).toFixed(1)}%`,
    );
    expect(surface.overlay.query('budget-bar')?.getAttribute('aria-valuenow')).toBe(
      String(Math.round(budget.remainingFraction * 100)),
    );

    expect(surface.overlay.query('invariants')?.textContent).toBe('1/5');
    expect(surface.overlay.query('credits')?.textContent).toBe(formatInteger(state.economy.credits));
    expect(surface.overlay.query('reputation')?.textContent).toBe(
      String(Math.round(state.economy.reputation)),
    );
    expect(surface.overlay.query('clock')?.textContent).toBe(readClock(state).elapsedClock);
    expect(surface.overlay.query('clock')?.parentElement?.textContent).toContain(
      readClock(state).remainingLabel,
    );
    expect(surface.overlay.query('phase')?.textContent).toContain('Phase 3 of 5');

    // Counters are monospaced with tabular digits.
    for (const key of ['budget', 'invariants', 'credits', 'reputation', 'clock'] as const) {
      expect(surface.overlay.query(key)?.classList.contains('hud-num'), key).toBe(true);
    }

    // One chip per lane, flagged busy exactly when an agent is on it.
    const lanes = surface.overlay.queryAll('lane');
    expect(lanes.map((lane) => lane.dataset.laneId)).toEqual([...state.lanes.order]);
    expect(lanes.filter((lane) => lane.dataset.busy === 'true')).toHaveLength(2);
    expect(surface.overlay.query('lane-occupancy')?.dataset.busy).toBe('2');
  });

  it('shrinks the depletion bar as the mission spends context and warns when low', () => {
    const surface = createSurface();
    surface.overlay.update(previewSnapshot());
    const first = Number.parseFloat(surface.overlay.query('budget-fill')?.style.width ?? '0');

    const mid = advance(createSampleState(), [
      makeDomainEvent('economy/spend', { credits: 0, contextTokens: 60_000 }, 120_000),
    ]);
    surface.overlay.update(mid);
    const second = Number.parseFloat(surface.overlay.query('budget-fill')?.style.width ?? '0');
    expect(second).toBeLessThan(first);
    expect(surface.overlay.query('budget-bar')?.getAttribute('aria-valuenow')).toBe(
      String(Math.round(readBudget(mid).remainingFraction * 100)),
    );
    expect(readBudget(mid).depleted).toBe(false);

    const drained = advance(createSampleState(), [
      makeDomainEvent('economy/spend', { credits: 0, contextTokens: 150_000 }, 120_000),
    ]);
    surface.overlay.update(drained);
    expect(readBudget(drained).depleted).toBe(true);
    expect(surface.overlay.query('budget-fill')?.style.width).toBe('0.0%');
    expect(surface.overlay.liveRegion.textContent).toMatch(/Context budget low/);
  });

  it('counts final invariants as metrics reach their targets and announces it', () => {
    const surface = createSurface();
    const state = previewSnapshot();
    surface.overlay.update(state);

    const settled = advance(createSampleState(), [
      makeDomainEvent('quality/measured', { metric: { id: 'metric-fidelity', label: 'Visual fidelity', value: 1, target: 1, weight: 0.25 } }, 120_000),
      makeDomainEvent('quality/measured', { metric: { id: 'metric-frame-budget', label: 'Frame budget', value: 1, target: 1, weight: 0.15 } }, 120_100),
      makeDomainEvent('quality/measured', { metric: { id: 'metric-contract-coverage', label: 'Contract coverage', value: 0.95, target: 0.95, weight: 0.2 } }, 120_200),
      makeDomainEvent('quality/measured', { metric: { id: 'metric-readability', label: 'Readability', value: 1, target: 1, weight: 0.1 } }, 120_300),
    ]);
    expect(readInvariants(settled).held).toBe(5);
    surface.overlay.update(settled);
    expect(surface.overlay.query('invariants')?.textContent).toBe('5/5');
    expect(surface.overlay.liveRegion.textContent).toMatch(/Invariant settled: 5 of 5 hold/);
  });

  it('raises panel intents from its toolbar buttons', () => {
    const intents: HudPanelAction[] = [];
    const host = createHost();
    const overlay = createHudOverlay({
      host,
      onIntent: (intent) => intents.push(intent.panel),
    });
    disposers.push(() => {
      overlay.dispose();
      host.remove();
    });

    overlay.query('action-codex')?.click();
    overlay.query('action-inspector')?.click();
    expect(intents).toEqual(['codex', 'inspector']);

    const toolbar = overlay.query('action-outline')?.parentElement;
    expect(toolbar?.getAttribute('role')).toBe('toolbar');
    expect(overlay.liveRegion.getAttribute('aria-live')).toBe('polite');
    expect(overlay.liveRegion.getAttribute('role')).toBe('status');
  });

  it('announces objective and status changes through the aria-live region', () => {
    const surface = createSurface();
    const first = createSnapshot(createInitialState({ seed: 11, objective: 'Ship the first briefing.' }));
    surface.overlay.update(first);
    expect(surface.overlay.liveRegion.textContent).toBe('');

    const second = createSnapshot(createInitialState({ seed: 11, objective: 'Ship the second briefing.' }));
    surface.overlay.update(second);
    expect(surface.overlay.query('objective')?.textContent).toBe('Ship the second briefing.');
    expect(surface.overlay.liveRegion.textContent).toBe('Objective updated: Ship the second briefing.');

    const third = advance(createInitialState({ seed: 11, objective: 'Ship the second briefing.' }), [
      makeDomainEvent('mission/status', { status: 'delivering' }, 500),
    ]);
    surface.overlay.update(third);
    expect(surface.overlay.liveRegion.textContent).toBe('Mission delivering');
  });

  it('announces a gate alarm when a gate fails', () => {
    const surface = createSurface();
    surface.overlay.update(previewSnapshot());
    const failed = advance(createSampleState(), [
      makeDomainEvent('verification/run', { gateId: 'gate-typecheck', status: 'failed', coverage: 0.4 }, 120_000),
    ]);
    surface.overlay.update(failed);
    expect(surface.overlay.liveRegion.textContent).toMatch(/Verification alarm: 1 gate failing/);
  });
});

/* -------------------------------------------------------------------------- */
/* Event-log terminal                                                         */
/* -------------------------------------------------------------------------- */

describe('event-log terminal', () => {
  it('appends readable lines with a timestamp and a provenance chip', () => {
    const log = createEventLog();
    disposers.push(() => log.dispose());
    expect(log.empty).toBe(true);
    expect(log.element.querySelector('[data-hud="log-empty"]')).not.toBeNull();

    const events: DomainEvent[] = [
      makeDomainEvent('mission/started', {}, 0),
      makeDomainEvent('lane/assigned', { laneId: 'lane-build', taskId: 'task-shell' }, 1_000),
      makeDomainEvent('verification/run', { gateId: 'gate-typecheck', status: 'passed', coverage: 1 }, 61_000),
    ];
    for (const event of events) log.appendEvent(event);

    expect(log.empty).toBe(false);
    expect(log.element.querySelector('[data-hud="log-empty"]')).toBeNull();
    expect(log.entries).toHaveLength(3);
    expect(log.entries.map((entry) => entry.text)).toEqual(events.map(describeEventText));
    expect(log.entries[0]?.text).toBe('Mission started');
    expect(log.entries[1]?.text).toBe('Agent dispatched to task-shell on lane-build');
    expect(log.entries[2]?.text).toBe('Gate gate-typecheck → passed · 100% coverage');

    const lines = [...log.lines.querySelectorAll<HTMLElement>('.hud-log__line')];
    expect(lines[0]?.querySelector('[data-hud="log-time"]')?.textContent).toBe('t+00:00');
    expect(lines[2]?.querySelector('[data-hud="log-time"]')?.textContent).toBe('t+01:01');

    const chips = lines.map((line) => line.querySelector<HTMLElement>('[data-hud="log-provenance"]'));
    expect(chips.map((chip) => chip?.dataset.provenance)).toEqual([
      'user_requirement',
      'architect_choice',
      'repository_observation',
    ]);
    // Provenance is a chip *plus* a readable label, never colour alone.
    expect(chips.map((chip) => chip?.textContent)).toEqual([
      PROVENANCE_LABELS.user_requirement,
      PROVENANCE_LABELS.architect_choice,
      PROVENANCE_LABELS.repository_observation,
    ]);
  });

  it('keeps the newest line visible and drops the oldest beyond its limit', () => {
    const log = createEventLog({ limit: 3 });
    disposers.push(() => log.dispose());
    for (let index = 0; index < 5; index += 1) {
      log.append(logEntryFor(makeDomainEvent('quality/finding', {
        finding: { id: `finding-${index}`, severity: 'low', summary: `observation ${index}`, taskId: null, atMs: index * 1_000 },
      }, index * 1_000), `entry-${index}`));
    }

    expect(log.entries.map((entry) => entry.id)).toEqual(['entry-2', 'entry-3', 'entry-4']);
    const lines = [...log.lines.querySelectorAll<HTMLElement>('.hud-log__line')];
    expect(lines).toHaveLength(3);
    const latest = lines[lines.length - 1];
    expect(latest?.dataset.hudLine).toBe('latest');
    expect(latest?.classList.contains('is-latest')).toBe(true);
    expect(latest?.querySelector('[data-hud="log-text"]')?.textContent).toBe('Finding [low] observation 4');
    // The terminal is pinned to the bottom, so the newest line stays on screen.
    expect(log.element.scrollTop).toBe(log.element.scrollHeight);
    expect(lines.filter((line) => line.dataset.hudLine === 'latest')).toHaveLength(1);
    expect(log.element.querySelector('[data-hud="log-count"]')?.textContent).toBe('3');
  });

  it('replaces its content deterministically with setEntries and clear', () => {
    const log = createEventLog({ limit: 8 });
    disposers.push(() => log.dispose());
    log.appendEvent(makeDomainEvent('mission/started', {}, 0));
    log.setEntries([logEntryFor(makeDomainEvent('mission/started', {}, 0), 'replay-1')]);
    expect(log.entries.map((entry) => entry.id)).toEqual(['replay-1']);
    expect(log.lines.querySelectorAll('.hud-log__line')).toHaveLength(1);
    log.clear();
    expect(log.empty).toBe(true);
    expect(log.element.querySelector('[data-hud="log-empty"]')).not.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Panels                                                                     */
/* -------------------------------------------------------------------------- */

describe('panel metadata', () => {
  it('publishes the four panel kinds and their titles', () => {
    expect(PANEL_KINDS).toEqual(['inspector', 'outline', 'report', 'codex']);
    expect(PANEL_TITLES).toEqual({
      inspector: 'Task inspector',
      outline: 'Plan outline',
      report: 'Verification report',
      codex: 'Codex',
    });
  });
});

describe('objective banner', () => {
  it('renders the objective, status and progress, and reports changes', () => {
    const changes: ObjectiveChange[] = [];
    const banner = createObjectiveBanner({ onObjectiveChange: (change) => changes.push(change) });
    disposers.push(() => banner.dispose());

    const state = previewSnapshot();
    banner.update(state);
    expect(banner.element.querySelector('[data-hud="objective"]')?.textContent).toBe(
      state.mission.objective,
    );
    expect(banner.element.querySelector('[data-hud="mission-status"]')?.textContent).toBe(
      state.mission.status,
    );
    expect(banner.element.querySelector('[data-hud="mission-progress"]')?.getAttribute('aria-valuenow')).toBe(
      (state.mission.progress * 100).toFixed(0),
    );
    expect(changes).toHaveLength(0);

    const delivering = advance(createSampleState(), [
      makeDomainEvent('mission/status', { status: 'delivering' }, 91_000),
    ]);
    banner.update(delivering);
    expect(changes.map((change) => change.kind)).toEqual(['status']);
    expect(changes[0]?.previous).toBe('running');
    expect(changes[0]?.next).toBe('delivering');
  });
});

describe('task inspector', () => {
  it('shows the selected task read set, write set, checks, criteria and claims', () => {
    const surface = createSurface({ contracts: INSPECTOR_CONTRACTS });
    surface.panels.update(previewSnapshot());
    surface.panels.selectTask('task-gates');
    surface.panels.openPanel('inspector');

    const panel = surface.panels.panelElement('inspector');
    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.querySelector('[data-hud="inspector-title"]')?.textContent).toBe(
      'Light the verification gates',
    );

    const readSet = [...panel.querySelectorAll('[data-hud="inspector-readset"] li')].map(
      (item) => item.textContent,
    );
    expect(readSet).toEqual(['src/sim/state.ts', 'src/sim/fixtures.ts']);

    const writeSet = [...panel.querySelectorAll('[data-hud="inspector-writeset"] li')].map(
      (item) => item.textContent,
    );
    expect(writeSet).toEqual(['src/sim/verification.ts', 'tests/verification.test.ts']);

    const checks = [...panel.querySelectorAll<HTMLElement>('[data-hud="inspector-check"]')];
    expect(checks.map((card) => card.dataset.checkId)).toEqual([
      'check-gate-repair',
      'check-gate-evidence',
    ]);
    expect(checks[1]?.querySelector('[data-hud="check-status"]')?.textContent).toBe('failed');
    expect(checks[1]?.querySelector('[data-hud="check-detail"]')?.textContent).toBe(
      'one assertion still red',
    );

    const criteria = [...panel.querySelectorAll<HTMLElement>('[data-hud="inspector-criterion"]')];
    expect(criteria.map((card) => card.dataset.criterionKey)).toEqual(['criterion-release-readiness']);
    expect(criteria[0]?.querySelector('[data-hud="criterion-lifecycle"]')?.textContent).toBe(
      'final invariant',
    );
    expect(criteria[0]?.querySelector('[data-hud="criterion-provenance"]')?.textContent).toBe(
      PROVENANCE_LABELS.user_requirement,
    );

    const claims = [...panel.querySelectorAll<HTMLElement>('[data-hud="inspector-claim"]')];
    expect(claims.map((card) => card.dataset.claimId)).toEqual([
      'claim-brief',
      'claim-slice',
      'claim-repair',
    ]);
    expect(
      claims.map((card) => card.querySelector<HTMLElement>('[data-hud="claim-provenance"]')?.dataset.provenance),
    ).toEqual(['user_requirement', 'repository_observation', 'architect_choice']);

    // Findings raised against the task in state are shown too.
    surface.panels.selectTask('task-economy');
    expect(
      surface.panels.panelElement('inspector').querySelector('[data-hud="finding-summary"]')?.textContent,
    ).toContain('Observability lane is consuming context');
  });

  it('reports an undeclared contract instead of inventing one', () => {
    const surface = createSurface({ contracts: INSPECTOR_CONTRACTS });
    surface.panels.update(previewSnapshot());
    surface.panels.selectTask('task-shell');
    surface.panels.openPanel('inspector');
    const panel = surface.panels.panelElement('inspector');
    expect(panel.querySelector('[data-hud="inspector-readset"]')).toBeNull();
    expect(panel.textContent).toContain('No read set declared for this task.');
    expect(panel.textContent).toContain('No checks declared for this task.');
    expect(surface.panels.selectedTaskId).toBe('task-shell');
  });

  it('closes with Escape and restores focus to the opener', () => {
    const surface = createSurface({ contracts: INSPECTOR_CONTRACTS });
    surface.panels.update(previewSnapshot());

    const opener = document.createElement('button');
    opener.textContent = 'open outline';
    surface.host.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    surface.panels.openPanel('outline');
    const panel = surface.panels.panelElement('outline');
    expect(surface.panels.open).toBe('outline');
    expect(panel.hidden).toBe(false);
    expect(document.activeElement === panel || panel.contains(document.activeElement)).toBe(true);
    expect(surface.announcements).toContain('Plan outline opened');

    const event = press(panel, 'Escape');
    expect(surface.panels.handleKey(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(surface.panels.open).toBeNull();
    expect(panel.hidden).toBe(true);
    expect(document.activeElement).toBe(opener);
    expect(surface.announcements).toContain('Plan outline closed');
  });

  it('traps Tab and Shift+Tab inside the open panel', () => {
    const surface = createSurface();
    surface.panels.update(previewSnapshot());
    surface.panels.openPanel('outline');
    const panel = surface.panels.panelElement('outline');
    const focusables = listFocusable(panel);
    const rows = [...panel.querySelectorAll<HTMLElement>('.hud-outline__row')];
    expect(rows).toHaveLength(7);
    expect(focusables).toHaveLength(rows.length + 1); // close button + one row per task

    rows[rows.length - 1]?.focus();
    surface.panels.handleKey(press(panel, 'Tab'));
    expect(document.activeElement).toBe(focusables[0]);

    surface.panels.handleKey(press(panel, 'Tab', { shiftKey: true }));
    expect(document.activeElement).toBe(rows[rows.length - 1]);
  });

  it('walks rows with the arrow keys and opens the focused task', () => {
    const surface = createSurface({ contracts: INSPECTOR_CONTRACTS });
    surface.panels.update(previewSnapshot());
    surface.panels.openPanel('outline');
    const panel = surface.panels.panelElement('outline');
    const rows = [...panel.querySelectorAll<HTMLElement>('.hud-outline__row')];

    surface.panels.handleKey(press(panel, 'ArrowDown'));
    expect(document.activeElement).toBe(rows[0]);
    surface.panels.handleKey(press(panel, 'ArrowDown'));
    expect(document.activeElement).toBe(rows[1]);
    surface.panels.handleKey(press(panel, 'ArrowUp'));
    expect(document.activeElement).toBe(rows[0]);

    rows[5]?.click();
    expect(surface.panels.selectedTaskId).toBe(rows[5]?.dataset.taskId);
    expect(surface.panels.open).toBe('inspector');
    expect(surface.panels.panelElement('outline').hidden).toBe(true);
    expect(
      surface.panels.panelElement('inspector').querySelector('[data-hud="inspector-task-id"]')?.textContent,
    ).toBe(rows[5]?.dataset.taskId);
  });

  it('leaves Escape and Tab alone while no panel is open', () => {
    const surface = createSurface();
    surface.panels.update(previewSnapshot());
    const escape = press(document.body, 'Escape');
    expect(surface.panels.handleKey(escape)).toBe(false);
    expect(escape.defaultPrevented).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Plan outline, verification report and codex                                */
/* -------------------------------------------------------------------------- */

describe('plan outline', () => {
  it('groups tasks into phases and marks the selected task', () => {
    const surface = createSurface();
    const state = previewSnapshot();
    surface.panels.update(state);
    surface.panels.openPanel('outline');

    const panel = surface.panels.panelElement('outline');
    const phases = [...panel.querySelectorAll<HTMLElement>('[data-hud="outline-phase"]')];
    expect(phases.map((phase) => phase.dataset.phase)).toEqual(['0', '1', '2', '3', '4']);
    expect(panel.querySelector('[data-hud="outline-title"]')?.textContent).toBe('Plan outline · 7 tasks');
    expect(surface.panels.selectedTaskId).toBe('task-lane-comets'); // first running task
    expect(panel.querySelector('[data-task-id="task-lane-comets"]')?.getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('keeps keyboard focus on the same row while the mission streams updates', () => {
    const surface = createSurface();
    surface.panels.update(previewSnapshot());
    surface.panels.openPanel('outline');
    const panel = surface.panels.panelElement('outline');
    const rows = [...panel.querySelectorAll<HTMLElement>('.hud-outline__row')];

    rows[2]?.focus();
    expect(document.activeElement).toBe(rows[2]);

    // A progress update re-renders the panel: focus must stay on the same task.
    surface.panels.update(
      advance(createSampleState(), [
        makeDomainEvent('plan/task-updated', { taskId: 'task-gates', progress: 0.95 }, 120_000),
      ]),
    );
    const after = [...panel.querySelectorAll<HTMLElement>('.hud-outline__row')];
    expect(after[2]?.dataset.taskId).toBe(rows[2]?.dataset.taskId);
    expect(document.activeElement).toBe(after[2]);
  });
});

describe('verification report', () => {
  it('reports gates, metrics, findings and the derived scores', () => {
    const surface = createSurface();
    const state = previewSnapshot();
    surface.panels.update(state);
    surface.panels.openPanel('report');
    const panel = surface.panels.panelElement('report');

    const gates = [...panel.querySelectorAll<HTMLElement>('[data-hud="report-gate"]')];
    expect(gates.map((gate) => gate.dataset.gateId)).toEqual([...state.verification.order]);
    expect(panel.querySelector('[data-hud="report-pass-rate"]')?.textContent).toBe(
      formatPercent(state.verification.passRate),
    );
    expect(panel.querySelector('[data-hud="report-quality-score"]')?.textContent).toBe(
      state.quality.score.toFixed(2),
    );
    expect(panel.querySelector('[data-hud="report-invariants"]')?.textContent).toBe('1/5 hold');
    expect(panel.querySelector('[data-hud="report-credits"]')?.textContent).toBe(
      formatInteger(state.economy.credits),
    );

    const metrics = [...panel.querySelectorAll<HTMLElement>('[data-hud="report-metric"]')];
    expect(metrics.map((metric) => metric.dataset.metricId)).toEqual([...state.quality.order]);
    expect(
      metrics.map((metric) => metric.querySelector('[data-hud="metric-state"]')?.textContent),
    ).toEqual(['below target', 'invariant holds', 'below target', 'below target', 'below target']);

    const findings = [...panel.querySelectorAll<HTMLElement>('[data-hud="report-finding"]')];
    expect(findings).toHaveLength(state.quality.findings.length);
    expect(panel.textContent).toContain('Observability lane is consuming context');
  });
});

describe('codex', () => {
  it('lists every concept the mission uses, with provenance chips', () => {
    const surface = createSurface();
    const state = previewSnapshot();
    surface.panels.update(state);
    surface.panels.openPanel('codex');

    const concepts = createCodexConcepts(state);
    const expectedIds = [
      'concept-coroid',
      'concept-mission',
      ...state.lanes.order.map((laneId) => `lane:${laneId}`),
      ...state.verification.order.map((gateId) => `gate:${gateId}`),
      ...state.quality.order.map((metricId) => `metric:${metricId}`),
      'concept-pass-rate',
      'concept-quality-score',
    ];
    for (const id of expectedIds) {
      expect(concepts.some((concept) => concept.id === id), `missing concept ${id}`).toBe(true);
    }

    const panel = surface.panels.panelElement('codex');
    const entries = [...panel.querySelectorAll<HTMLElement>('[data-hud="codex-entry"]')];
    expect(entries).toHaveLength(concepts.length);
    expect(entries.map((entry) => entry.dataset.conceptId)).toEqual(concepts.map((concept) => concept.id));
    expect(panel.textContent).toContain('HOLO-FACTORY');
    expect(panel.textContent).toContain('Build lane');
    expect(panel.textContent).toContain('Hologram fidelity');

    const chips = [...panel.querySelectorAll<HTMLElement>('[data-hud="codex-provenance"]')];
    expect(chips).toHaveLength(concepts.length);
    for (const chip of chips) {
      expect(Object.values(PROVENANCE_LABELS)).toContain(chip.textContent);
    }

    // Entries are focusable so the codex can be read without a mouse.
    surface.panels.handleKey(press(panel, 'ArrowDown'));
    expect(document.activeElement).toBe(entries[0]);
    surface.panels.handleKey(press(panel, 'End'));
    expect(document.activeElement).toBe(entries[entries.length - 1]);
  });

  it('lets callers extend the codex and replaces entries by id', () => {
    const state = previewSnapshot();
    const extended = createCodexConcepts(state, [
      {
        id: 'concept-coroid',
        term: 'Coroid (preview)',
        definition: 'Overridden for the preview page.',
        category: 'mission',
        provenance: 'architect_choice',
      },
      {
        id: 'concept-extra',
        term: 'Extra',
        definition: 'Added by the caller.',
        category: 'mission',
        provenance: 'repository_observation',
      },
    ]);
    expect(extended.find((concept) => concept.id === 'concept-coroid')?.term).toBe('Coroid (preview)');
    expect(extended.some((concept) => concept.id === 'concept-extra')).toBe(true);
    expect(new Set(extended.map((concept) => concept.id)).size).toBe(extended.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Focus trap, immutability, teardown                                         */
/* -------------------------------------------------------------------------- */

describe('focus trap', () => {
  it('cycles focus and restores the element that opened it', () => {
    const host = createHost();
    const first = document.createElement('button');
    const second = document.createElement('button');
    const opener = document.createElement('button');
    host.append(first, second, opener);
    const trap = createFocusTrap(host, document);

    opener.focus();
    trap.activate();
    expect(trap.active).toBe(true);
    expect(trap.restoreTarget).toBe(opener);

    trap.moveFocus(1);
    expect(document.activeElement).toBe(first);
    trap.moveFocus(1);
    expect(document.activeElement).toBe(second);
    trap.moveFocus(1);
    expect(document.activeElement).toBe(opener);
    trap.moveFocus(1);
    expect(document.activeElement).toBe(first); // wraps forward
    trap.moveFocus(-1);
    expect(document.activeElement).toBe(opener); // wraps backward

    first.focus();
    trap.deactivate();
    expect(trap.active).toBe(false);
    expect(document.activeElement).toBe(opener);
  });
});

describe('interface immutability', () => {
  it('never mutates the snapshot it renders', () => {
    const surface = createSurface({ contracts: INSPECTOR_CONTRACTS });
    const state = previewSnapshot();
    const before = JSON.stringify(state);

    surface.overlay.update(state);
    surface.panels.update(state);
    surface.panels.openPanel('inspector');
    surface.panels.openPanel('report');
    surface.panels.openPanel('codex');
    surface.overlay.pushEvent(makeDomainEvent('mission/status', { status: 'delivering' }, 90_100));

    expect(Object.isFrozen(state)).toBe(true);
    expect(JSON.stringify(state)).toBe(before);
    expect(readBudget(state).spent).toBe(JSON.parse(before).economy.contextSpent);
  });

  it('disposes every element it created', () => {
    const surface = createSurface({ contracts: INSPECTOR_CONTRACTS });
    surface.panels.update(previewSnapshot());
    surface.panels.openPanel('inspector');
    expect(surface.host.querySelectorAll('.hud-panel')).toHaveLength(4);

    surface.panels.dispose();
    surface.overlay.dispose();
    expect(surface.host.querySelectorAll('.hud-panel')).toHaveLength(0);
    expect(surface.host.querySelector('[data-hud="overlay"]')).toBeNull();
    expect(surface.host.querySelector('[data-hud="event-log"]')).toBeNull();
    expect(surface.host.querySelector('.hud-panel-layer')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Stylesheet contract                                                        */
/* -------------------------------------------------------------------------- */

const CSS = readFileSync('src/styles/hud.css', 'utf8');

function cssToken(name: string): string {
  const match = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8})`));
  if (!match?.[1]) throw new Error(`token --${name} not found in src/styles/hud.css`);
  return match[1];
}

function relativeLuminance(hex: string): number {
  const digits = hex.replace('#', '');
  const value = Number.parseInt(digits.length === 3 ? digits.replace(/(.)/g, '$1$1') : digits, 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  const [r, g, b] = channels.map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const light = Math.max(a, b);
  const dark = Math.min(a, b);
  return (light + 0.05) / (dark + 0.05);
}

describe('hud.css', () => {
  it('keeps every text colour at 4.5:1 or better against the panel background', () => {
    const panel = cssToken('hud-panel-solid');
    const textTokens = [
      'hud-ink',
      'hud-muted',
      'hud-cyan',
      'hud-amber',
      'hud-magenta',
      'hud-ok',
      'hud-alarm',
    ];
    for (const token of textTokens) {
      const ratio = contrastRatio(cssToken(token), panel);
      expect(ratio, `--${token} contrast ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('sets counters in tabular monospaced digits and honours contrast preferences', () => {
    const block = CSS.match(/\.hud-num\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(block).toContain('var(--coroid-font-mono)');
    expect(block).toContain('font-variant-numeric: tabular-nums');
    expect(CSS).toContain('@media (prefers-contrast: more)');
    expect(CSS).toContain('@media (forced-colors: active)');
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

/* -------------------------------------------------------------------------- */
/* Dev-preview page                                                           */
/* -------------------------------------------------------------------------- */

function runDirector(state: GameState, steps: number, stepMs = 60): DomainEvent[] {
  const channel = createDomainEventChannel();
  const collected: DomainEvent[] = [];
  channel.on((event) => collected.push(event));
  const director = createMissionDirector();
  const context = { events: channel, rng: createRng(7) } as unknown as SystemContext;
  let current = state;
  for (let step = 1; step <= steps; step += 1) {
    const update = {
      context,
      state: createSnapshot(current),
      step,
      deltaMs: stepMs,
      elapsedMs: step * stepMs,
    } as unknown as SystemUpdate;
    director.update(update);
    current = applyDomainEvents(current, channel.drain());
  }
  return collected;
}

describe('dev-preview mission director', () => {
  it('emits deterministic domain events on the simulated clock', () => {
    const first = runDirector(createSampleState(), 200);
    const second = runDirector(createSampleState(), 200);

    expect(first.length).toBeGreaterThan(10);
    expect(second.map((event) => `${event.type}@${event.at}`)).toEqual(
      first.map((event) => `${event.type}@${event.at}`),
    );

    const kinds = new Set(first.map(provenanceForEvent));
    expect([...kinds].sort()).toEqual([
      'architect_choice',
      'repository_observation',
      'user_requirement',
    ]);
    expect(first.some((event) => event.type === 'economy/spend')).toBe(true);
    expect(first.some((event) => event.type === 'plan/task-updated')).toBe(true);
  });
});

describe('dev-preview page', () => {
  it('mounts the interface over the live mission and keeps it keyboard operable', () => {
    const host = createHost('hud-preview');
    const status = document.createElement('p');
    status.id = 'hud-preview-status';
    const briefing = document.createElement('button');
    briefing.id = 'hud-preview-briefing';
    host.append(status, briefing);

    const preview = bootHudPreview({ host, adapter: 'headless', autoStart: false });
    expect(preview).not.toBeNull();
    if (!preview) return;
    disposers.push(() => preview.dispose());

    // The overlay, banner, terminal and panel layer are all mounted.
    expect(host.querySelector('[data-hud="overlay"]')).not.toBeNull();
    expect(host.querySelector('[data-hud="banner"]')).not.toBeNull();
    expect(host.querySelector('[data-hud="event-log"]')).not.toBeNull();
    expect(host.querySelector('.hud-panel-layer')).not.toBeNull();
    expect(preview.hud.log.empty).toBe(true);

    const before = readBudget(preview.harness.game.state).spent;
    preview.harness.game.advance(4_000);
    preview.sync();

    // Mission events stream into the terminal with provenance chips.
    expect(preview.hud.log.entries.length).toBeGreaterThan(0);
    const lines = preview.hud.queryAll('log-line');
    expect(lines.length).toBe(preview.hud.log.entries.length);
    for (const line of lines) {
      expect(line.querySelector('[data-hud="log-provenance"]')?.textContent).toBeTruthy();
    }
    // The context burn is visible in the overlay.
    expect(readBudget(preview.harness.game.state).spent).toBeGreaterThan(before);

    // Hotkeys open and close the panels, and the live region announces it.
    press(window, 'o');
    expect(preview.panels.open).toBe('outline');
    expect(preview.panels.panelElement('outline').hidden).toBe(false);
    expect(preview.hud.liveRegion.textContent).toBe('Plan outline opened');

    press(window, 'Escape');
    expect(preview.panels.open).toBeNull();
    expect(preview.hud.liveRegion.textContent).toBe('Plan outline closed');

    // The objective banner announces a briefing change through the live region,
    // from the hotkey and from the page's own (tabbable) control.
    const missionObjective = preview.harness.game.state.mission.objective;
    press(window, 'b');
    expect(preview.hud.query('objective')?.textContent).toBe(PREVIEW_BRIEFINGS[0]);
    expect(preview.hud.liveRegion.textContent).toBe(`Objective updated: ${PREVIEW_BRIEFINGS[0]}`);
    expect(preview.hud.query('objective')?.textContent).not.toBe(missionObjective);
    briefing.click();
    expect(preview.hud.liveRegion.textContent).toBe(`Objective updated: ${PREVIEW_BRIEFINGS[1]}`);
    expect(preview.nextBriefing()).toBe(PREVIEW_BRIEFINGS[2]);
    expect(preview.describe().join('\n')).toContain('briefing   3/4');

    // Long enough for invariants to settle and the status loop to move.
    preview.harness.game.advance(40_000);
    preview.sync();
    expect(preview.hud.query('invariants')?.textContent).toMatch(/^[1-5]\/5$/);
    const announced = preview.hud.queryAll('live').map((node) => node.textContent ?? '');
    expect(announced.join(' ').length).toBeGreaterThan(0);
    expect(preview.describe().join('\n')).toContain('coroid interface preview');
  });

  it('disposes the whole preview cleanly', () => {
    const host = createHost('hud-preview-2');
    const preview = bootHudPreview({ host, adapter: 'headless', autoStart: false, keyboard: false });
    expect(preview).not.toBeNull();
    if (!preview) return;
    preview.harness.game.advance(2_000);
    preview.sync();
    preview.dispose();
    expect(host.querySelector('[data-hud="overlay"]')).toBeNull();
    expect(host.querySelector('canvas')).toBeNull();
  });
});
