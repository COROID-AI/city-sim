/**
 * System registry — the composition seam of the game.
 *
 * `src/game/Game.ts` is closed for modification: it attaches whatever this
 * registry contains, in array order, and drives it through the fixed-step loop.
 * Composing the game therefore means editing this file (or pushing into the
 * registry before `createGame` runs) and nothing else.
 *
 * A system:
 *  - `attach(context)` — runs once, receives the scene root, camera, adapter,
 *    event channel, deterministic RNG, clock and step duration. Create objects,
 *    add them to `context.scene`, subscribe to events here.
 *  - `update(update)` — runs once per fixed simulation step with the frozen
 *    state snapshot. Emit domain events instead of mutating state directly.
 *  - `dispose()` — runs exactly once on teardown; release geometries,
 *    materials, GPU resources and listeners here.
 *
 * ── What the shipped registry composes ──────────────────────────────────────
 * `createSystems()` instantiates every phase-2 and phase-3 module and returns
 * them in attachment order:
 *
 *   camera-rig → world → plan graph → lane agents → quality graph →
 *   HUD → panels → audio bus → mission flow → input router
 *
 *  - the camera rig attaches before the world because the world's post chain
 *    places its screen pass on the camera pose the rig has just damped (both
 *    `render/camera.ts` and `render/scene.ts` document that order);
 *  - the three simulation-driven views (plan graph, lane comets, quality
 *    constellation) read the frozen runtime snapshot every step;
 *  - the HUD and the panel layer mount into one interface host (`#boot`, then
 *    `document.body`) and share one live execution-contract record;
 *  - the mission flow owns mission one, plays it, and mirrors its domain events
 *    into the runtime channel — the single stream the world, the views, the HUD
 *    event log and the audio bus observe;
 *  - the input router attaches last, so it binds to the canvas, the mounted
 *    interface, the camera rig, the plan graph and the audio bus that all exist
 *    by then.
 *
 * Nothing here re-implements module behaviour. Each entry either delegates to a
 * module's own `GameSystem` factory or is a thin adapter that instantiates one
 * module and routes its contracts: frozen snapshots in, domain events and
 * player intents out.
 */

import '../styles/hud.css';

import type { Object3D, PerspectiveCamera } from 'three';

import {
  createMissionFlow,
  type FlowSpeed,
  type FlowTaskRow,
  type MissionFlow,
  type MissionFlowOptions,
  type MissionOutcome,
  type MissionPhase,
} from './flow';
import { createDomainEventChannel, type DomainEventChannel } from './events';
import { createInputRouter, DEFAULT_TIME_SPEED, type InputIntent, type InputRouter } from './input';
import type { Clock, Rng } from './loop';
import { MISSIONS, missionInitialStateOptions, type MissionKey } from '../content/missions';
import { createInitialState, type DeepReadonly, type GameState } from '../sim/state';
import { createAudioBus, type AudioBus } from '../audio/audio';
import { createHudOverlay, type HudIntent, type HudOverlayHandle, type HudPanelAction } from '../ui/hud';
import {
  createPanelHost,
  type PanelHost,
  type TaskCheckView,
  type TaskContractMap,
  type TaskContractView,
  type TaskCriterionView,
} from '../ui/panels';
import {
  createCameraRigSystem,
  type CameraRigSystem,
  type CameraStateName,
} from '../render/camera';
import type { PostQualityPreset } from '../render/effects';
import { createPlanGraphSystem, type PlanGraphSystem, type PlanGraphView } from '../render/nodes';
import { createLaneAgentsSystem } from '../render/laneAgents';
import { createQualityGraphSystem } from '../render/qualityGraph';
import { createWorldSystem, type WorldSystem } from '../render/scene';
import type { RenderAdapter } from '../render/renderer';

/** Everything an attached system may touch while it lives. */
export interface SystemContext {
  /** Scene graph root; systems add their own subtree under it. */
  readonly scene: Object3D;
  /** Active camera, for systems that place billboards or labels. */
  readonly camera: PerspectiveCamera;
  /** The adapter the runtime draws through (webgl or headless). */
  readonly adapter: RenderAdapter;
  /** Emit domain events here; the runtime reduces them at step boundaries. */
  readonly events: DomainEventChannel;
  /** Seeded, deterministic random stream shared by the run. */
  readonly rng: Rng;
  /** Time source driving the loop. */
  readonly clock: Clock;
  /** Seed this run was started with. */
  readonly seed: number;
  /** Fixed simulation step duration in milliseconds. */
  readonly stepMs: number;
}

