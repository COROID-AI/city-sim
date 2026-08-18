/* CitySim renderer — canvas rendering with cached static layer and viewport culling. */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  var ACTIVITY_COLORS = {
    SLEEP: '#5a5a6a',
    HOME: '#7fc97f',
    TRAVEL: '#f2c14e',
    WORK: '#66b3ff',
    LUNCH: '#ffa07a',
    ENTERTAINMENT: '#e58fd0'
  };

  function create(canvas) {
    var ctx = canvas.getContext('2d');
    return { canvas: canvas, ctx: ctx, staticLayer: null };
  }

  function drawBuilding(ctx, b, ts, cfg) {
    var x = b.x * ts, y = b.y * ts, w = b.w * ts, h = b.h * ts;
    ctx.fillStyle = cfg.colors.building[b.type] || '#888888';
    ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x + 2, y + h - 6, w - 4, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x + 2, y + 2, w - 4, 6);
    if (b.type !== 'industrial') {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      var cols = Math.max(2, Math.floor((w - 8) / 8));
      var rows = Math.max(2, Math.floor((h - 10) / 10));
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          ctx.fillRect(x + 5 + c * ((w - 10) / cols), y + 6 + r * ((h - 12) / rows), 3, 4);
        }
      }
    }
  }

  function buildStaticLayer(city, buildings, cfg) {
    var ts = cfg.tileSize;
    var canvas = global.document.createElement('canvas');
    canvas.width = city.width * ts;
    canvas.height = city.height * ts;
    var ctx = canvas.getContext('2d');
    var T = CitySim.city.T;

    for (var y = 0; y < city.height; y++) {
      for (var x = 0; x < city.width; x++) {
        var t = city.tileAt(x, y);
        ctx.fillStyle = t === T.ROAD ? cfg.colors.road : t === T.WATER ? cfg.colors.water : t === T.PARK ? cfg.colors.park : cfg.colors.grass;
        ctx.fillRect(x * ts, y * ts, ts, ts);
        if (t === T.GRASS && (x + y) % 2 === 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.05)';
          ctx.fillRect(x * ts, y * ts, ts, ts);
        }
      }
    }

    // road markings at intersections
    ctx.fillStyle = cfg.colors.roadMarking;
    for (var i = 0; i < city.intersections.length; i++) {
      var it = city.intersections[i];
      ctx.fillRect(it.x * ts + ts / 2 - 2, it.y * ts, 4, ts);
      ctx.fillRect(it.x * ts, it.y * ts + ts / 2 - 2, ts, 4);
    }

    for (var b = 0; b < buildings.length; b++) {
      drawBuilding(ctx, buildings[b], ts, cfg);
    }
    return canvas;
  }

  function drawCitizen(ctx, c, cfg, state) {
    var p = c.current.pos;
    var r = 3.6;
    ctx.fillStyle = ACTIVITY_COLORS[c.current.activity] || '#cccccc';
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8c9a8';
    ctx.beginPath();
    ctx.arc(p.x + 1.5, p.y - 2.5, 1.6, 0, Math.PI * 2);
    ctx.fill();
    if (state.selected === c) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    } else if (state.hovered === c) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function drawVehicle(ctx, v, cfg, sim) {
    var len = v.kind === 'bus' ? 16 : v.kind === 'truck' ? 15 : 11;
    var wid = v.kind === 'bus' ? 8 : v.kind === 'truck' ? 7 : 5;
    ctx.save();
    ctx.translate(v.pos.x, v.pos.y);
    ctx.rotate(v.heading);
    ctx.fillStyle = v.color;
    ctx.fillRect(-len / 2, -wid / 2, len, wid);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(len / 2 - 3, -wid / 2 + 1, 2, wid - 2);
    var night = 1 - CitySim.sim.sunFactor(sim.getHour() + sim.getMinute() / 60);
    if (night > 0.4) {
      ctx.fillStyle = 'rgba(255,240,170,' + (0.5 + night * 0.5).toFixed(2) + ')';
      ctx.fillRect(len / 2 - 1, -wid / 2, 2, 2);
      ctx.fillRect(len / 2 - 1, wid / 2 - 2, 2, 2);
    }
    ctx.restore();
  }

  function drawNightEffects(ctx, state, vis, cfg) {
    var h = state.sim.getHour() + state.sim.getMinute() / 60;
    var night = 1 - CitySim.sim.sunFactor(h);
    if (night < 0.15) return;
    var ts = cfg.tileSize;

    // building windows glow
    var buildings = state.buildings;
    for (var i = 0; i < buildings.length; i++) {
      var b = buildings[i];
      if (b.type === 'industrial') continue;
      var bx = b.x * ts, by = b.y * ts, bw = b.w * ts, bh = b.h * ts;
      if (bx + bw < vis.x || bx > vis.x + vis.w || by + bh < vis.y || by > vis.y + vis.h) continue;
      ctx.fillStyle = 'rgba(255,220,120,' + (0.35 + night * 0.45).toFixed(2) + ')';
      var cols = Math.max(2, Math.floor((bw - 8) / 8));
      var rows = Math.max(2, Math.floor((bh - 10) / 10));
      for (var r = 0; r < rows; r++) {
        for (var c = 0; c < cols; c++) {
          ctx.fillRect(bx + 5 + c * ((bw - 10) / cols), by + 6 + r * ((bh - 12) / rows), 3, 4);
        }
      }
    }

    // street lamps at intersections
    var ints = state.city.intersections;
    for (var k = 0; k < ints.length; k++) {
      var it = ints[k];
      var lx = it.x * ts + ts / 2, ly = it.y * ts + ts / 2;
      if (lx < vis.x - 20 || lx > vis.x + vis.w + 20 || ly < vis.y - 20 || ly > vis.y + vis.h + 20) continue;
      ctx.fillStyle = 'rgba(255,200,90,' + (0.25 + night * 0.5).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(lx, ly, 6 + night * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Pure: returns {r,g,b,a} tint for an hour (used by render and headless tests).
  function tintForHour(hour) {
    var sun = CitySim.sim.sunFactor(hour);
    var night = 1 - sun;
    var dawnDusk = Math.exp(-Math.pow((hour - 6.5) / 1.2, 2)) + Math.exp(-Math.pow((hour - 19) / 1.2, 2));
    var r = Math.round(10 + dawnDusk * 60);
    var g = Math.round(16 + dawnDusk * 30);
    var b = Math.round(48 + night * 20);
    var a = 0.08 + night * 0.42 + dawnDusk * 0.10;
    return { r: r, g: g, b: b, a: Math.min(0.62, a) };
  }

  function render(r, state) {
    var ctx = r.ctx;
    var cam = state.camera;
    var cfg = state.config;
    var vw = cam.viewW, vh = cam.viewH;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0e12';
    ctx.fillRect(0, 0, vw, vh);

    ctx.setTransform(cam.zoom, 0, 0, cam.zoom, -cam.x * cam.zoom, -cam.y * cam.zoom);
    if (r.staticLayer) ctx.drawImage(r.staticLayer, 0, 0);

    var vis = CitySim.camera.visibleWorldRect(cam);
    var margin = cfg.tileSize * 2;
    var i, v, c;

    for (i = 0; i < state.vehicles.length; i++) {
      v = state.vehicles[i];
      if (v.pos.x < vis.x - margin || v.pos.x > vis.x + vis.w + margin || v.pos.y < vis.y - margin || v.pos.y > vis.y + vis.h + margin) continue;
      drawVehicle(ctx, v, cfg, state.sim);
      if (state.selected === v) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(v.pos.x, v.pos.y, 11, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    for (i = 0; i < state.citizens.length; i++) {
      c = state.citizens[i];
      var p = c.current.pos;
      if (p.x < vis.x - margin || p.x > vis.x + vis.w + margin || p.y < vis.y - margin || p.y > vis.y + vis.h + margin) continue;
      drawCitizen(ctx, c, cfg, state);
    }

    drawNightEffects(ctx, state, vis, cfg);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var tint = tintForHour(state.sim.getHour() + state.sim.getMinute() / 60);
    if (tint.a > 0.01) {
      ctx.fillStyle = 'rgba(' + tint.r + ',' + tint.g + ',' + tint.b + ',' + tint.a.toFixed(3) + ')';
      ctx.fillRect(0, 0, vw, vh);
    }
  }

  CitySim.renderer = {
    create: create,
    buildStaticLayer: buildStaticLayer,
    render: render,
    tintForHour: tintForHour,
    ACTIVITY_COLORS: ACTIVITY_COLORS
  };
})(typeof window !== 'undefined' ? window : globalThis);