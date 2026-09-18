# Coroid acceptance evidence

End-to-end acceptance for the composed game: a scripted headless playthrough from
the mission brief to a shipped release manifest, the browser scenario matrix for
every screen state (including the mission's seeded failing check and its repair),
keyboard-only and reduced-motion passes, adaptive quality-tier verification,
contrast checks and screenshot evidence.

**Ownership.** This document and `tests/acceptance-headless.test.ts` are the whole
deliverable. Both are **read-only over the product**: they import the shipped
composition (`src/game/systems.ts`), the frozen runtime (`src/game/Game.ts`), the
mission flow, the HUD's `data-hud` hooks, the fidelity governor and the perf
badge, and they never modify a game, render, UI, audio, content or registry file.
A defect found here is reported as a failed criterion in
[Known gaps](#known-gaps), never patched in place.

---

## 1. How to run

| Step | Command | What it proves |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | The acceptance suite and the shipped game compile. |
| Headless acceptance | `npx vitest run tests/acceptance-headless.test.ts` | The nine scripted scenarios in §3: playthrough, deterministic replay, six-mission campaign, seeded failure and repair, keyboard-only, reduced motion, `aria-live`, quality-tier stress, palette/motion contract. |
| Serve the game | `npm run dev -- --port 4173 --strictPort` | The composed game is served at `http://localhost:4173/` for the browser matrix in §5. |
| Guided lifecycle | load `http://localhost:4173/?guided=1` (or click *Guided replay*) | The human-gated arc plus the inspection rig of §5: each lifecycle phase can be held, stepped and captured deterministically. |
| Inspection rig (headless) | `npx vitest run tests/inspection.test.ts` | The rig's own suite: the fidelity self-test, the phase holds and the one-step control, the motion preference and its teardown. |
| Browser matrix | executed by the browser verification provider against the served origin | Screenshots, keyboard-only and reduced-motion passes, stress toggle, contrast capture (§5). |

The browser half is *not* a Vitest file: the toolchain has no Vitest browser
runner, so the scenario matrix in §5 is executed by the browser provider against
the dev server, driving only the stable `data-hud` hooks, the documented hotkeys
and the canvas (`canvas[data-coroid-canvas]`).

`npx vitest run tests/acceptance-headless.test.ts` takes ≈12 s and passes with no
warnings on the shipped composition (9 tests).

---

## 2. Fixed seeds

Every scripted run uses a fixed seed. The seeds are **read from the mission
catalogue** (`getMission(key).pacing.seed`), never invented, so any run is
reproducible from the shipped content alone. The suite asserts the seed it booted
with, and this table is the same list.

| Scenario | Mission | Seed | Runtime |
| --- | --- | --- | --- |
| `playthrough` | `request-to-plan` | `20260919` | 60 Hz fixed step (`1000/60` ms), manual clock |
| `replay` (×2) | `request-to-plan` | `20260919` | 60 Hz fixed step, manual clock |
| `repair` (seeded failure) | `request-to-plan` | `20260919` | 60 Hz fixed step, manual clock |
| `keyboard` | `request-to-plan` | `20260919` | 60 Hz fixed step, manual clock, speed 4 |
| `reducedMotion` | `request-to-plan` | `20260919` | 60 Hz fixed step, host prefers reduced motion |
| `qualityStress` | `request-to-plan` | `20260919` | 60 Hz fixed step, modelled frame cost (§4) |
| `campaign:request-to-plan` | `request-to-plan` | `20260919` | 60 Hz fixed step, manual clock |
| `campaign:parallel-lanes` | `parallel-lanes` | `20260920` | 60 Hz fixed step, manual clock |
| `campaign:verification-gates` | `verification-gates` | `20260921` | 60 Hz fixed step, manual clock |
| `campaign:quality-graph` | `quality-graph` | `20260922` | 60 Hz fixed step, manual clock |
| `campaign:context-budget` | `context-budget` | `20260923` | 60 Hz fixed step, manual clock |
| `campaign:delivery-manifest` | `delivery-manifest` | `20260924` | 60 Hz fixed step, manual clock |

The quality-tier scenario has no dice of its own: its inputs are the measured
frame times the scenario feeds the governor (§4). The browser scenarios in §5
inherit the seed of the mission they play (mission one, `20260919`, at the
shipped defaults).

---

## 3. Headless acceptance scenarios

`tests/acceptance-headless.test.ts`, all over the composed runtime
(`createSystems` + `createGame` + `createHeadlessAdapter` + a manual clock).

1. **Scripted playthrough — brief to shipped release manifest.**
   Boots mission one with `autoStart: false`, `autoApprove: false` and drives the
   documented lifecycle: `brief` (nothing dispatched, mission clock at 0) →
   `plan` (`flow.start()`, every task declaring read/write sets, checks and
   criteria) → `approve` → `dispatch` (agents active, `lane/assigned` emitted) →
   `verify` → `repair` → `release`. Asserts every one of the seven phases is
   reached, every transition is legal per `PHASE_TRANSITIONS` and carries events
   and a provenance tag, the manifest shipped with `coverageRatio === 1` and
   `provenanceRatio === 1` and every entry carrying green checks, that **every
   final invariant is green** (`readiness.unmetKeys` empty, `ready`, quality
   `invariantsAtRisk === 0`), and that the release surfaces agree
   (`mission-status=delivered`, `100% shipped`, `aria-valuenow=100`, report panel
   with `100%` pass rate and only `passed` gate chips). No `console.error` fires.
2. **Deterministic replay.** The same script (auto-start arc, fixed frame budget)
   is run twice and compared: identical event journal, identical transition list,
   identical final state, identical manifest and identical terminal lines.
3. **Six-mission campaign.** For each mission, in order and with the previously
   delivered keys handed over: the mission is unlocked, its plan registers, at
   least one lane is assigned work, it wins, its final invariants hold and its
   manifest ships. A later mission offered **without** its predecessor delivered
   is locked, refuses to start and stays in `brief` with an empty plan.
4. **Seeded failing check and repair.** Mission one, driven through the hotkeys:
   the mission's *own* seeded failure (the agent runtime's 5 % failure chance,
   seeded from `20260919`) raises a red gate. While it is open the suite asserts:
   the runtime state shows failed gates, the terminal carries
   `Gate … → failed · 0% coverage` (`data-source="verification/run"`) and
   `Task "Repair "…" after it …" registered on …` (`data-source="plan/task-registered"`),
   the live region announces `Mission phase → repair`, a repair objective is open,
   a fix-up task runs, a lane chip reports `data-busy="true"`, the inspector shows
   the failed `[data-hud="check-status"][data-status="failed"]` chip, and the
   report shows the failed gate card. Afterwards: no open repair objectives,
   `failures-repaired ≥ 1`, readiness recovered, manifest shipped, every report
   gate chip `passed`.
5. **Keyboard-only mission one.** Speed (`4`), pause/resume (Space), approve (`a`),
   focus (`router.stepFocus` / `.`), dispatch (`d`), panel open (`v`) and close
   (Escape) are the only inputs after boot; the mission reaches `release` with the
   manifest shipped and no pointer events at all. While paused the mission clock
   does not move and no plan work is registered.
6. **Reduced motion.** With the host's media query answering
   `prefers-reduced-motion: reduce`, 120 frames leave the camera rig's pose
   bit-identical (the idle drift is off) while the audio bus and the fidelity
   governor both report `reducedMotion === true`; the control run without the
   preference moves the pose. (The shipped motion layers are the camera rig's idle
   drift, the audio bus's motion voices — filter sweeps and glissandi — and the CSS
   animations; there is no camera shake in the shipped game.)
7. **`aria-live` announcements.** The single live region
   (`[data-hud="live"]`, `role="status"`, `aria-live="polite"`, `aria-atomic="true"`)
   announces `Mission phase → dispatch|repair|verify|release`, `Invariant settled:
   N of M hold` and, at the release, the objective/status change
   (`Objective updated: …` / `Mission delivered`).
8. **Adaptive quality under stress.** From `calm`, clicking the badge's
   `[data-hud="stress-toggle"]` engages the shipped stress rig; the governor
   abandons the runaway configuration on its own, ending on the rescue tier with
   the tier's own budget holding (median ≤ target, p95 ≤ ceiling). The badge
   follows: `[data-hud="perf-tier"]`, `[data-hud="perf-badge"][data-tier]`,
   `[data-hud="stress-toggle"][data-stress="on"]`, `[data-hud="perf-mode"]` =
   `AUTO`.
9. **Palette and motion contract.** `src/styles/hud.css` still declares the
   contrast-checked HUD palette (each colour next to the ratio it was measured
   against) and the reduced-motion block; `src/styles/base.css` still disables the
   splash transition under reduced motion.

### 4. Frame-cost model used by the stress scenario

The governor measures the *clock*, so the stress scenario advances the manual
clock by a modelled frame cost — the same monotone model the fidelity hardening
suite uses:

```
frameMs = stepMs + load · pixelRatio² · (post ? 1 : 0.4) · (shadows ? 1.3 : 1) · (1 + instances/4096)
```

with `load = 20 ms`, `stepMs = 16.7 ms`. The closed loop is the point: the frame
after a downgrade really is cheaper, so the tier's budget is what brings the run
back inside it.

---

## 5. Browser scenario matrix

Served game: `http://localhost:4173/` (`npm run dev -- --port 4173 --strictPort`).
Mission one auto-starts and auto-approves on the first fixed step, so **the whole
mission plays in ≈1.4 s of wall clock at speed 1** (86 fixed steps at 60 Hz), and
several phases last a single fixed step. Two routes reach the lifecycle screens:

* **Guided route — deterministic, used by B1–B6 and B11.** Load `/?guided=1`, or
  click `[data-hud="guided-link"]` (*Guided replay*) on the shipped page. The
  mission is then composed with `autoStart`/`autoApprove` off, so it waits on the
  brief, and the inspection rig (`[data-hud="inspection"]`, pinned bottom-right)
  holds it at every phase:
  * `[data-hud="lifecycle-phase"]` — the held phase as text (`Phase repair`) and
    as `data-phase`, plus `[data-hud="lifecycle-state"]` (`Run state paused`);
  * `[data-hud="inspection-next-phase"]` (*Next phase*) — acknowledge the brief,
    run to the next phase change and pause there;
  * `[data-hud="inspection-approve"]` (*Approve plan*) — clear the human gate;
  * `[data-hud="inspection-step"]` (*Step one step*) — advance exactly one fixed
    simulation step and pause again, which is what makes a one-step phase (the
    seeded repair windows at steps 28/38/59) capturable;
  * `[data-hud="inspection-play"]` (*Play mission*) — release every hold and run
    the shipped arc to the release, holding there.
* **Auto route — used by B7–B10.** The shipped default page plays the arc itself:
  poll `[data-hud="live"]` at ≤ 50 ms (it holds the *last* announcement, so each
  `Mission phase → …` line persists until the next phase change), and press Space
  to pause as soon as the state you want is on screen (`1`/`2`/`4` select the
  playback speed).

`[data-hud]` is the only interface contract used. No DOM internals, class names or
layout assumptions. The rig's controls are real buttons in the accessibility tree
(labelled *Next phase*, *Step one step*, *Play mission*, *Approve plan*, *Hold
phases*, *Reduce motion*, *Run budget check*), so they can be driven by role and
name; while a modal panel is open its backdrop owns the pointer, so close the
panel (Escape) before driving the rig.

| # | Scenario | Seed | Steps (hooks and keys only) | Expected observation | Evidence |
| --- | --- | --- | --- | --- | --- |
| B1 | **Brief** | 20260919 | Load `/?guided=1` (or click `[data-hud="guided-link"]`). No further input: the mission waits on the brief. | `[data-hud="lifecycle-phase"]` = `Phase brief` (`data-phase="brief"`); `[data-hud="mission-status"]` = `bootstrapping`; `[data-hud="objective"]` = the mission objective sentence; `[data-hud="mission-progress-label"]` = `0% shipped`; no `[data-hud="lane"]` chip with `data-busy="true"`. | `01-brief.png`, `01-brief-canvas.png` |
| B2 | **Plan** | 20260919 | Click `[data-hud="inspection-next-phase"]` (*Next phase*): the request decomposes into the plan and the mission is held at the approval gate. Then click `[data-hud="action-outline"]` (or press `o`). | `[data-hud="lifecycle-phase"]` = `Phase approve` with the plan registered; `[data-hud="panel-outline"]` with `[data-hud="outline-phase"]` groups and one `[data-hud="outline-row"]` per task, each row carrying `data-task-id`; the camera frames the plan shot. | `02-plan.png` |
| B3 | **Execute** | 20260919 | Click `[data-hud="inspection-approve"]` (*Approve plan*). | `[data-hud="lifecycle-phase"]` = `Phase dispatch`, held paused; ≥1 `[data-hud="lane"]` chip with `data-busy="true"` and `data-kind` set; `[data-hud="lane-occupancy"]` `data-busy`/`data-total` populated; canvas shows the plan graph, lane comets and the holo floor. | `03-execute.png` |
| B4 | **Verify** | 20260919 | Click `[data-hud="inspection-next-phase"]` until `[data-hud="lifecycle-phase"]` = `Phase verify` (mission one passes through three repair waves first); click `[data-hud="action-report"]`. | `[data-hud="panel-report"]` with the pass-rate / quality-score / invariants / context / credits / reputation / clock / lanes facts and one `[data-hud="report-gate"]` card per gate — every chip `passed`. | `04-verify.png` |
| B5 | **Repair** (seeded failure) | 20260919 | Click `[data-hud="inspection-next-phase"]` until `[data-hud="lifecycle-phase"]` = `Phase repair` (first at step 28, ≈0.47 s of mission clock; further waves at 38 and 59). Use `[data-hud="inspection-step"]` to move inside the one-step window. | `[data-hud="event-log"]` contains `Gate … → failed · 0% coverage` (`data-source="verification/run"`, `data-provenance="repository_observation"`) and the fix-up registration on a lane (`data-source="plan/task-registered"`); `[data-hud="live"]` = `Verification alarm: N gates failing` and/or `Mission phase → repair`; a `[data-hud="lane"]` chip is busy; clicking `[data-hud="action-report"]` shows a `[data-hud="report-gate"]` card whose `[data-hud="gate-status"]` chip is `data-status="failed"`; the inspector shows a `[data-hud="check-status"][data-status="failed"]` chip. The canvas shows the magenta-red gate ring and the fix-up arc (§5 canvas encoding). | `05-repair-log.png`, `05-repair-report.png`, `05-repair-inspector.png`, `05-repair-canvas.png` |
| B6 | **Release** | 20260919 | Click `[data-hud="inspection-play"]` (*Play mission*) and wait for `[data-hud="mission-status"]` = `delivered` — the rig holds the release screen. Then click `[data-hud="action-report"]`. | `[data-hud="mission-progress-label"]` = `100% shipped`; `[data-hud="mission-progress"]` `aria-valuenow=100`; every `[data-hud="gate-status"]` = `passed`; `[data-hud="report-pass-rate"]` = `100%`; `[data-hud="report-invariants"]` = `NN/MM hold`; `[data-hud="report-quality-score"]` ≈ `0.91`; `[data-hud="metric-state"]` chips carry `data-lifecycle` (`final_invariant` / `milestone`); the terminal's `[data-hud="log-line"]`s carry `data-provenance`. | `06-release.png`, `06-release-report.png`, `06-release-log.png` |
| B7 | **Keyboard-only mission one** | 20260919 | Reload and use **no pointer input**: `4` (speed), Space (pause/resume), `a`, `a` (approve), `.` / `Enter` (focus/select), `d` (dispatch), `v` / `Escape` (report), `i` / `Escape` (inspector), arrow keys (camera). | Reaches the B6 release state; `[data-hud="live"]` has `aria-live="polite"`, `role="status"`, `aria-atomic="true"` and cycles `Mission phase → …`, `Invariant settled: N of M hold`, `Objective updated: …`, `Mission delivered`. | `07-keyboard-release.png`, `07-keyboard-live.png` |
| B8 | **Reduced motion** | 20260919 | From `/?guided=1` (or any run), click `[data-hud="reduced-motion-toggle"]` (*Reduce motion*); take two screenshots ≈1 s apart with no input; read `[data-hud="camera-pose"]`. | `[data-hud="motion-state"]` = `Motion reduced` with `data-reduced-motion="true"`; the toggle reads `aria-pressed="true"`; the `data-pose` value is identical between the two reads (the first two numbers are azimuth/polar, the drifted axes); `document.documentElement` carries `data-coroid-motion="reduced"`, which stops CSS animation (`src/styles/hud.css`'s reduced-motion block still covers the media-query case). Clicking it again restores `Motion full`. | `08-reduced-motion-a.png`, `08-reduced-motion-b.png`, `08-reduced-motion-report.png` |
| B9 | **Quality-tier stress** | n/a (measured) | Click `[data-hud="stress-toggle"]`; wait ~3 s; read the badge. | `aria-pressed="true"` and `data-stress="on"`; `[data-hud="perf-badge"][data-tier]` steps down the ladder (`boosted` → `calm` → `minimal` under the shipped stress rig) and `[data-hud="perf-tier"]` follows; `[data-hud="perf-budget"]` reads `OVER BUDGET` while the frame is over and `INSIDE BUDGET` once the cheaper tier holds; `[data-hud="perf-mode"]` = `AUTO`; `[data-hud="perf-median"]` / `[data-hud="perf-p95"]` end inside the displayed budget. | `09-stress-over.png`, `09-stress-downgraded.png`, `09-stress-badge.png` |
| B10 | **Contrast** | 20260919 | Capture computed text/background colours on the HUD, the report panel and the perf badge (release state). | The documented palette ratios hold: `--hud-ink #e8f7ff` 17.5:1, `--hud-muted #9fbdcd` 9.7:1, `--hud-cyan #35f0ff` 13.7:1, `--hud-amber #ffc15c` 11.9:1, `--hud-magenta #ff4fd8` 6.7:1, `--hud-ok #59ff9b` 14.8:1, `--hud-alarm #ff5c7a` 6.4:1 (`src/styles/hud.css`); body text ≥ 4.5:1, large text and panel borders ≥ 3:1. | `10-contrast-hud.png`, `10-contrast-report.png`, `10-contrast-perf.png` |
| B11 | **Frame budget under the mission load** | n/a (modelled) | Click `[data-hud="budget-check"]` (*Run budget check*) and read the readout. | `[data-hud="budget-check-verdict"]` = `Frame budget held` with `data-verdict="pass"`; `[data-hud="budget-check-tier"]` = `minimal` (the governor shed the calm tier under the load); `[data-hud="budget-check-median"]`'s `data-median-ms` ≤ its `data-budget-ms` and `[data-hud="budget-check-p95"]`'s `data-p95-ms` ≤ its `data-ceiling-ms` (the tier's own 2× ceiling). The numbers come from the shipped governor driven by the §4 cost model, so they are independent of the host's GPU: B9 still covers the *measured* ladder and the badge on real frames. | `11-budget-check.png` |

### Hooks used by the matrix

*Layout and status*: `root`, `overlay`, `banner`, `objective`, `mission-status`,
`mission-progress`, `mission-progress-fill`, `mission-progress-label`, `codename`,
`mission-id`, `readout-<key>`, `budget`, `budget-bar`, `invariants`, `credits`,
`reputation`, `clock`, `phase`, `lane-occupancy`, `lane` (`data-kind`,
`data-busy`, `data-lane-id`, `title`), `event-log`, `event-log-lines`, `log-count`,
`log-line` (`data-source`, `data-provenance`), `log-time`, `log-text`, `live`
(`data-message`, `aria-live`), `action-inspector`, `action-outline`,
`action-report`, `action-codex`.

*Panels*: `panel-layer`, `panel-inspector`, `panel-outline`, `panel-report`,
`panel-codex`, `close-panel`, `inspector-task-id`, `inspector-check`,
`check-status` (`data-status`), `check-kind`, `check-evidence`, `inspector-criterion`,
`criterion-lifecycle` (`data-lifecycle`), `report-gate` (`data-gate-id`),
`gate-name`, `gate-status`, `gate-lane`, `gate-coverage`, `report-facts`,
`report-pass-rate`, `report-quality-score`, `report-invariants`, `report-metric`
(`data-metric-id`), `metric-state` (`data-lifecycle`), `outline-phase`,
`outline-row` (`data-task-id`), `outline-progress`, `codex-entry`.

*Fidelity*: `perf-badge` (`data-tier`), `perf-fps`, `perf-tier`, `perf-median`,
`perf-p95`, `perf-budget` (`data-verdict`), `perf-mode` (`data-hold`),
`stress-toggle` (`data-stress`, `aria-pressed`).

*Inspection rig* (`src/game/inspection.ts`): `inspection`, `lifecycle-phase`
(`data-phase`), `lifecycle-state` (`data-paused`), `inspection-next-phase`,
`inspection-step`, `inspection-play`, `inspection-approve`, `inspection-hold`
(`data-hold`, `aria-pressed`), `guided-link`, `reduced-motion-toggle`
(`aria-pressed`), `motion-state` (`data-reduced-motion`), `camera-pose`
(`data-pose`), `budget-check`, `budget-check-verdict` (`data-verdict`),
`budget-check-tier` (`data-tier`), `budget-check-median` (`data-median-ms`,
`data-budget-ms`), `budget-check-p95` (`data-p95-ms`, `data-ceiling-ms`).

*Stage*: `canvas[data-coroid-canvas]`.

*Documented hotkeys* (`src/game/input.ts`): `1`/`2`/`4` speed, Space pause,
`a` approve, `d` dispatch, `Enter` activate, `,`/`[` and `.`/`]` cursor,
`i`/`o`/`v`/`c` panels, `Escape` close, `f` frame plan graph, `=`/`+`/`PageUp`
zoom in, `-`/`_`/`PageDown` zoom out, arrow keys nudge the camera.

### Canvas visual encoding (for the screenshot captures)

The canvas has no DOM hooks; its state is read from the same snapshot the HUD
renders. The scene objects and colours the captures depend on are shipped and
named:

* **verification gate rings** — `gate-ring-<checkId>` under `lane-agents-gates`,
  one segment per coverage step; a failed run turns the ring magenta-red
  (`GATE_RING_COLORS.failed = 0xff2d6f`, `src/render/laneAgents.ts`) and reveals
  the **repair arc** that accompanies a fix-up in flight (B5);
* **plan-graph task bodies** — `failed` renders as a *magenta-red hex prism with a
  halt bar* (`src/render/nodes.ts`), `running`/`verifying` breathe;
* **lane comets** — `comet-<laneId>-<index>` inside `lane-agents-comets`, one trail
  per active agent (B3);
* **quality constellation** — `criterion-<id>` under `quality-criteria`; live
  criteria turn and superseded history drifts (`src/render/qualityGraph.ts`);
* **world gate beacons** — one beacon per gate under `factory-gate-beacons`,
  coloured by `GATE_COLORS` (`0xff2d6f` when failed, `src/render/scene.ts`).

Each lifecycle phase also flies the camera to its own framing (`brief`, `plan`,
`execute`, `verify`, `repair`, `release` — `src/render/camera.ts`), which is what
makes the six captures visually distinct even where the HUD copy repeats.

---

## 6. Recorded baselines

Measured on the composed runtime with the manual clock at the 60 Hz fixed step,
`autoStart`/`autoApprove` enabled (the shipped browser arc), captured on the
revision this document ships with. The suite asserts the **invariants** (won,
shipped, invariants green, ≥1 lane dispatched, ≥1 seeded failure repaired, …) and
not these literals, so a balance change updates this table without breaking the
gate.

| Mission | Seed | Steps to win | Simulated time | Manifest entries | Seeded failures repaired | First red gate | First repair running | Lanes that carried work |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `request-to-plan` | 20260919 | 86 | 1 433 ms | 13 | 3 | step 28 | step 38 | 2 (`lane-discovery`, `lane-build`) |
| `parallel-lanes` | 20260920 | 98 | 1 633 ms | 14 | 4 | step 21 | step 23 | 3 |
| `verification-gates` | 20260921 | 79 | 1 317 ms | 19 | 3 | step 42 | step 44 | 4 |
| `quality-graph` | 20260922 | 100 | 1 667 ms | 18 | 2 | step 49 | step 51 | 3 |
| `context-budget` | 20260923 | 123 | 2 050 ms | 26 | 2 | step 56 | step 58 | 3 |
| `delivery-manifest` | 20260924 | 114 | 1 900 ms | 29 | 5 | step 51 | step 61 | 4 |

Mission one, in detail (same run, `autoStart`/`autoApprove` on):

* phase transitions: `brief>plan`, `plan>approve`, `approve>dispatch`,
  `dispatch>repair` ×3 (interleaved with `repair>dispatch`), `dispatch>verify`,
  `verify>release`;
* live-region announcements: `Mission phase → dispatch` (step 1), `→ repair`
  (28), `→ dispatch` (29), `→ repair` (38), `→ dispatch` (39), `→ repair` (59),
  `→ dispatch` (60), `→ verify` (84), `→ release` (86), then `Mission delivered`;
* release readings: `mission-status=delivered`, `100% shipped`, 26/26 gate chips
  `passed`, pass rate `100%`, quality score `0.91`, `20/22 hold` on the HUD's
  all-metric invariant counter (the two that do not hold are **milestone**
  criteria — the release verdict is decided by *final invariants*, of which
  `readiness.unmetKeys` is empty and `quality.invariantsAtRisk === 0`);
* journal: 428 domain events, replayed identically twice (§3.2), with the HUD's
  terminal holding its 64 most recent lines at the release;
* lane strip: 4 `[data-hud="lane"]` chips rendered, 2 of them busy at the peak of
  the execute phase;
* repair provenance: the replaced commitments
  (`request-to-plan-event-contract-criterion-1`,
  `request-to-plan-lane-registry-criterion-1`) settle as `superseded`, which the
  inspector renders as `[data-hud="criterion-lifecycle"][data-lifecycle="superseded"]`.

Quality tier under the modelled 20 ms load: `calm` → `boosted` (stress engaged,
the run re-arms at the device ceiling) → `calm` → `minimal`, with the minimal tier
holding its 33.3 ms median budget and 66.7 ms p95 ceiling for the rest of the run.

---

## 7. Known gaps

Reported, not patched (this task owns only the two acceptance files).

1. **`plan` is never a *resting* phase, on either route.** With the shipped
   defaults the first fixed step runs `flow.start()` (brief → plan → approve) and
   `flow.approve()` (approve → dispatch) inside one `advance()`; on the guided
   route `flow.start()` likewise lands on the approval gate in one call. The
   lifecycle readout (`[data-hud="lifecycle-phase"]`) makes every phase it *does*
   rest on observable — `brief` before the plan, then `approve`, `dispatch`,
   `verify`, `repair` and `release` — and `approve` frames the plan shot, but
   `plan` itself is always passed through inside a single call. The *Plan* screen
   is therefore captured from its own surface (the plan outline panel plus the
   plan camera framing, B2); the phase itself is proven headlessly (§3.1).
2. **No delivery-manifest surface.** The release manifest (`entries`,
   `coverageRatio`, `provenanceRatio`, per-entry evidence checks and criteria) is
   only reachable through the flow API. The browser's *Release* screen shows the
   manifest's **verdict** — `delivered`, `100% shipped`, every gate green, final
   invariants holding, criterion lifecycles (the report's metric chips and the
   inspector's `superseded` chips) and provenance-tagged terminal lines — but not a
   manifest list. Criterion 7 is therefore proven headlessly and *supported* rather
   than literally rendered in the browser.
3. **The `Verification alarm` announcement survives only on the guided route.** On
   the auto route the HUD writes `Verification alarm: N gates failing` into the
   live region on the step after a gate fails and the mission's own
   `Mission phase → repair` announcement overwrites it in the same step. Held at
   the repair phase (B5) the alarm text is the last announcement and is directly
   observable; the failing-gate evidence is otherwise the terminal's `→ failed`
   lines, the report's failed gate card and the inspector's failed check chip.
4. **No camera shake exists in the shipped game.** The reduced-motion pass
   verifies what the product actually animates: the camera rig's idle drift, the
   audio bus's motion voices (filter sweeps and glissandi) and the CSS animations
   (the rig's toggle sets `data-coroid-motion="reduced"`, and the stylesheet's
   media-query block still covers the host preference). The word "shake" in the
   acceptance criteria has no corresponding shipped surface, so criterion 5's
   reduced-motion clause is verified against those motion layers.
5. **Mission pacing is fast at the shipped defaults.** Mission one completes in
   ≈1.4 s of wall clock (86 fixed steps). On the auto route the matrix must poll
   `[data-hud="live"]` at ≤ 50 ms to catch the one-step repair window, and there is
   no shipped "slow" speed below 1×. The guided route removes the constraint: the
   rig holds each phase and `[data-hud="inspection-step"]` advances a single fixed
   step, so the repair window is caught whatever the host's frame rate.
