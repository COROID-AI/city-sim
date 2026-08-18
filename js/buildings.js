/* CitySim buildings — placement and definitions. Pure module (no DOM). */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  var TYPE_DEFS = {
    residential: {
      subtypes: ['House', 'Apartment', 'Cottage', 'Villa'],
      minW: 2, maxW: 3, minH: 2, maxH: 3,
      jobs: 0,
      capacity: [4, 10]
    },
    commercial: {
      subtypes: ['Shop', 'Office', 'Cafe', 'Bank', 'Clinic'],
      minW: 2, maxW: 2, minH: 2, maxH: 2,
      jobs: [3, 9],
      capacity: 0
    },
    entertainment: {
      subtypes: ['Cinema', 'Restaurant', 'Bar', 'Theater', 'Gym', 'Park Pavilion'],
      minW: 2, maxW: 3, minH: 2, maxH: 3,
      jobs: [3, 8],
      capacity: 0
    },
    industrial: {
      subtypes: ['Factory', 'Warehouse', 'Workshop'],
      minW: 3, maxW: 4, minH: 3, maxH: 4,
      jobs: [8, 20],
      capacity: 0
    }
  };

  var NAMES = {
    residential: ['Maple', 'Cedar', 'Oak', 'Willow', 'Birch', 'Hazel', 'Juniper', 'Laurel', 'Aspen', 'Rowan', 'Fern', 'Ivy', 'Meadow', 'Pine', 'Elm'],
    commercial: ['Corner', 'Central', 'Grand', 'Northside', 'Sunrise', 'Blue', 'Golden', 'Silver', 'Union', 'Civic', 'Harbor', 'Summit'],
    entertainment: ['Starlight', 'Moon', 'Comet', 'Oasis', 'Pavilion', 'Riverside', 'Fox', 'Anchor', 'Beacon', 'Velvet'],
    industrial: ['Iron', 'Steel', 'Forge', 'Summit', 'Delta', 'Orion', 'Meridian', 'Atlas', 'Vulcan', 'Keystone']
  };

  function randName(rng, type) {
    var list = NAMES[type];
    return CitySim.utils.pick(rng, list) + ' ' + CitySim.utils.pick(rng, TYPE_DEFS[type].subtypes);
  }

  function inRange(city, p) {
    return p.x >= 0 && p.x < city.width && p.y >= 0 && p.y < city.height;
  }

  function findEntrance(city, b) {
    var candidates = [];
    for (var x = b.x; x < b.x + b.w; x++) {
      var up = { x: x, y: b.y - 1 };
      var down = { x: x, y: b.y + b.h };
      if (inRange(city, up) && city.isPassableCitizen(up.x, up.y)) candidates.push(up);
      if (inRange(city, down) && city.isPassableCitizen(down.x, down.y)) candidates.push(down);
    }
    for (var y = b.y; y < b.y + b.h; y++) {
      var left = { x: b.x - 1, y: y };
      var right = { x: b.x + b.w, y: y };
      if (inRange(city, left) && city.isPassableCitizen(left.x, left.y)) candidates.push(left);
      if (inRange(city, right) && city.isPassableCitizen(right.x, right.y)) candidates.push(right);
    }
    if (!candidates.length) {
      return { x: b.x + Math.floor(b.w / 2), y: b.y + Math.floor(b.h / 2) };
    }
    var roadPref = candidates.filter(function (c) { return city.isRoad(c.x, c.y); });
    var pool = roadPref.length ? roadPref : candidates;
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    var best = pool[0], bd = Infinity;
    for (var i = 0; i < pool.length; i++) {
      var d = CitySim.utils.distSq(pool[i].x + 0.5, pool[i].y + 0.5, cx, cy);
      if (d < bd) { bd = d; best = pool[i]; }
    }
    return best;
  }

  function create(cfg, city) {
    var utils = CitySim.utils;
    var rng = city.rng;
    var buildings = [];
    var id = 0;

    function tryPlace(type, tx, ty) {
      var def = TYPE_DEFS[type];
      var w = utils.randInt(rng, def.minW, def.maxW);
      var h = utils.randInt(rng, def.minH, def.maxH);
      if (tx + w >= city.width || ty + h >= city.height) return null;
      for (var y = ty; y < ty + h; y++) {
        for (var x = tx; x < tx + w; x++) {
          if (city.isBlocked(x, y)) return null;
          var t = city.tileAt(x, y);
          if (t === CitySim.city.T.ROAD || t === CitySim.city.T.WATER) return null;
        }
      }
      return { w: w, h: h };
    }

    // Scan the map in blocks, trying to place a building per block.
    var step = 4;
    for (var by = 1; by + 3 < city.height; by += step) {
      for (var bx = 1; bx + 3 < city.width; bx += step) {
        if (buildings.length >= cfg.buildings) break;
        if (city.isBlocked(bx, by)) continue;
        var t0 = city.tileAt(bx, by);
        if (t0 === CitySim.city.T.ROAD || t0 === CitySim.city.T.WATER) continue;

        var r = rng();
        var type = r < 0.42 ? 'residential' : r < 0.64 ? 'commercial' : r < 0.80 ? 'entertainment' : 'industrial';
        var size = tryPlace(type, bx, by);
        if (!size) continue;

        var def = TYPE_DEFS[type];
        var b = {
          id: id++,
          type: type,
          name: randName(rng, type),
          x: bx,
          y: by,
          w: size.w,
          h: size.h,
          entrance: null,
          jobs: def.jobs === 0 ? 0 : utils.randInt(rng, def.jobs[0], def.jobs[1]),
          capacity: type === 'residential' ? utils.randInt(rng, def.capacity[0], def.capacity[1]) : 0,
          companyId: null,
          residents: []
        };
        for (var y2 = by; y2 < by + size.h; y2++) {
          for (var x2 = bx; x2 < bx + size.w; x2++) city.blocked[y2 * city.width + x2] = 1;
        }
        b.entrance = findEntrance(city, b);
        buildings.push(b);
      }
    }
    return buildings;
  }

  function entranceWorld(city, b) {
    return city.tileToWorld(b.entrance.x, b.entrance.y);
  }

  function buildingById(buildings, id) {
    for (var i = 0; i < buildings.length; i++) {
      if (buildings[i].id === id) return buildings[i];
    }
    return null;
  }

  CitySim.buildings = {
    create: create,
    entranceWorld: entranceWorld,
    buildingById: buildingById,
    TYPE_DEFS: TYPE_DEFS
  };
})(typeof window !== 'undefined' ? window : globalThis);