/** Per-step payload handed to `update()`. */
export interface SystemUpdate {
  /** Same context object the system received in `attach()`. */
  readonly context: SystemContext;
  /** Frozen, read-only view of the state as of this step. */
  readonly state: DeepReadonly<GameState>;
  /** 1-based fixed-step index. */
  readonly step: number;
  /** Fixed step duration in milliseconds. */
  readonly deltaMs: number;
  /** Simulated time elapsed after this step, in milliseconds. */
  readonly elapsedMs: number;
}

/** A composable unit of game behaviour. */
export interface GameSystem {
  /** Stable identity, unique within a run. Used for ordering and diagnostics. */
  readonly id: string;
  /** Called once when the runtime starts. */
  attach(context: SystemContext): void;
  /** Called once per fixed simulation step, in registry order. */
  update(update: SystemUpdate): void;
  /** Called exactly once when the runtime is disposed. */
  dispose(): void;
}

/* -------------------------------------------------------------------------- */
/* Composition contracts                                                      */
/* -------------------------------------------------------------------------- */

/** The plan graph exposed as a re-composable binding over the module factory. */
export interface PlanGraphBinding extends GameSystem {
  readonly id: 'render/plan-graph';
  /** The module system, available after `attach`. */
  readonly system: PlanGraphSystem | null;
  /** Instanced task/phase view the input router picks through. */
  readonly view: PlanGraphView | null;
}

/** The always-on interface layer. */
export interface HudSystem extends GameSystem {
  readonly id: 'ui/hud';
  /** The overlay, available after `attach` in a DOM host. */
  readonly overlay: HudOverlayHandle | null;
}

/** The modal panel layer (inspector, outline, report, codex). */
export interface PanelsSystem extends GameSystem {
  readonly id: 'ui/panels';
  /** The panel host, available after `attach` in a DOM host. */
  readonly host: PanelHost | null;
}

/** The synthesized ambience/SFX bus. */
export interface AudioSystem extends GameSystem {
  readonly id: 'audio/bus';
  /** The bus, available after `attach`. */
  readonly bus: AudioBus | null;
}

/**
 * The mission runner.
 *
 * It owns one `MissionFlow` and is the only writer of the runtime state: the
 * flow's domain events are mirrored into the runtime channel, so the runtime
 * snapshot the views and the HUD render from *is* the mission's own history.
 */
export interface MissionSystem extends GameSystem {
  readonly id: 'mission/flow';
  /** The live flow, available after `attach`. */
  readonly flow: MissionFlow | null;
  /** Mission phase, or `null` before attach. */
  readonly phase: MissionPhase | null;
  /** `running` until the mission wins or loses. */
  readonly outcome: MissionOutcome | null;
  /** Plan rows in plan order, as the interface shows them. */
  taskRows(): readonly FlowTaskRow[];
  /** Lane a task runs on, for the input router's dispatch intent. */
  laneOf(taskId: string): string | null;
  /** Execution contracts keyed by task id, shared with the panel layer. */
  contracts(): TaskContractMap;
  /** Player intents, mapped onto the flow's own lifecycle calls. */
  start(): boolean;
  approve(): boolean;
  dispatch(taskId: string | null): boolean;
  setSpeed(speed: FlowSpeed): void;
  setPaused(paused: boolean): void;
}

/** The single source of player intents. */
export interface InputSystem extends GameSystem {
  readonly id: 'input/router';
  /** The router, available after `attach` in a DOM host. */
  readonly router: InputRouter | null;
}

/** The composed game, in attachment order. */
export interface GameSystems {
  readonly cameraRig: CameraRigSystem;
  readonly world: WorldSystem;
  readonly planGraph: PlanGraphBinding;
  readonly laneAgents: GameSystem;
  readonly qualityGraph: GameSystem;
  readonly hud: HudSystem;
  readonly panels: PanelsSystem;
  readonly audio: AudioSystem;
  readonly mission: MissionSystem;
  readonly input: InputSystem;
  /** Every system in attachment order; what `createGame` attaches. */
  readonly list: readonly GameSystem[];
}

