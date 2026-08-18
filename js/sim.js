/* CitySim sim — clock, pacing, hour-boundary hooks, entity updates. Pure module (no DOM). */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  function create(cfg) {
    var sim = {
      day: cfg.startDay,
      min: cfg.startHour * 60 + cfg.startMinute,
      speedIndex: 1,
      paused: false,
      lastRealTime: 0,
      dtSimMin: 0,
      lastHourFired: -1,
      economy: null,
      citizens: [],
      vehicles: [],
      ctx: null
    };
    sim.getHour = function () { return getHour(sim); };
    sim.getMinute = function () { return getMinute(sim); };
    sim.getTimeString = function () { return getTimeString(sim); };
    sim.getSpeed = function () { return getSpeed(sim); };
    sim.setSpeed = function (idx) { setSpeed(sim, idx); };
    sim.togglePause = function () { togglePause(sim); };
    sim.update = function (realDtSec) { update(sim, realDtSec); };
    sim.advanceSimMinutes = function (dtSim) { advanceSimMinutes(sim, dtSim); };
    return sim;
  }

  function attach(sim, ctx, economy) {
    sim.ctx = ctx;
    sim.economy = economy;
    sim.citizens = ctx.citizens;
    sim.vehicles = ctx.vehicles;
  }

  function getHour(sim) { return Math.floor(sim.min / 60) % 24; }
  function getMinute(sim) { return Math.floor(sim.min % 60); }
  function getTimeString(sim) { return CitySim.utils.formatTime(sim.min); }
  function getSpeed(sim) { return sim.paused ? 0 : CitySim.config.speedMultipliers[sim.speedIndex]; }

  function setSpeed(sim, idx) {
    sim.speedIndex = CitySim.utils.clamp(idx, 0, CitySim.config.speedMultipliers.length - 1);
    sim.paused = sim.speedIndex === 0;
  }

  function togglePause(sim) { sim.paused = !sim.paused; }

  // sunFactor: 1 at noon, ~0 at midnight, smooth cosine.
  function sunFactor(hour) {
    var f = (Math.cos(((hour - 12) / 24) * Math.PI * 2) + 1) / 2;
    return CitySim.utils.clamp(f, 0, 1);
  }

  function update(sim, realDtSec) {
    if (sim.paused) return;
    var speed = CitySim.config.speedMultipliers[sim.speedIndex];
    var dtSim = realDtSec * CitySim.config.simMinutesPerRealSecond * speed;
    advanceSimMinutes(sim, dtSim);
  }

  // Advance the sim clock by dtSim minutes, firing economy ticks on hour
  // boundaries crossed, then updating citizens and vehicles with that dt.
  function advanceSimMinutes(sim, dtSim) {
    if (dtSim <= 0) return;
    var startHour = Math.floor(sim.min / 60);
    sim.min += dtSim;
    while (sim.min >= 1440) {
      sim.min -= 1440;
      sim.day++;
    }
    var endHour = Math.floor(sim.min / 60);

    var h = startHour;
    var guard = 0;
    while (guard++ < 40) {
      if (sim.lastHourFired !== h) {
        sim.lastHourFired = h;
        if (sim.economy && sim.ctx) CitySim.economy.tick(sim.economy, sim, sim.ctx);
      }
      if (h === endHour) break;
      h = (h + 1) % 24;
    }

    sim.dtSimMin = dtSim;
    var ctx = sim.ctx;
    if (ctx) {
      for (var i = 0; i < sim.citizens.length; i++) {
        CitySim.citizens.update(sim.citizens[i], sim, ctx);
      }
      for (var v = 0; v < sim.vehicles.length; v++) {
        CitySim.vehicles.update(sim.vehicles[v], sim, ctx);
      }
    }
  }

  CitySim.sim = {
    create: create,
    attach: attach,
    update: update,
    advanceSimMinutes: advanceSimMinutes,
    getHour: getHour,
    getMinute: getMinute,
    getTimeString: getTimeString,
    getSpeed: getSpeed,
    setSpeed: setSpeed,
    togglePause: togglePause,
    sunFactor: sunFactor
  };
})(typeof window !== 'undefined' ? window : globalThis);