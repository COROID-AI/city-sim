/**
 * index.js — 2025 contemporary café era module.
 *
 * Assembles the full present-day café:
 *   a sleek multi-boiler espresso machine with a touchscreen + pressure/flow
 *   readouts, a pour-over station (gooseneck kettle, V60s, scales), a batch
 *   brewer into insulated carafes, an iPad-as-register POS with a contactless
 *   tap-to-pay reader, tablet order screens, oat/almond milk cartons, a pastry
 *   case with minimal labels, a minimal sans-serif menu board with 2025 prices
 *   (flat white $4.50–$5.50, oat milk +50¢), QR-code table-ordering stickers,
 *   local-roaster posters + art prints + a community notice shelf + a chalk
 *   A-board + a subtle brand decal, a smartphone on a wireless charging stand
 *   paired with a small smart speaker (the era's music source), a long communal
 *   oak slab table + round marble-effect tables, designer stools + bentwood
 *   chairs, double-wall glass / speckled stoneware cups, keep-cups, matte black
 *   cutlery, LED pendants, abundant plants (monstera, hanging pothos), a
 *   living-wall shelving unit with ceramics, and five patrons in 2025 fashion.
 */
import * as THREE from '../../../public/js/three/lib/three.module.js';
import { C } from './util.js';
import {
  espressoMachine,
  pourOverStation,
  batchBrewer,
  ipadPOS,
  tabletScreen,
  milkCarton,
  pastryCase,
} from './counter.js';
import { menuBoard } from './menu.js';
import { communalTable, roundTable } from './tables.js';
import {
  roasterPoster,
  artPrint,
  noticeShelf,
  chalkBoard,
  brandDecal,
  shelvingUnit,
  monstera,
  pothos,
  WALL_BACK,
  WALL_LEFT,
  WALL_RIGHT,
} from './wallArt.js';
import { globePendant, linearPendant, wallGlow } from './lights.js';
import { phoneOnCharger, smartSpeaker } from './music.js';
import { buildPeople } from './people.js';