/** Everything a host may configure. Every field has a mission-derived default. */
export interface GameSystemsOptions {
  /** Mission to compose. Defaults to the first mission of the campaign. */
  readonly missionKey?: MissionKey;
  /** Missions already delivered before this one, for unlock gating. */
  readonly deliveredMissionKeys?: readonly string[];
  /**
   * Acknowledge the brief on the first step. Defaults to `true`: the game loads
   * directly into a live factory floor rather than waiting on a splash.
   */
  readonly autoStart?: boolean;
  /**
   * Approve the plan as soon as it is registered. Defaults to `true`, so the
   * floor starts playing on load; pass `false` for the human-gated mission arc
   * where the player approves (`approve` / `dispatch` intents).
   */
  readonly autoApprove?: boolean;
  /** Starting playback speed. Defaults to the flow's own default. */
  readonly speed?: FlowSpeed;
  /** Start with the mission clock paused. Defaults to `false`. */
  readonly paused?: boolean;
  /** Agent failure/rollback tuning, forwarded to the flow. */
  readonly agent?: MissionFlowOptions['agent'];
  /** Post-processing tier for the world. Defaults to the module's `high`. */
  readonly quality?: PostQualityPreset;
  /** Gesture surface. Defaults to the adapter canvas, then `document.body`. */
  readonly canvas?: HTMLElement | null;
  /** Mount point for the HUD and panel layers. Defaults to `#boot`, then body. */
  readonly interfaceHost?: HTMLElement | null;
  /** Start the audio bus muted. Defaults to `false`. */
  readonly muted?: boolean;
  /** Suppress motion-like audio layers. Defaults to the host preference. */
  readonly reducedMotion?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** First mission of the campaign: what a fresh process starts playing. */
const DEFAULT_MISSION_KEY: MissionKey = MISSIONS[0]?.key ?? 'request-to-plan';

/** Camera presentation that belongs with each mission phase. */
const CAMERA_STATE_BY_PHASE: Readonly<Record<MissionPhase, CameraStateName>> = Object.freeze({
  brief: 'brief',
  plan: 'plan',
  approve: 'plan',
  dispatch: 'execute',
  verify: 'verify',
  repair: 'repair',
  release: 'release',
});

/** Host preference for motion-like presentation. */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  const matchMedia = (window as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  if (typeof matchMedia !== 'function') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Mount point for the interface layers: the app shell when it exists. */
function resolveInterfaceHost(explicit?: HTMLElement | null): HTMLElement | null {
  if (explicit) return explicit;
  if (typeof document === 'undefined') return null;
  const shell = document.getElementById('boot');
  return shell ?? document.body ?? null;
}

/**
 * A channel the mission flow can drain into its own state while every event is
 * still mirrored into the presentation channel.
 *
 * `createMissionFlow` drains whatever channel it is handed (`flush()` reduces
 * the queue into the flow's own state). Handing it the runtime channel would
 * therefore let the flow consume events the runtime has not reduced yet, and
 * the floor would freeze. This bridge keeps a private queue for the flow and
 * forwards each emission to the runtime channel, so both observers see the same
 * mission history in the same order.
 */
function createMirroredChannel(forward: DomainEventChannel): DomainEventChannel {
  const queue = createDomainEventChannel();
  return {
    emit(event): void {
      queue.emit(event);
      forward.emit(event);
    },
    on(listener) {
      return queue.on(listener);
    },
    get pending(): number {
      return queue.pending;
    },
    drain() {
      return queue.drain();
    },
    clear(): void {
      queue.clear();
    },
  };
}

/** Initial state for a mission, for hosts that boot the runtime on it. */
export function createMissionInitialState(
  missionKey: MissionKey = DEFAULT_MISSION_KEY,
): GameState {
  return createInitialState(missionInitialStateOptions(missionKey));
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Instantiate the whole game as an ordered system list.
 *
 * The returned bundle is a plain value: every system is created but nothing is
 * built until `attach` runs, so `createSystems()` is safe to call at module
 * scope, in a test, or several times in one process (each call composes fresh
 * systems over its own module instances).
 *
 * ── Runtime state and the live mission ──────────────────────────────────────
 * The registry composes modules; it does not choose the state a host boots
 * `createGame` with. The mission system mirrors every event the flow emits into
 * the runtime channel, so whatever the host started with advances with the live
 * mission: a host that wants the runtime document to *be* mission one boots it
 * with `createMissionInitialState(missionKey)` (the integration test does), and
 * a host that boots the sample fixture — the dev harness in the browser — gets
 * that demo factory floor plus everything the mission does to it.
 */
export function createSystems(options: GameSystemsOptions = {}): GameSystems {
  const interfaceHost = resolveInterfaceHost(options.interfaceHost);

  /**
   * Execution contracts the inspector renders, keyed by task id.
   *
   * The panel layer reads this record lazily whenever the inspector renders and
   * the mission system rewrites it whenever the ledger moves, so a panel opened
   * before the plan existed still fills in as the mission registers tasks.
   */
  const contracts: Record<string, TaskContractView> = {};

  /**
   * HUD → panel requests. The HUD is registered first (so it is on screen
   * behind the modal layer), so its buttons reach the panel layer through this
   * handle, installed when that system attaches.
   */
  const panelRequests: { request(panel: HudPanelAction): void } = {
    request: () => undefined,
  };

  /* ------------------------------------------------------------- world side */

  const cameraRig = createCameraRigSystem({
    state: 'brief',
    // The input router is the only gesture surface: two live ones would
    // double-apply every drag (documented in `game/input.ts`).
    controls: false,
  });

  const world = createWorldSystem({ preset: options.quality });

  const planGraph = createPlanGraphBinding();

  const laneAgents = createLaneAgentsSystem();

  const qualityGraph = createQualityGraphSystem();

  /* ------------------------------------------------------------ interface */

  const hud = createHudSystem({
    host: interfaceHost,
    onIntent: (intent: HudIntent) => panelRequests.request(intent.panel),
  });

  const panels = createPanelsSystem({
    host: interfaceHost,
    contracts,
    announce: (message) => hud.overlay?.announce(message),
    install: (request) => {
      panelRequests.request = request;
    },
  });

  const audio = createAudioSystem({
    muted: options.muted,
    reducedMotion: options.reducedMotion ?? prefersReducedMotion(),
  });

  /* --------------------------------------------------------------- mission */

  const mission = createMissionSystem({
    missionKey: options.missionKey,
    deliveredMissionKeys: options.deliveredMissionKeys,
    autoStart: options.autoStart,
    autoApprove: options.autoApprove,
    speed: options.speed,
    paused: options.paused,
    agent: options.agent,
    contracts,
    onPhaseChange: (phase) => {
      // The mission drives the cinematic: every phase change reframes the floor.
      cameraRig.setState(CAMERA_STATE_BY_PHASE[phase]);
      hud.overlay?.announce(`Mission phase → ${phase}`);
    },
  });

  /* ----------------------------------------------------------------- input */

  const input = createInputSystem({
    canvas: options.canvas,
    cameraRig,
    planGraph,
    panels,
    hud,
    audio,
    mission,
  });

  const list: readonly GameSystem[] = [
    cameraRig,
    world,
    planGraph,
    laneAgents,
    qualityGraph,
    hud,
    panels,
    audio,
    mission,
    input,
  ];

  return { cameraRig, world, planGraph, laneAgents, qualityGraph, hud, panels, audio, mission, input, list };
}

/**
 * Bind the plan graph module to the runtime.
 *
 * The module builds its instanced pool eagerly (picking has to work before the
 * first frame), so the binding defers construction to `attach`: the shipped
 * registry can then compose more than one game in a process without handing a
 * disposed pool to the second run.
 */
function createPlanGraphBinding(): PlanGraphBinding {
  let system: PlanGraphSystem | null = null;

  return {
    id: 'render/plan-graph',
    get system() {
      return system;
    },
    get view() {
      return system?.view ?? null;
    },
    attach(context: SystemContext): void {
      system = createPlanGraphSystem({ id: 'render/plan-graph' });
      system.attach(context);
    },
    update(update: SystemUpdate): void {
      system?.update(update);
    },
    dispose(): void {
      system?.dispose();
      system = null;
    },
  };
}

/** Compose the always-on interface layer as a game system. */
function createHudSystem(options: {
  host: HTMLElement | null;
  onIntent(intent: HudIntent): void;
}): HudSystem {
  let overlay: HudOverlayHandle | null = null;
  let unsubscribe: (() => void) | null = null;

  return {
    id: 'ui/hud',
    get overlay() {
      return overlay;
    },
    attach(context: SystemContext): void {
      if (typeof document === 'undefined') return;
      overlay = createHudOverlay({
        ...(options.host ? { host: options.host } : {}),
        onIntent: options.onIntent,
      });
      // Every domain event the runtime reduces also lands in the terminal.
      unsubscribe = context.events.on((event) => overlay?.pushEvent(event));
    },
    update(update: SystemUpdate): void {
      overlay?.update(update.state);
    },
    dispose(): void {
      unsubscribe?.();
      unsubscribe = null;
      overlay?.dispose();
      overlay = null;
    },
  };
}

/**
 * Compose the modal panel layer as a game system.
 *
 * The panel host owns the focus trap and the dialogs; this adapter only mounts
 * it, hands it the execution contracts, keeps the keyboard trapped while a
 * panel is open, and refreshes it from the same snapshot the HUD renders. The
 * router mirrors whatever the host decides on its own (Escape, the backdrop,
 * a HUD button), so the two never fight over which panel is up.
 */
function createPanelsSystem(options: {
  host: HTMLElement | null;
  contracts: TaskContractMap;
  announce(message: string): void;
  install(request: (panel: HudPanelAction) => void): void;
}): PanelsSystem {
  let host: PanelHost | null = null;
  let onKeyDown: ((event: KeyboardEvent) => void) | null = null;

  return {
    id: 'ui/panels',
    get host() {
      return host;
    },
    attach(): void {
      if (typeof document === 'undefined') return;
      host = createPanelHost({
        ...(options.host ? { host: options.host } : {}),
        contracts: options.contracts,
        announce: options.announce,
      });
      // The HUD opens panels through the host once it exists.
      const panelHost = host;
      options.install((panel) => panelHost.togglePanel(panel));

      // A modal panel owns Escape and Tab wherever focus sits; the input router
      // suppresses its own hotkeys for as long as `keyGuard` reports one open.
      onKeyDown = (event: KeyboardEvent): void => {
        host?.handleKey(event);
      };
      document.addEventListener('keydown', onKeyDown);
    },
    update(update: SystemUpdate): void {
      host?.update(update.state);
    },
    dispose(): void {
      if (onKeyDown && typeof document !== 'undefined') {
        document.removeEventListener('keydown', onKeyDown);
      }
      onKeyDown = null;
      host?.dispose();
      host = null;
    },
  };
}

/** Compose the audio bus as a game system, wired to the runtime's event stream. */
function createAudioSystem(options: {
  muted?: boolean;
  reducedMotion: boolean;
}): AudioSystem {
  let bus: AudioBus | null = null;
  let disconnect: (() => void) | null = null;

  return {
    id: 'audio/bus',
    get bus() {
      return bus;
    },
    attach(context: SystemContext): void {
      bus = createAudioBus({
        muted: options.muted ?? false,
        reducedMotion: options.reducedMotion,
      });
      // Ambience and event SFX follow the domain events, not the render loop.
      disconnect = bus.connect(context.events);
    },
    update(): void {
      // Audio is event-driven; nothing to advance per step.
    },
    dispose(): void {
      disconnect?.();
      disconnect = null;
      bus?.dispose();
      bus = null;
    },
  };
}

/**
 * Compose the mission flow as a game system.
 *
 * One fixed step advances the mission by one fixed step, so the mission clock
 * is the runtime's clock. The flow's events are mirrored into the runtime
 * channel, which is what makes the runtime snapshot — and therefore the world,
 * the views, the HUD and the event log — show the live mission.
 */
function createMissionSystem(options: {
  missionKey?: MissionKey;
  deliveredMissionKeys?: readonly string[];
  autoStart?: boolean;
  autoApprove?: boolean;
  speed?: FlowSpeed;
  paused?: boolean;
  agent?: MissionFlowOptions['agent'];
  contracts: Record<string, TaskContractView>;
  onPhaseChange(phase: MissionPhase): void;
}): MissionSystem {
  let flow: MissionFlow | null = null;
  let bridge: DomainEventChannel | null = null;
  let lastPhase: MissionPhase | null = null;
  let contractSignature = '';

  /** Rebuild the inspector's contracts whenever the mission's ledger moves. */
  function syncContracts(): void {
    if (!flow) return;
    const rows = flow.taskRows();
    const signature = `${flow.events().length}:${rows.length}`;
    if (signature === contractSignature) return;
    contractSignature = signature;

    const ledger = flow.ledger();
    for (const key of Object.keys(options.contracts)) delete options.contracts[key];
    for (const row of rows) {
      const checks: TaskCheckView[] = row.checkIds.flatMap((checkId) => {
        const check = ledger.checks[checkId];
        if (!check) return [];
        const outcome = ledger.outcomes[checkId];
        return [
          {
            id: check.id,
            kind: check.kind,
            assertion: check.assertion,
            targetFile: check.targetFile,
            evidence: check.evidence,
            status: outcome?.status ?? 'pending',
          },
        ];
      });
      const criteria: TaskCriterionView[] = row.criterionKeys.flatMap((key) => {
        const criterion = ledger.criteria[key];
        if (!criterion) return [];
        return [
          {
            key: criterion.key,
            label: criterion.label,
            lifecycle: criterion.lifecycle,
            requiredEvidence: criterion.requiredEvidence,
            satisfiedByCheckIds: criterion.satisfiedByCheckIds,
          },
        ];
      });
      options.contracts[row.id] = {
        readSet: row.readSet,
        writeSet: row.writeSet,
        checks,
        criteria,
      };
    }
  }

  return {
    id: 'mission/flow',
    get flow() {
      return flow;
    },
    get phase() {
      return flow?.phase ?? null;
    },
    get outcome() {
      return flow?.outcome ?? null;
    },
    taskRows(): readonly FlowTaskRow[] {
      return flow?.taskRows() ?? [];
    },
    laneOf(taskId: string): string | null {
      return flow?.taskRows().find((row) => row.id === taskId)?.laneId ?? null;
    },
    contracts(): TaskContractMap {
      return options.contracts;
    },
    start(): boolean {
      if (!flow || flow.phase !== 'brief') return false;
      return flow.start() !== null;
    },
    approve(): boolean {
      if (!flow) return false;
      if (flow.phase === 'brief') return flow.start() !== null;
      if (flow.phase === 'approve') return flow.approve() !== null;
      // The plan is already open: the gesture acknowledges the tutorial step
      // the mission is waiting on instead of being swallowed.
      return flow.acknowledge();
    },
    /**
     * Player dispatch.
     *
     * The flow's scheduler owns placing ready tasks on open lanes, so the
     * player's dispatch gesture moves the mission forward: start the brief,
     * approve the human gate, then acknowledge the tutorial step.
     */
    dispatch(): boolean {
      if (!flow) return false;
      if (flow.phase === 'brief') return flow.start() !== null;
      if (flow.phase === 'approve') return flow.approve() !== null;
      return flow.acknowledge();
    },
    setSpeed(speed: FlowSpeed): void {
      flow?.setSpeed(speed);
    },
    setPaused(paused: boolean): void {
      if (!flow) return;
      if (paused) flow.pause();
      else flow.resume();
    },
    attach(context: SystemContext): void {
      bridge = createMirroredChannel(context.events);
      flow = createMissionFlow({
        mission: options.missionKey ?? DEFAULT_MISSION_KEY,
        ...(options.deliveredMissionKeys
          ? { deliveredMissionKeys: options.deliveredMissionKeys }
          : {}),
        channel: bridge,
        stepMs: context.stepMs,
        speed: options.speed,
        paused: options.paused,
        autoStart: options.autoStart ?? true,
        autoApprove: options.autoApprove ?? true,
        ...(options.agent ? { agent: options.agent } : {}),
      });
      syncContracts();
    },
    update(update: SystemUpdate): void {
      if (!flow) return;
      flow.advance(update.deltaMs);
      syncContracts();

      const phase = flow.phase;
      if (phase !== lastPhase) {
        lastPhase = phase;
        options.onPhaseChange(phase);
      }
    },
    dispose(): void {
      // The flow owns no listeners outside its own channel; dropping the bridge
      // keeps a stray emission from reaching the runtime after teardown.
      bridge?.clear();
      bridge = null;
      flow = null;
      lastPhase = null;
      contractSignature = '';
      for (const key of Object.keys(options.contracts)) delete options.contracts[key];
    },
  };
}

/**
 * Compose the input router as a game system.
 *
 * The router attaches last and is the only listener on the page: it drives the
 * camera rig, the plan graph selection and the audio bus directly, and raises
 * every other decision as an intent this adapter maps onto the mission flow and
 * the panel layer.
 */
function createInputSystem(deps: {
  canvas?: HTMLElement | null;
  cameraRig: CameraRigSystem;
  planGraph: PlanGraphBinding;
  panels: PanelsSystem;
  hud: HudSystem;
  audio: AudioSystem;
  mission: MissionSystem;
}): InputSystem {
  let router: InputRouter | null = null;

  /** Keep the router's absolute time controls in step with the mission clock. */
  function syncTime(): void {
    router?.syncTime({
      speed: deps.mission.flow?.speed ?? DEFAULT_TIME_SPEED,
      paused: deps.mission.flow?.paused ?? false,
    });
  }

  /** Turn one player intent into module calls. The router applies gestures. */
  function handleIntent(intent: InputIntent): void {
    switch (intent.type) {
      case 'dispatch':
        deps.mission.dispatch(intent.taskId);
        break;
      case 'approve':
        deps.mission.approve();
        break;
      case 'speed':
        deps.mission.setSpeed(intent.speed);
        syncTime();
        break;
      case 'pause':
        deps.mission.setPaused(intent.paused);
        syncTime();
        break;
      case 'panel':
        if (intent.open) deps.panels.host?.openPanel(intent.panel);
        else deps.panels.host?.closePanel();
        syncPanel();
        break;
      case 'pick':
      case 'select':
        // Picking results land in the inspector: its subject and its contract.
        deps.panels.host?.selectTask(intent.taskId);
        break;
      case 'camera-focus':
        // `F` frames the plan graph: a cinematic transition, not a nudge.
        deps.cameraRig.setState('plan');
        break;
      case 'audio-unlock':
        deps.hud.overlay?.announce('Audio online — factory ambience unlocked');
        break;
      case 'camera-orbit':
      case 'camera-pan':
      case 'camera-zoom':
      case 'camera-nudge':
        // Applied on the rig by the router itself; observed here for tooling.
        break;
    }
  }

  /** Mirror the panel layer's state so the router's toggles stay absolute. */
  function syncPanel(): void {
    router?.syncPanel(deps.panels.host?.open ?? null);
  }

  return {
    id: 'input/router',
    get router() {
      return router;
    },
    attach(context: SystemContext): void {
      const canvas =
        deps.canvas ??
        context.adapter.canvas ??
        (typeof document === 'undefined' ? null : document.body);
      if (!canvas) return;

      router = createInputRouter({
        canvas,
        ...(deps.hud.overlay?.root ? { interfaceHost: deps.hud.overlay.root } : {}),
        camera: deps.cameraRig.rig,
        graph: deps.planGraph.view,
        audio: deps.audio.bus,
        taskOrder: () => deps.planGraph.view?.nodes.map((node) => node.id) ?? [],
        laneOf: (taskId) => deps.mission.laneOf(taskId),
        keyGuard: () => Boolean(deps.panels.host?.open),
        time: {
          speed: deps.mission.flow?.speed ?? DEFAULT_TIME_SPEED,
          paused: deps.mission.flow?.paused ?? false,
        },
        onIntent: handleIntent,
      });
    },
    update(): void {
      // Reconcile the router with whatever the panel layer did on its own
      // (Escape, the backdrop button, a HUD button).
      syncPanel();
    },
    dispose(): void {
      router?.dispose();
      router = null;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

/** The shipped composition, created once per process. */
export const gameSystems: GameSystems = createSystems();

/**
 * Ordered registry of systems composed into the game.
 *
 * `createGame` attaches exactly this array unless a caller passes its own
 * `systems` option, which is what makes development previews and focused tests
 * possible without touching the shipped composition.
 */
export const systems: GameSystem[] = [...gameSystems.list];

/** Read-only view of the live registry. */
export function getRegisteredSystems(): readonly GameSystem[] {
  return systems;
}

/** Append a system to the registry and return it, for fluent composition. */
export function registerSystem(system: GameSystem): GameSystem {
  systems.push(system);
  return system;
}

/** Remove a system from the registry. Returns whether it was present. */
export function unregisterSystem(system: GameSystem): boolean {
  const index = systems.indexOf(system);
  if (index < 0) return false;
  systems.splice(index, 1);
  return true;
}
