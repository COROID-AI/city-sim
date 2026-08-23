/* SOLAR SMASH — bootstrap, game state machine, input, main loop.
 *
 * Finding wiring:
 *  - perf (bloom/particles): every frame feeds the QualityManager; its tier
 *    drives renderer DPR, bloom passes, star/cloud budgets, particle budget.
 *  - decals: DecalPainter.flush() is called ONCE per frame and uploads only
 *    when something actually hit the planet (throttled internally).
 *  - WebAudio autoplay: AudioEngine.unlock() is invoked exclusively from user
 *    gesture handlers (pointerdown / keydown / start button).
 */

import * as THREE from 'three';
import {
  PLANET_RADIUS as R, POPULATION_START, WEAPONS,
  STAGE_MESSAGES, GO_FLAVOR
} from './config.js';
import { QualityManager } from './quality.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { OrbitCam, makeStars } from './camera.js';
import { DecalPainter } from './decals.js';
import { Planet } from './planet.js';
import { Effects } from './effects.js';
import { PostFX } from './postfx.js';
import { Weapons } from './weapons.js';

/* tuning */
const DAMAGE_MAX = 108;        // integrity units the planet can absorb
const KILL_PER_POWER = 1.32e8; // lives lost per unit of weapon power
const FRAG_COUNT_ROCK = 64;
const FRAG_COUNT_EMBER = 26;

