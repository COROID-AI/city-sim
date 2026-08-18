/* CitySim main — bootstrap, input wiring, RAF loop. */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  function start() {
    var cfg = CitySim.config;
    var doc = global.document;
    var canvas = doc.getElementById('game');
    var minimapCanvas = doc.getElementById('minimap');
    var hudRoot = doc.getElementById('hud');
    var inspectorPanel = doc.getElementById('inspector');

    // --- world ---
    var city = CitySim.city.generate(cfg);
    var buildings = CitySim.buildings.create(cfg, city);
    var companies = CitySim.companies.create(cfg, city, buildings);
    var citizens = CitySim.citizens.create(cfg, city, buildings, companies);
    var vehicles = CitySim.vehicles.create(cfg, city, buildings, companies, citizens);

    var ctx = {
      city: city,
      buildings: buildings,
      companies: companies,
      citizens: citizens,
      vehicles: vehicles,
      config: cfg,
      rng: CitySim.utils.mulberry32(cfg.seed + 7)
    };

    var sim = CitySim.sim.create(cfg);
    var economy = CitySim.economy.init(cfg);
    CitySim.sim.attach(sim, ctx, economy);

    for (var i = 0; i < citizens.length; i++) {
      CitySim.citizens.syncToTime(citizens[i], sim.min, ctx);
    }
    for (var v = 0; v < vehicles.length; v++) {
      if (vehicles[v].kind !== 'bus') CitySim.vehicles.startRoute(vehicles[v], sim, ctx);
    }

    // --- renderer / camera ---
    var renderer = CitySim.renderer.create(canvas);
    renderer.staticLayer = CitySim.renderer.buildStaticLayer(city, buildings, cfg);

    var cam = CitySim.camera.create(global.innerWidth, global.innerHeight);
    function resize() {
      var w = global.innerWidth, h = global.innerHeight;
      canvas.width = w;
      canvas.height = h;
      cam.viewW = w;
      cam.viewH = h;
      CitySim.camera.clampToBounds(cam, city.worldWidth, city.worldHeight);
    }
    CitySim.camera.centerOn(cam, city.worldWidth / 2, city.worldHeight / 2, city.worldWidth, city.worldHeight);
    resize();
    global.addEventListener('resize', resize);

    // --- minimap ---
    var mm = CitySim.minimap.create(minimapCanvas, cfg.minimapSize);
    mm.worldW = city.worldWidth;
    mm.worldH = city.worldHeight;
    CitySim.minimap.buildBase(mm, city, buildings, cfg);

    // --- hud / inspector ---
    var hud = CitySim.hud.init(hudRoot, sim, function (idx) {
      CitySim.sim.setSpeed(sim, idx);
    });
    hud.setActive(sim.speedIndex);

    var inspector = CitySim.inspector.init(inspectorPanel);

    // --- input ---
    var dragging = false, moved = false, downX = 0, downY = 0;
    var hovered = null, lastHoverPick = 0;

    function canvasPoint(e) {
      var rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    canvas.addEventListener('pointerdown', function (e) {
      dragging = true;
      moved = false;
      downX = e.clientX;
      downY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    });

    canvas.addEventListener('pointermove', function (e) {
      if (dragging) {
        var dx = e.clientX - downX, dy = e.clientY - downY;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        downX = e.clientX;
        downY = e.clientY;
        CitySim.camera.pan(cam, -dx / cam.zoom, -dy / cam.zoom);
        CitySim.camera.clampToBounds(cam, city.worldWidth, city.worldHeight);
      } else {
        var now = global.performance.now();
        if (now - lastHoverPick > cfg.hoverPickMs) {
          lastHoverPick = now;
          var pt = canvasPoint(e);
          var pick = CitySim.inspector.pickAt(pt.x, pt.y, cam, ctx, cfg);
          hovered = pick ? pick.entity : null;
          canvas.style.cursor = pick ? 'pointer' : 'default';
        }
      }
    });

    canvas.addEventListener('pointerup', function (e) {
      if (!dragging) return;
      dragging = false;
      if (!moved) {
        var pt = canvasPoint(e);
        var pick = CitySim.inspector.pickAt(pt.x, pt.y, cam, ctx, cfg);
        CitySim.inspector.select(inspector, pick);
      }
    });

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var pt = canvasPoint(e);
      var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      CitySim.camera.zoomAt(cam, pt.x, pt.y, factor);
      CitySim.camera.clampToBounds(cam, city.worldWidth, city.worldHeight);
    }, { passive: false });

    global.addEventListener('keydown', function (e) {
      var pan = 40 / cam.zoom;
      if (e.key === 'ArrowLeft' || e.key === 'a') cam.x -= pan;
      else if (e.key === 'ArrowRight' || e.key === 'd') cam.x += pan;
      else if (e.key === 'ArrowUp' || e.key === 'w') cam.y -= pan;
      else if (e.key === 'ArrowDown' || e.key === 's') cam.y += pan;
      else if (e.key === '+' || e.key === '=') CitySim.camera.zoomAt(cam, cam.viewW / 2, cam.viewH / 2, 1.15);
      else if (e.key === '-') CitySim.camera.zoomAt(cam, cam.viewW / 2, cam.viewH / 2, 1 / 1.15);
      else if (e.key === ' ') {
        CitySim.sim.togglePause(sim);
        hud.setActive(sim.paused ? 0 : sim.speedIndex);
      }
      CitySim.camera.clampToBounds(cam, city.worldWidth, city.worldHeight);
    });

    function mmPoint(e) {
      var rect = minimapCanvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }
    minimapCanvas.addEventListener('pointerdown', function (e) {
      var p = mmPoint(e);
      CitySim.minimap.handlePointer(mm, cam, p.x, p.y, city.worldWidth, city.worldHeight);
    });
    minimapCanvas.addEventListener('pointermove', function (e) {
      if (e.buttons & 1) {
        var p = mmPoint(e);
        CitySim.minimap.handlePointer(mm, cam, p.x, p.y, city.worldWidth, city.worldHeight);
      }
    });

    // --- main loop ---
    var last = global.performance.now();
    function frame(now) {
      var dt = Math.min(0.1, (now - last) / 1000);
      last = now;

      CitySim.sim.update(sim, dt);
      CitySim.camera.clampToBounds(cam, city.worldWidth, city.worldHeight);

      CitySim.renderer.render(renderer, {
        camera: cam,
        citizens: citizens,
        vehicles: vehicles,
        buildings: buildings,
        city: city,
        sim: sim,
        config: cfg,
        selected: inspector.selected,
        hovered: hovered
      });

      CitySim.minimap.render(mm, {
        camera: cam,
        citizens: citizens,
        vehicles: vehicles,
        sim: sim,
        now: now
      });

      CitySim.hud.update(hud, sim, economy);
      CitySim.inspector.update(inspector, sim, ctx);

      global.requestAnimationFrame(frame);
    }
    global.requestAnimationFrame(frame);
  }

  CitySim.main = { start: start };

  // Auto-start in the browser.
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);