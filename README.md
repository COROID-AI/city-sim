# Coroid City Simulation — Agent Build Plan

## Goal

Build a standalone browser-based 2D city simulation that visually matches the attached reference image.

The result should be a polished public demo for Coroid’s autonomous “Dark Factory” capability: a living city with buildings, citizens, vehicles, day/night lighting, dashboard metrics, event log, minimap, and smooth real-time animation.

The attached image is the visual roadmap. The final app should aim to look similar in layout, color zoning, UI placement, lighting, and overall polish.

---

## Reference Image Requirements

Use the attached screenshot as the primary visual target.

Key visual traits to match:

- Top-down orthogonal 2D city view
- Grid-based road network
- Residential district in green tones
- Commercial district in blue tones
- Industrial district in brown tones
- Entertainment district in purple tones
- Central park / green area
- Small moving citizens as colored dots
- Small moving vehicles as colored rectangles
- Traffic lights at intersections
- Warm building window lights at dusk/night
- Soft street-light glow
- Dark translucent dashboard overlays
- Minimap bottom-left
- Time controls bottom-center
- Event log bottom-right
- Main dashboard top bar

The app does not need pixel-perfect accuracy, but it should clearly resemble the attached reference.

---

## Success Criteria

The build is successful when:

1. App runs locally with:

```bash
npm install
npm run dev

1. App builds statically with:

npm run build

1. Browser shows a full-screen city simulation.
2. Visual result matches the attached reference image with:
    * roads
    * buildings
    * districts
    * central park
    * citizens
    * vehicles
    * dashboard
    * minimap
    * event log
    * day/night lighting
3. Simulation runs smoothly at 60 FPS target.
4. At least:
    * 20 buildings
    * 50 citizens
    * 10 vehicles
    * 8 named companies
    * live city time
    * live economy/budget
    * event log with recent activity
5. Tests pass:

npm test
npm run type-check
npm run lint
npx playwright test

1. Visual verification screenshots are produced.

Tech Stack
Use:
* Next.js 15+ App Router
* TypeScript strict mode
* React
* TailwindCSS
* HTML5 Canvas 2D
* Jest
* React Testing Library
* Playwright
* Static export using Next.js output: 'export'
Do not use WebGL, Three.js, PixiJS, Phaser, or external game engines unless absolutely necessary.

Project Structure
Create:

coroid-city/
├── README.md
├── BENCHMARK.md
├── VISUAL_CHECKLIST.md
├── package.json
├── next.config.js
├── tsconfig.json
├── tailwind.config.ts
├── jest.config.js
├── playwright.config.ts
├── public/
│   └── assets/
│       └── reference/
│           └── attached-reference.png
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── layout.tsx
│   │   └── globals.css
│   ├── engine/
│   │   ├── GameEngine.ts
│   │   ├── GameLoop.ts
│   │   ├── World.ts
│   │   ├── Camera.ts
│   │   ├── Renderer.ts
│   │   ├── Pathfinder.ts
│   │   └── types.ts
│   ├── generation/
│   │   ├── CityGenerator.ts
│   │   ├── BuildingPlacer.ts
│   │   └── NameGenerator.ts
│   ├── entities/
│   │   ├── Building.ts
│   │   ├── Citizen.ts
│   │   ├── Vehicle.ts
│   │   └── Road.ts
│   ├── systems/
│   │   ├── TimeSystem.ts
│   │   ├── EconomySystem.ts
│   │   ├── CitizenSystem.ts
│   │   ├── TrafficSystem.ts
│   │   └── EventBus.ts
│   ├── ui/
│   │   ├── Dashboard.tsx
│   │   ├── CityLog.tsx
│   │   ├── TimeControls.tsx
│   │   ├── MiniMap.tsx
│   │   └── Tooltip.tsx
│   ├── config/
│   │   └── city-config.ts
│   └── __tests__/
│       ├── engine/
│       ├── systems/
│       └── visual/
└── tests/
    └── e2e/


Phase 1 — Scaffold
Goal
Create a working Next.js app with Canvas, Tailwind UI overlay, tests, linting, and static export.
Tasks
* Initialize Next.js app with TypeScript.
* Configure strict TypeScript.
* Configure TailwindCSS.
* Configure static export.
* Add Jest and React Testing Library.
* Add Playwright.
* Create full-screen canvas in page.tsx.
* Add placeholder top bar, minimap, controls, and event log.
* Implement basic GameLoop with fixed timestep update and render callback.
Verification
Run:

npm run dev
npm run build
npm test
npm run lint
npm run type-check

Visual check:
* Page loads.
* Canvas fills browser.
* UI overlay appears in same layout as reference image.

Phase 2 — City Layout Renderer
Goal
Render a static procedural city that resembles the attached image.
Tasks
* Create 80x80 tile world.
* Add grid-based road network.
* Add districts:
    * residential left / upper-left
    * commercial center
    * industrial right
    * entertainment lower center / lower right
    * park near center
* Render:
    * beige ground
    * dark roads
    * dashed road markings
    * sidewalks
    * buildings as stylized rectangles
    * building shadows
    * window rectangles
    * park area
* Add deterministic seed so the layout is stable between reloads.
Visual Requirements
The first meaningful screenshot should already resemble the attached image.
Expected colors:

Ground: warm beige
Roads: dark grey
Residential: green
Commercial: blue
Industrial: brown
Entertainment: purple
Park: green
Windows: warm yellow

Verification
Create screenshot:

artifacts/screenshots/phase-2-city-layout.png

Checklist:
* Roads visible
* District colors clear
* Buildings dense enough
* Park visible
* City fills the viewport
* Looks similar to reference image

Phase 3 — Camera
Goal
Allow the user to inspect the city.
Tasks
* Implement pan by dragging canvas.
* Implement zoom by mouse wheel.
* Clamp camera to world bounds.
* Add smooth camera interpolation.
* Make minimap viewport rectangle reflect camera position.
Verification
* Dragging pans the city.
* Wheel zooms in/out.
* User cannot pan into empty void.
* Minimap rectangle moves correctly.

Phase 4 — Time and Day/Night Lighting
Goal
Add visible time progression and lighting similar to the reference dusk/night view.
Tasks
* Implement TimeSystem.
* One sim-day = 5 real minutes at 1x.
* Add speeds:
    * pause
    * 1x
    * 2x
    * 5x
* Add lighting overlay:
    * day: clear
    * dusk: blue/purple overlay
    * night: dark overlay
    * dawn: subtle warm gradient
* Add window lights at dusk/night.
* Add street-light glow circles near roads.
* Update dashboard clock.
Verification
Create screenshots:

artifacts/screenshots/phase-4-day.png
artifacts/screenshots/phase-4-dusk.png
artifacts/screenshots/phase-4-night.png

Checklist:
* 5x speed visibly changes time.
* Dusk resembles attached image.
* Window lights glow.
* Street lights glow.
* Pause stops simulation time.

Phase 5 — Citizens
Goal
Add visible citizens moving around the city.
Tasks
* Spawn 50-100 citizens.
* Citizens have:
    * name
    * home
    * optional workplace
    * activity
    * position
    * target
* Activities:
    * sleeping
    * commuting
    * working
    * eating
    * visiting park
    * entertainment
    * wandering
* Citizens follow simple daily schedules.
* Render citizens as small colored dots:
    * worker: blue
    * visitor: green
    * unemployed/wandering: orange
* Add tooltip on hover with citizen name and activity.
Verification
Create screenshot:

artifacts/screenshots/phase-5-citizens.png

Checklist:
* Citizens visible as dots.
* Citizens move between buildings.
* Morning commute creates visible movement.
* Tooltip works.
* Citizens do not leave the city bounds.

Phase 6 — Vehicles and Traffic
Goal
Add simple vehicle simulation on roads.
Tasks
* Build road graph from grid.
* Implement A* pathfinding.
* Spawn at least 10 vehicles.
* Vehicles move only on roads.
* Render vehicles as small bright rectangles.
* Add traffic lights at major intersections.
* Vehicles stop at red lights.
* Emit traffic events when vehicle congestion occurs.
Simplification Allowed
If citizen-to-vehicle handoff becomes complex, keep vehicles independent from citizens. Visual quality is more important than perfect simulation realism.
Verification
Create screenshot:

artifacts/screenshots/phase-6-traffic.png

Checklist:
* Vehicles visible on roads.
* Vehicles do not drive through buildings.
* Traffic lights visible.
* Some vehicles stop at intersections.
* Event log can show traffic jam events.

Phase 7 — Economy and Companies
Goal
Add lightweight economy and dashboard data.
Tasks
* Create 8-12 named companies.
* Assign companies to commercial, industrial, and entertainment buildings.
* Assign jobs to around 70% of citizens.
* Track:
    * city budget
    * employment rate
    * company revenue
    * citizen money
* Update economy every sim-hour.
* Emit events:
    * citizen arrived at work
    * company opened
    * company closed
    * new day
    * traffic jam
Dashboard Requirements
Top bar must show:
* city name: Coroid City
* current time and day
* population
* employment rate
* city budget
* Built by Coroid badge
Bottom-right event log must show last 20 events.
Verification
Create screenshot:

artifacts/screenshots/phase-7-dashboard.png

Checklist:
* Dashboard resembles reference image.
* Numbers update over time.
* Event log fills with real events.
* Budget changes.
* Employment rate displays correctly.

Phase 8 — Visual Polish
Goal
Make the app feel like a polished public demo.
Tasks
* Add building shadows and subtle bevels.
* Add window light variation.
* Add small zZz indicators above sleeping homes at night.
* Add soft glow around street lights.
* Add subtle vehicle headlight glow at night.
* Improve minimap styling.
* Improve dashboard glassmorphism.
* Add hover labels.
* Optimize renderer with viewport culling.
* Add FPS and benchmark metrics.
Benchmark Object
Expose:

window.__CITY_BENCHMARK__ = {
  fps: number,
  entityCount: number,
  citizenCount: number,
  vehicleCount: number,
  buildingCount: number,
  eventCount: number,
  memoryEstimateMb: number
}

Update it every 10 seconds.
Verification
Create final screenshot:

artifacts/screenshots/final-reference-match.png

Final visual score target: >= 80 / 100.

Phase 9 — Testing
Unit Tests
Add tests for:
* GameLoop fixed timestep
* TimeSystem speed and day rollover
* CityGenerator creates roads/buildings
* Camera zoom/pan clamp
* Pathfinder path correctness
* EconomySystem revenue/tax
* EventBus publish/subscribe
* Citizen schedule transition
Integration Tests
Add tests for:
* App mounts canvas
* Engine boots without crash
* Simulation can run one full sim-day
* Population remains stable
* Economy changes over time
* Events are produced
Playwright E2E
Create test:

tests/e2e/city-smoke.spec.ts

It should:
* Visit /
* Wait for canvas
* Click 5x speed
* Wait 30 seconds
* Assert event log has entries
* Assert no console errors
* Assert window.__CITY_BENCHMARK__.fps > 30
Visual Snapshot Tests
Use Playwright to capture screenshots:

artifacts/screenshots/e2e-initial.png
artifacts/screenshots/e2e-after-30s.png

Do not require pixel-perfect comparison, but store screenshots as build artifacts.

Phase 10 — Documentation and Delivery
Tasks
Create README.md with:
* project purpose
* screenshot
* setup
* dev command
* build command
* architecture overview
* testing instructions
* benchmark instructions
Create BENCHMARK.md with:

AI profile:
Build time:
Tokens:
Cost:
Test pass rate:
Coverage:
FPS:
Visual score:
Notes:

Create VISUAL_CHECKLIST.md with:

Road grid: 10
Residential district: 10
Commercial district: 10
Industrial district: 10
Entertainment district: 10
Central park: 10
Citizens visible: 10
Vehicles visible: 10
Day/night lighting: 10
Dashboard resembles reference: 10

Total: /100

Final Verification Commands
Run:

npm install
npm run type-check
npm run lint
npm test -- --coverage
npm run build
npx playwright test
npm run dev

Manual browser verification:
* Open app
* Compare with attached reference image
* Pan and zoom
* Switch speeds
* Let run at 5x for 5 minutes
* Confirm no console errors
* Check window.__CITY_BENCHMARK__
* Capture final screenshot

Important Implementation Guidance
Prioritize visual resemblance over deep simulation complexity.
This is a public proof/demo, not a full game.
If time is limited, prefer:
1. Beautiful city layout
2. Smooth animation
3. Clear dashboard
4. Day/night lighting
5. Moving dots and vehicles
6. Event log activity
Over:
1. Perfect need simulation
2. Complex traffic realism
3. Advanced economy
4. Full pathfinding edge cases
The attached reference image is the north star.