export const era2025 = {
  id: 'year-2025',
  label: '2025',
  year: 2025,
  hudText: 'Contemporary Café',
  assets: [],
  metadata: {
    tint: '#4fc3f7',
    caption: { name: 'Contemporary Café', vibe: 'Oat-milk flat whites, QR orders, and contactless taps' },
    inspectables: [
      { id: 'machine', name: 'Multi-boiler Espresso Machine', object: 'espresso-machine', story: 'Multi-boiler machine — 2025: touchscreen pressure and flow readouts' },
      { id: 'pos', name: 'iPad POS & Reader', object: 'ipad-pos', story: 'Tap-to-pay reader — 2025: contactless in under a second' },
      { id: 'speaker', name: 'Smart Speaker', object: 'smart-speaker', story: 'Smart speaker — 2025: the playlist streams from the cloud' },
      { id: 'brewer', name: 'Batch Brewer', object: 'batch-brewer', story: 'Batch brewer — 2025: a carafe keeps pour-over-adjacent coffee flowing' },
      { id: 'menu', name: 'Minimal Menu Board', object: 'menu-board', story: 'Menu board — 2025: a flat white $4.50, oat milk +50¢' },
    ],
    presets: [
      { id: 'counter', name: 'Counter & Machine', position: [-3.1, 1.4, 2.2], target: [-2.9, 1.1, 0.6] },
      { id: 'menu', name: 'Menu Board', position: [-0.3, 1.6, 2.2], target: [-1.0, 1.3, -2.0] },
      { id: 'music', name: 'Smart Speaker', position: [-3.2, 1.3, 2.1], target: [-3.3, 1.1, -0.8] },
      { id: 'seating', name: 'Seating Area', position: [0.8, 1.5, 2.2], target: [0.2, 0.9, 0.2] },
      { id: 'posters', name: 'Posters & Plants', position: [1.0, 1.6, 2.2], target: [0.6, 1.2, -2.0] },
    ],
    overview: { position: [3.1, 1.9, 2.3], target: [0, 1.05, -0.3] },
  },
  build(ctx) {
    const group = new THREE.Group();
    group.name = 'era-2025';

    // ------------------------------------------------------------------
    // Countertop equipment (counter worktop at y ≈ 0.90 / x -3.4..-2.5).
    // ------------------------------------------------------------------
    const machine = espressoMachine();
    machine.name = 'espresso-machine';
    machine.position.set(-2.85, 0.905, 0.75);
    machine.rotation.y = Math.PI / 2; // touchscreen faces the room (+x)
    group.add(machine);

    const pour = pourOverStation();
    pour.name = 'pour-over-station';
    pour.position.set(-3.0, 0.905, -0.65);
    pour.rotation.y = Math.PI / 2;
    group.add(pour);

    const brewer = batchBrewer();
    brewer.name = 'batch-brewer';
    brewer.position.set(-3.0, 0.905, 0.05);
    brewer.rotation.y = Math.PI / 2;
    group.add(brewer);

    const pos = ipadPOS();
    pos.name = 'ipad-pos';
    pos.position.set(-2.82, 0.905, 1.55);
    pos.rotation.y = Math.PI / 2;
    group.add(pos);

    // Tablet order screens.
    const tab1 = tabletScreen();
    tab1.name = 'tablet-screen-1';
    tab1.position.set(-3.25, 0.905, -1.2);
    tab1.rotation.y = Math.PI / 2;
    group.add(tab1);

    const tab2 = tabletScreen();
    tab2.name = 'tablet-screen-2';
    tab2.position.set(-3.25, 0.905, 1.1);
    tab2.rotation.y = Math.PI / 2;
    group.add(tab2);

    // Oat / almond milk cartons near the pour-over station.
    const oat = milkCarton(C.oatMilk, 'OAT');
    oat.position.set(-3.35, 0.905, -0.95);
    oat.rotation.y = Math.PI / 2;
    group.add(oat);
    const almond = milkCarton(C.almondMilk, 'ALMOND');
    almond.position.set(-3.35, 0.905, -1.1);
    almond.rotation.y = Math.PI / 2;
    group.add(almond);

    // Pastry case on the counter.
    const pastry = pastryCase();
    pastry.name = 'pastry-case';
    pastry.position.set(-2.6, 0.905, -0.2);
    pastry.rotation.y = Math.PI / 2;
    group.add(pastry);

    // ------------------------------------------------------------------
    // Tables.
    // ------------------------------------------------------------------
    communalTable(group, 0.0, 0.5, 0.0); // long communal slab, centre
    roundTable(group, 2.35, -1.05); // by the right wall
    roundTable(group, 1.5, 1.5); // by the front window

    // ------------------------------------------------------------------
    // Menu board + QR stickers (QR stickers also dropped on tables).
    // ------------------------------------------------------------------
    menuBoard(group, 'back', -1.45, 1.85, -2.46).name = 'menu-board';

    // ------------------------------------------------------------------
    // Wall décor.
    // ------------------------------------------------------------------
    roasterPoster(group, WALL_RIGHT, 3.46, 1.6, -1.4);
    artPrint(group, WALL_LEFT, -3.46, 1.7, 1.4);
    artPrint(group, WALL_RIGHT, 3.46, 1.7, 0.4);

    const notice = new THREE.Group();
    notice.name = 'community-notice-shelf';
    noticeShelf(notice, WALL_LEFT, -3.46, 1.35, -1.4);
    group.add(notice);

    // Brand decal on the back wall above the counter.
    brandDecal(group, WALL_BACK, -1.45, 2.35, -2.46);

    // Chalk A-board outside the door (front-right).
    chalkBoard(group, 2.85, 0, 2.3, 0.3);

    // ------------------------------------------------------------------
    // Living-wall shelving unit with plants + ceramics.
    // ------------------------------------------------------------------
    const unit = new THREE.Group();
    unit.name = 'living-wall-shelf';
    shelvingUnit(unit, 3.2, 0, 1.6, -0.2);
    group.add(unit);

    // Abundant plants: monstera near the window, hanging pothos.
    monstera(group, 1.9, 0, 1.9, 1.0);
    pothos(group, 2.6, 1.4, 1.2, 1.0); // hanging from above

    // ------------------------------------------------------------------
    // Lighting — hanging globe + linear LED pendants.
    // ------------------------------------------------------------------
    globePendant(group, 0.0, 2.6, 0.5);
    linearPendant(group, -2.2, 2.6, -1.3, 1.2);
    linearPendant(group, 2.2, 2.6, 1.4, 1.2);
    wallGlow(group, -1.45, 2.3, -2.3, 0xfff0dc, 1.2, 5);

    // ------------------------------------------------------------------
    // Music source — smartphone on a wireless charging stand + smart
    // speaker on the staff-side garnish shelf (the era's sound source).
    // ------------------------------------------------------------------
    const phone = phoneOnCharger(group, -3.36, 1.08, -0.4, Math.PI / 2);
    phone.name = 'smartphone-charger';
    const speaker = smartSpeaker(group, -3.36, 1.08, -0.85, Math.PI / 2);
    speaker.name = 'smart-speaker';

    // ------------------------------------------------------------------
    // Patrons.
    // ------------------------------------------------------------------
    group.add(buildPeople());

    return group;
  },
  enter(ctx) {},
  exit() {},
};