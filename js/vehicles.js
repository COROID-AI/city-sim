/* CitySim vehicles — cars, buses, trucks driving the road network. Pure module (no DOM). */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  var PLATES = ['ABC-123', 'DEF-456', 'GHI-789', 'JKL-012', 'MNO-345', 'PQR-678', 'STU-901', 'VWX-234', 'YZA-567', 'BCD-890', 'EFG-123', 'HIJ-456', 'KLM-789', 'NOP-012', 'QRS-345', 'TUV-678', 'WXY-901', 'ZAB-234', 'CDE-567', 'FGH-890'];

  function carColor(rng) {
    var colors = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400', '#16a085', '#2c3e50', '#7f8c8d', '#b7950b', '#6c5ce7'];
    return colors[Math.floor(rng() * colors.length)];
  }

  function citizenById(citizens, id) {
    for (var i = 0; i < citizens.length; i++) {
      if (citizens[i].id === id) return citizens[i];
    }
    return null;
  }

  function buildingById(buildings, id) {
    for (var i = 0; i < buildings.length; i++) {
      if (buildings[i].id === id) return buildings[i];
    }
    return null;
  }

  function nearestRoadTile(city, tx, ty) {
    var best = null, bd = Infinity;
    for (var r = 0; r <= 12 && !best; r++) {
      for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          var x = tx + dx, y = ty + dy;
          if (x < 0 || x >= city.width || y < 0 || y >= city.height) continue;
          if (city.isRoad(x, y)) {
            var d = dx * dx + dy * dy;
            if (!best || d < bd) { bd = d; best = { x: x, y: y }; }
          }
        }
      }
    }
    return best || { x: tx, y: ty };
  }

  function pickRandomRoad(ctx) {
    return CitySim.utils.pick(ctx.rng, ctx.city.roadTiles);
  }

  function buildingEntrance(ctx, buildingId) {
    var b = buildingById(ctx.buildings, buildingId);
    if (!b) return pickRandomRoad(ctx);
    return nearestRoadTile(ctx.city, b.entrance.x, b.entrance.y);
  }

  function truckTarget(ctx, vehicle) {
    var companies = ctx.companies;
    if (!companies.length) return pickRandomRoad(ctx);
    var c = CitySim.utils.pick(vehicle.rng, companies);
    return buildingEntrance(ctx, c.buildingId);
  }

  function carNextTarget(vehicle, sim, ctx) {
    var hour = sim.getHour();
    var owner = citizenById(ctx.citizens, vehicle.ownerId);
    if (!owner) return pickRandomRoad(ctx);
    if (hour < 10 && owner.workId != null) return buildingEntrance(ctx, owner.workId);
    if (hour >= 17 && hour < 22) return buildingEntrance(ctx, owner.entId);
    if (hour >= 22 || hour < 6) return buildingEntrance(ctx, owner.homeId);
    if (CitySim.utils.chance(vehicle.rng, 0.5)) return buildingEntrance(ctx, owner.entId);
    return pickRandomRoad(ctx);
  }

  function create(cfg, city, buildings, companies, citizens) {
    var utils = CitySim.utils;
    var rng = city.rng;
    var vehicles = [];
    var id = 0;
    var cars = Math.floor(cfg.vehicles * 0.62);
    var buses = Math.floor(cfg.vehicles * 0.14);
    var trucks = cfg.vehicles - cars - buses;
    var roads = city.roadTiles;

    // Cars: owned by random citizens
    for (var i = 0; i < cars; i++) {
      var owner = utils.pick(rng, citizens);
      vehicles.push({
        id: id++,
        kind: 'car',
        plate: PLATES[i % PLATES.length] + '-' + utils.randInt(rng, 10, 99),
        color: carColor(rng),
        ownerId: owner.id,
        speed: utils.rand(rng, cfg.speeds.car * 0.85, cfg.speeds.car * 1.15),
        pos: { x: 0, y: 0 },
        path: [],
        pathIndex: 0,
        waitUntilMin: 0,
        heading: 0,
        rng: utils.mulberry32(cfg.seed + 100000 + id)
      });
    }

    // Buses: fixed loops between two road tiles
    for (var b = 0; b < buses; b++) {
      var a = utils.pick(rng, roads);
      var z = utils.pick(rng, roads);
      var leg1 = CitySim.pathfinding.findPath(city, a.x, a.y, z.x, z.y, city.isPassableVehicle);
      var leg2 = CitySim.pathfinding.findPath(city, z.x, z.y, a.x, a.y, city.isPassableVehicle);
      var segments = [];
      if (leg1 && leg1.length > 1) segments.push(leg1);
      if (leg2 && leg2.length > 1) segments.push(leg2);
      if (!segments.length) segments = [[a, z], [z, a]];
      var segIndex = 0;
      var bus = {
        id: id++,
        kind: 'bus',
        plate: 'BUS-' + (b + 1) + '-' + utils.randInt(rng, 10, 99),
        color: '#d8a12e',
        ownerId: null,
        speed: cfg.speeds.bus,
        pos: { x: 0, y: 0 },
        path: segments[segIndex],
        pathIndex: 0,
        segments: segments,
        segIndex: segIndex,
        waitUntilMin: 0,
        heading: 0,
        rng: utils.mulberry32(cfg.seed + 200000 + id)
      };
      var start = bus.path[0];
      bus.pos = city.tileToWorld(start.x, start.y);
      vehicles.push(bus);
    }

    // Trucks: delivery between companies
    for (var t = 0; t < trucks; t++) {
      vehicles.push({
        id: id++,
        kind: 'truck',
        plate: 'TRK-' + (t + 1) + '-' + utils.randInt(rng, 10, 99),
        color: '#7a7f8a',
        ownerId: null,
        speed: utils.rand(rng, cfg.speeds.truck * 0.9, cfg.speeds.truck * 1.1),
        pos: { x: 0, y: 0 },
        path: [],
        pathIndex: 0,
        waitUntilMin: 0,
        heading: 0,
        rng: utils.mulberry32(cfg.seed + 300000 + id)
      });
    }

    return vehicles;
  }

  function startRoute(vehicle, sim, ctx) {
    var target = vehicle.kind === 'truck' ? truckTarget(ctx, vehicle) : carNextTarget(vehicle, sim, ctx);
    var from = ctx.city.worldToTile(vehicle.pos.x, vehicle.pos.y);
    if (!ctx.city.isRoad(from.x, from.y)) from = nearestRoadTile(ctx.city, from.x, from.y);
    var path = CitySim.pathfinding.cachedFindPath(ctx.city, from.x, from.y, target.x, target.y, ctx.city.isPassableVehicle, 'vehicle');
    vehicle.path = path || [];
    vehicle.pathIndex = 0;
    if (vehicle.path.length) {
      vehicle.pos = ctx.city.tileToWorld(vehicle.path[0].x, vehicle.path[0].y);
    }
    vehicle.waitUntilMin = 0;
  }

  function advanceTour(vehicle, dtSim, sim, ctx) {
    var ts = ctx.config.tileSize;
    var remaining = dtSim * vehicle.speed * ts;
    var guard = 0;
    while (remaining > 0 && vehicle.pathIndex < vehicle.path.length && guard++ < 256) {
      var wp = vehicle.path[vehicle.pathIndex];
      var wx = (wp.x + 0.5) * ts, wy = (wp.y + 0.5) * ts;
      var dx = wx - vehicle.pos.x, dy = wy - vehicle.pos.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < 0.001) {
        vehicle.pathIndex++;
        continue;
      }
      if (d <= remaining) {
        vehicle.pos.x = wx;
        vehicle.pos.y = wy;
        vehicle.pathIndex++;
        remaining -= d;
        vehicle.heading = Math.atan2(dy, dx);
      } else {
        vehicle.pos.x += (dx / d) * remaining;
        vehicle.pos.y += (dy / d) * remaining;
        vehicle.heading = Math.atan2(dy, dx);
        remaining = 0;
      }
    }
    if (vehicle.pathIndex >= vehicle.path.length) {
      vehicle.path = [];
      vehicle.pathIndex = 0;
      if (vehicle.kind === 'bus') {
        vehicle.segIndex = (vehicle.segIndex + 1) % vehicle.segments.length;
        vehicle.path = vehicle.segments[vehicle.segIndex];
        var start = vehicle.path[0];
        vehicle.pos = ctx.city.tileToWorld(start.x, start.y);
      } else {
        vehicle.waitUntilMin = sim.min + CitySim.utils.randInt(vehicle.rng, 0, 20);
      }
    }
  }

  function update(vehicle, sim, ctx) {
    var dtSim = sim.dtSimMin || 0;
    if (vehicle.kind === 'bus') {
      advanceTour(vehicle, dtSim, sim, ctx);
      return;
    }
    if (vehicle.path.length && vehicle.pathIndex < vehicle.path.length) {
      advanceTour(vehicle, dtSim, sim, ctx);
    } else if (sim.min >= vehicle.waitUntilMin) {
      startRoute(vehicle, sim, ctx);
    }
  }

  CitySim.vehicles = {
    create: create,
    startRoute: startRoute,
    update: update
  };
})(typeof window !== 'undefined' ? window : globalThis);