function boot() {
  /* ---------- DOM ---------- */
  const ui = new UI({
    onStart: () => startGame(),
    onRebuild: () => rebuild(),
    onSelect: (i) => weapons.select(i),
    onQuality: () => ui.qualityLabel(qm.cycle()),
    onMute: () => toggleMute(),
    onHelp: () => openHelp(),
    onHelpClose: () => closeHelp()
  });

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas: ui.canvas, antialias: true, powerPreference: 'high-performance'
    });
    if (!renderer.capabilities.isWebGL2) throw new Error('WebGL2 required');
  } catch (err) {
    console.error(err);
    ui.fatal('This game needs WebGL 2. Try another browser or enable hardware acceleration.');
    return;
  }

  renderer.outputColorSpace = THREE.SRGBColorSpace;

  /* ---------- scene ---------- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060d);
  const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 2500);

  const sunDir = new THREE.Vector3(0.42, 0.38, 0.83).normalize();
  const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.4);
  sunLight.position.copy(sunDir).multiplyScalar(120);
  scene.add(sunLight);
  scene.add(new THREE.AmbientLight(0x36404e, 0.65));

  const sunSpriteMat = new THREE.SpriteMaterial({
    map: makeSunTexture(), color: 0xfff3d8, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending
  });
  const sunSprite = new THREE.Sprite(sunSpriteMat);
  sunSprite.position.copy(sunDir).multiplyScalar(700);
  sunSprite.scale.setScalar(110);
  scene.add(sunSprite);

  const stars = makeStars(1900);
  scene.add(stars.object);

  /* ---------- systems ---------- */
  const maxAniso = renderer.capabilities.getMaxAnisotropy?.() || 1;
  const painter = new DecalPainter(2048, 1024, maxAniso);
  const planet = new Planet(painter, { segments: 96 });
  scene.add(planet.group);

  const effects = new Effects(scene, 6000);
  const postfx = new PostFX(renderer);
  const audio = new AudioEngine();

  let shotsFired = 0;
  const cam = new OrbitCam(camera, ui.canvas, { minR: R * 1.5, maxR: R * 7.5 });

  const weapons = new Weapons({
    scene, planet, effects, audio, ui,
    shake: (a) => cam.addTrauma(a),
    flashScreen: (v) => { flashV = v; },
    onDamage: (power, def) => applyDamage(power, def),
    onShot: () => { shotsFired++; }
  });

  /* ---------- adaptive quality (finding: bloom/particles on weak GPUs) --- */
  const qm = new QualityManager({
    isCoarsePointer: matchMedia('(pointer: coarse)').matches,
    onApply: (tier) => {
      renderer.setPixelRatio(Math.min(tier.dpr, window.devicePixelRatio || 1));
      postfx.configure(tier);
      stars.setCount(tier.stars);
      planet.setClouds(tier.clouds, tier.cloudOctaves);
      effects.setBudget(tier);
      ui.setTier(tier.id);
      handleResize();
    },
    onAutoChange: (tier, auto) => {
      ui.qualityLabel(auto ? 'Q·AUTO·' + tier.label[0] : 'Q·' + tier.label);
    }
  });

  /* ---------- game state ---------- */
  let state = 'menu';           // menu | playing | paused | dying | over
  let simTime = 0;              // frozen while paused
  let playT = 0;
  let damageAccum = 0;
  let population = POPULATION_START;
  let integrity = 1;
  const stagesShown = new Set();

  let flashV = 0;
  let deathT = -1;
  let shattered = false;

  /* destruction debris, created once, reused across rebuilds */
  let frags = null;

  function setState(s) { state = s; }

  function startGame() {
    audio.unlock();             // user gesture — safe entry for WebAudio
    setState('playing');
    ui.setState('playing');
    ui.overlay('start', false);
    cam.setRadius(R * 2.05);
    ui.toast('ORBITAL PLATFORM ONLINE', true);
    audio.uiClick(880);
  }

  function rebuild() {
    weapons.reset();
    effects.reset();
    painter.queue.length = 0;   // drop any pending scars
    planet.rebuild();
    if (frags) frags.setVisible(false);
    shattered = false;
    deathT = -1;
    damageAccum = 0;
    population = POPULATION_START;
    integrity = 1;
    playT = 0;
    shotsFired = 0;
    stagesShown.clear();
    flashV = 0.6;
    ui.integrity(integrity);
    ui.population(population);
    ui.overlay('gameover', false);
    ui.setState('playing');
    setState('playing');
    ui.toast('PLANET REBUILT', true);
  }

  function applyDamage(power) {
    if (state !== 'playing') return;
    damageAccum += power;
    integrity = Math.max(0, 1 - damageAccum / DAMAGE_MAX);
    const killed = Math.min(population, Math.round(power * KILL_PER_POWER * (0.8 + Math.random() * 0.45)));
    population -= killed;

    ui.integrity(integrity);
    ui.population(population);
    ui.populationDelta(killed);

    const frac = damageAccum / DAMAGE_MAX;
    for (const st of STAGE_MESSAGES) {
      if (frac >= st.at && !stagesShown.has(st.at)) {
        stagesShown.add(st.at);
        ui.toast(st.msg);
        audio.rumble(1.8, 0.55);
        cam.addTrauma(0.18);
      }
    }

    if (integrity <= 0) startDestruction();
  }

  function startDestruction() {
    setState('dying');
    weapons.reset();
    audio.duckAmbient(true);
    audio.detonation();
    flashV = 1.4;
    cam.addTrauma(0.95);
    ui.toast('PLANETARY CORE BREACH');
    planet.queueLavaStorm(42);
  }

  function ensureFrags() {
    if (frags) return frags;
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a5947, roughness: 0.96, metalness: 0.04, flatShading: true });
    const emberMat = new THREE.MeshBasicMaterial({ color: 0xff8438 });
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, FRAG_COUNT_ROCK);
    const embers = new THREE.InstancedMesh(rockGeo, emberMat, FRAG_COUNT_EMBER);
    rocks.frustumCulled = false;
    embers.frustumCulled = false;
    scene.add(rocks, embers);

    const items = [];
    const seedItem = (mesh, idx) => {
      const dir = new THREE.Vector3().randomDirection();
      const scale = 0.32 + Math.random() * Math.random() * 1.7;
      items.push({
        mesh, idx,
        dir,
        r: R * (0.3 + Math.random() * 0.75),
        scale,
        vel: dir.clone().multiplyScalar(2.6 + Math.random() * 7.5)
          .addScaledVector(new THREE.Vector3().crossVectors(dir, UP_VEC), (Math.random() - 0.5) * 2),
        spinAxis: new THREE.Vector3().randomDirection(),
        spinSpeed: 0.5 + Math.random() * 2.6,
        quat: new THREE.Quaternion()
      });
    };
    for (let i = 0; i < FRAG_COUNT_ROCK; i++) seedItem(rocks, i);
    for (let i = 0; i < FRAG_COUNT_EMBER; i++) seedItem(embers, i);

    frags = {
      items,
      setVisible(v) { rocks.visible = v; embers.visible = v; },
      update(dt) {
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        for (const it of items) {
          it.mesh === undefined; void it;
          it.r += it.vel.dot(it.dir) * dt;
          it.pos = it.dir.clone().multiplyScalar(it.r);
          q.setFromAxisAngle(it.spinAxis, it.spinSpeed * dt);
          it.quat.premultiply(q);
          m.compose(it.pos, it.quat, new THREE.Vector3().setScalar(it.scale));
          it.mesh.setMatrixAt(it.idx, m);
        }
        rocks.instanceMatrix.needsUpdate = true;
        embers.instanceMatrix.needsUpdate = true;
      }
    };
    frags.setVisible(false);
    return frags;
  }

  function shatter() {
    shattered = true;
    planet.setAlive(false);
    const f = ensureFrags();
    f.setVisible(true);
    flashV = 1.7;
    cam.addTrauma(1);
    effects.flash(new THREE.Vector3(), 4, 60, 0.8, 0xffc070);
    audio.explosion(3);
    audio.rumble(5, 0.85);
  }

  function finishGame() {
    setState('over');
    ui.setState('gameover');
    ui.overlay('gameover', true);
    ui.gameover(
      { time: playT, shots: shotsFired },
      GO_FLAVOR[(Math.random() * GO_FLAVOR.length) | 0]
    );
  }

  /* ---------- pause / help / mute ---------- */

  function togglePause(force) {
    const wantPause = force ?? (state === 'playing');
    if (wantPause && state === 'playing') {
      setState('paused');
      ui.setState('paused');
      ui.overlay('pause', true);
      audio.duckAmbient(true);
    } else if (!wantPause && state === 'paused') {
      setState('playing');
      ui.setState('playing');
      ui.overlay('pause', false);
      audio.duckAmbient(false);
    }
  }

  let helpPausedGame = false;
  function openHelp() {
    ui.overlay('help', true);
    if (state === 'playing') { helpPausedGame = true; togglePause(true); }
    audio.uiClick(720);
  }
  function closeHelp() {
    ui.overlay('help', false);
    if (helpPausedGame) { helpPausedGame = false; togglePause(false); }
    audio.uiClick(520);
  }

  function toggleMute() {
    const m = !(localStorage.getItem('ss-muted') === '1');
    localStorage.setItem('ss-muted', m ? '1' : '0');
    audio.setMuted(m);
    ui.muteLabel(m);
    if (!m) audio.uiClick(760);
  }
  if (localStorage.getItem('ss-muted') === '1') {
    audio.muted = true;
    ui.muteLabel(true);
  }

  /* ---------- input ---------- */

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let px = innerWidth / 2, py = innerHeight / 2;
  let touchDown = null;

  function computeAim() {
    ndc.set((px / innerWidth) * 2 - 1, -(py / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(planet.mesh, false);
    if (!hits.length) return null;
    const h = hits[0];
    const normal = h.face.normal.clone().transformDirection(planet.mesh.matrixWorld).normalize();
    const point = h.point.clone().normalize().multiplyScalar(R + 0.02);
    return { point, normal };
  }

  ui.canvas.addEventListener('pointermove', (e) => {
    px = e.clientX; py = e.clientY;
    ui.crosshair(px, py);
  });

  ui.canvas.addEventListener('pointerdown', (e) => {
    audio.unlock();                       // THE gesture hook for WebAudio
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    px = e.clientX; py = e.clientY;
    ui.crosshair(px, py);
    if (state !== 'playing') return;
    if (e.pointerType === 'mouse') {
      weapons.beginFire(computeAim(), camera);
    } else {
      touchDown = { x: px, y: py, t: performance.now() };
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (state !== 'playing') return;
    if (touchDown && e.pointerId !== undefined) {
      const moved = Math.hypot(e.clientX - touchDown.x, e.clientY - touchDown.y);
      if (moved < 9 && performance.now() - touchDown.t < 350) {
        px = e.clientX; py = e.clientY;
        weapons.beginFire(computeAim(), camera);
        setTimeout(() => weapons.endFire(), 90);
      }
      touchDown = null;
    } else if (e.pointerType === 'mouse') {
      weapons.endFire();
    }
  });
  window.addEventListener('pointercancel', () => weapons.endFire());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') togglePause(true);
  });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    audio.unlock();                       // keyboard counts as a gesture too
    const k = e.key.toLowerCase();

    if (!ui.el.help.classList.contains('hidden')) {
      if (k === 'h' || k === 'escape') closeHelp();
      return;
    }
    switch (k) {
      case '1': case '2': case '3': case '4': case '5': case '6': {
        const i = Number(k) - 1;
        if (i < WEAPONS.length) weapons.select(i);
        break;
      }
      case 'm': toggleMute(); break;
      case 'q': ui.qualityLabel(qm.cycle()); break;
      case 'h': openHelp(); break;
      case 'p': case 'escape': togglePause(); break;
      case 'r': if (state === 'over' || state === 'paused' || state === 'playing') rebuild(); break;
    }
  });

  ui.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    ui.fatal('The WebGL context was lost. Reload the page to restart the apocalypse.');
  });

  /* ---------- resize ---------- */

  function handleResize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    postfx.setSize(
      Math.max(2, Math.floor(w * renderer.getPixelRatio())),
      Math.max(2, Math.floor(h * renderer.getPixelRatio()))
    );
  }
  window.addEventListener('resize', handleResize);

  /* ---------- go live ---------- */
  qm.applyInitial();
  handleResize();
  ui.buildDock(WEAPONS);
  ui.select(0);
  ui.setSelectedRef(0);
  ui.integrity(integrity);
  ui.population(population);
  ui.setState('menu');

  let lastT = performance.now();

  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.05);
    lastT = now;

    qm.sample(dt);                          // adaptive-quality telemetry

    const paused = state === 'paused';
    if (!paused) simTime += dt;

    painter.flush(performance.now());       // batched decal upload (finding)

    if (!paused) {
      planet.update(dt, simTime);

      if (state === 'menu') {
        cam.update(dt, 0.055);
      } else if (state === 'playing') {
        playT += dt;
        cam.update(dt, 0);
        weapons.update(dt, computeAim(), camera, simTime);
      } else if (state === 'dying') {
        deathT += dt;
        if (deathT < 1.0) cam.addTrauma(dt * 0.85);
        if (deathT >= 0.95 && !shattered) shatter();
        if (deathT >= 3.6) finishGame();
        cam.update(dt, 0.14);
      } else if (state === 'over') {
        cam.update(dt, 0.06);
      }

      if (frags && shattered) frags.update(paused ? 0 : dt);
      effects.update(dt);
    } else {
      cam.update(dt, 0);                    // orbiting while paused is allowed
    }

    if (flashV > 0) {
      flashV = Math.max(0, flashV - dt * 2.1);
      ui.flash(flashV);
    }

    postfx.render(scene, camera, simTime);
  }
  frame();
}

const UP_VEC = new THREE.Vector3(0, 1, 0);

function makeSunTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,244,1)');
  g.addColorStop(0.18, 'rgba(255,238,200,0.9)');
  g.addColorStop(0.5, 'rgba(255,190,110,0.28)');
  g.addColorStop(1, 'rgba(255,160,80,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

try {
  boot();
} catch (err) {
  console.error(err);
  const el = document.getElementById('fatal');
  const msg = document.getElementById('fatal-msg');
  if (msg) msg.textContent = 'Unexpected startup error: ' + (err?.message || err);
  if (el) el.classList.remove('hidden');
}
