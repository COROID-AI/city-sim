/* CitySim minimap — scaled city view, live viewport rectangle, click-to-jump. */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  function create(canvas, size) {
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    return {
      canvas: canvas,
      ctx: ctx,
      size: size,
      worldW: 1,
      worldH: 1,
      base: null,
      lastDots: 0
    };
  }

  function buildBase(mm, city, buildings, cfg) {
    var s = mm.size;
    var canvas = global.document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    var ctx = canvas.getContext('2d');
    var scaleX = s / city.worldWidth, scaleY = s / city.worldHeight;
    var T = CitySim.city.T;

    for (var y = 0; y < city.height; y++) {
      for (var x = 0; x < city.width; x++) {
        var t = city.tileAt(x, y);
        ctx.fillStyle = t === T.ROAD ? '#55555e' : t === T.WATER ? cfg.colors.water : t === T.PARK ? cfg.colors.park : cfg.colors.grass;
        ctx.fillRect(Math.floor(x * cfg.tileSize * scaleX), Math.floor(y * cfg.tileSize * scaleY), Math.ceil(scaleX * cfg.tileSize) + 1, Math.ceil(scaleY * cfg.tileSize) + 1);
      }
    }
    for (var b = 0; b < buildings.length; b++) {
      var bl = buildings[b];
      ctx.fillStyle = cfg.colors.building[bl.type];
      ctx.fillRect(
        Math.floor(bl.x * cfg.tileSize * scaleX),
        Math.floor(bl.y * cfg.tileSize * scaleY),
        Math.max(1, Math.ceil(bl.w * cfg.tileSize * scaleX)),
        Math.max(1, Math.ceil(bl.h * cfg.tileSize * scaleY))
      );
    }
    mm.base = canvas;
  }

  // Single source of truth for map<->world mapping (used by rect + click).
  function worldToMap(mm, wx, wy) {
    return { x: (wx / mm.worldW) * mm.size, y: (wy / mm.worldH) * mm.size };
  }

  function mapToWorld(mm, mx, my) {
    return { x: (mx / mm.size) * mm.worldW, y: (my / mm.size) * mm.worldH };
  }

  function render(mm, state) {
    var ctx = mm.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, mm.size, mm.size);
    if (mm.base) ctx.drawImage(mm.base, 0, 0);

    var now = state.now || 0;
    if (now - mm.lastDots > 150 || now < mm.lastDots) {
      mm.lastDots = now;
      var cit = state.citizens, veh = state.vehicles;
      ctx.fillStyle = '#e8e8f0';
      for (var i = 0; i < cit.length; i++) {
        var c = cit[i].current.pos;
        var p = worldToMap(mm, c.x, c.y);
        ctx.fillRect(p.x - 0.5, p.y - 0.5, 1.5, 1.5);
      }
      ctx.fillStyle = '#ffb347';
      for (var v = 0; v < veh.length; v++) {
        var q = worldToMap(mm, veh[v].pos.x, veh[v].pos.y);
        ctx.fillRect(q.x - 0.5, q.y - 0.5, 2, 2);
      }
    }

    // viewport rect — always fresh from the live camera
    var cam = state.camera;
    var tl = worldToMap(mm, cam.x, cam.y);
    var br = worldToMap(mm, cam.x + cam.viewW / cam.zoom, cam.y + cam.viewH / cam.zoom);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, Math.max(1, br.x - tl.x), Math.max(1, br.y - tl.y));
  }

  // Recenter the main camera on the clicked map point (clamped to world bounds).
  function handlePointer(mm, cam, mx, my, worldW, worldH) {
    var w = mapToWorld(mm, mx, my);
    CitySim.camera.centerOn(cam, w.x, w.y, worldW, worldH);
  }

  CitySim.minimap = {
    create: create,
    buildBase: buildBase,
    worldToMap: worldToMap,
    mapToWorld: mapToWorld,
    render: render,
    handlePointer: handlePointer
  };
})(typeof window !== 'undefined' ? window : globalThis);