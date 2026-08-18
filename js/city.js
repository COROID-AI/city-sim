/* CitySim city — tile grid generation. Pure module (no DOM). */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  var T = {
    GRASS: 0,
    ROAD: 1,
    WATER: 2,
    PARK: 3
  };

  function generate(cfg) {
    var w = cfg.cityTilesX, h = cfg.cityTilesY;
    var rng = CitySim.utils.mulberry32(cfg.seed);
    var tiles = new Uint8Array(w * h);           // terrain type
    var blocked = new Uint8Array(w * h);         // 1 = building footprint (impassable)

    function idx(x, y) { return y * w + x; }
    function inBounds(x, y) { return x >= 0 && x < w && y >= 0 && y < h; }

    // Water ponds (kept off the road grid so roads stay connected)
    var ponds = 3;
    for (var p = 0; p < ponds; p++) {
      var cx = 3 + Math.floor(rng() * (w - 6));
      var cy = 3 + Math.floor(rng() * (h - 6));
      var rad = 3 + Math.floor(rng() * 4);
      for (var dy = -rad; dy <= rad; dy++) {
        for (var dx = -rad; dx <= rad; dx++) {
          var x = cx + dx, y = cy + dy;
          if (!inBounds(x, y)) continue;
          if (x % cfg.roadSpacing === 0 || y % cfg.roadSpacing === 0) continue;
          if (dx * dx + dy * dy <= rad * rad) tiles[idx(x, y)] = T.WATER;
        }
      }
    }

    // Parks: scattered grass patches
    var parks = 10;
    for (var k = 0; k < parks; k++) {
      var px = 1 + Math.floor(rng() * (w - 2));
      var py = 1 + Math.floor(rng() * (h - 2));
      var pr = 1 + Math.floor(rng() * 2);
      for (var dy2 = -pr; dy2 <= pr; dy2++) {
        for (var dx2 = -pr; dx2 <= pr; dx2++) {
          var x2 = px + dx2, y2 = py + dy2;
          if (!inBounds(x2, y2)) continue;
          if (tiles[idx(x2, y2)] === T.GRASS) tiles[idx(x2, y2)] = T.PARK;
        }
      }
    }

    // Roads: grid
    var roadTiles = [];
    var intersections = [];
    var spacing = cfg.roadSpacing;
    for (var x3 = spacing; x3 < w; x3 += spacing) {
      for (var y3 = 0; y3 < h; y3++) {
        tiles[idx(x3, y3)] = T.ROAD;
        roadTiles.push({ x: x3, y: y3 });
      }
    }
    for (var y4 = spacing; y4 < h; y4 += spacing) {
      for (var x4 = 0; x4 < w; x4++) {
        tiles[idx(x4, y4)] = T.ROAD;
        roadTiles.push({ x: x4, y: y4 });
      }
    }
    for (var xi = spacing; xi < w; xi += spacing) {
      for (var yi = spacing; yi < h; yi += spacing) {
        intersections.push({ x: xi, y: yi });
      }
    }

    function isRoad(x, y) { return inBounds(x, y) && tiles[idx(x, y)] === T.ROAD; }
    function isWater(x, y) { return inBounds(x, y) && tiles[idx(x, y)] === T.WATER; }
    function isPark(x, y) { return inBounds(x, y) && tiles[idx(x, y)] === T.PARK; }
    function isBlocked(x, y) { return !inBounds(x, y) || blocked[idx(x, y)] === 1; }

    function isPassableCitizen(x, y) {
      if (!inBounds(x, y)) return false;
      if (blocked[idx(x, y)] === 1) return false;
      var t = tiles[idx(x, y)];
      return t === T.GRASS || t === T.ROAD || t === T.PARK;
    }

    function isPassableVehicle(x, y) { return isRoad(x, y); }

    function tileToWorld(tx, ty) {
      return { x: (tx + 0.5) * cfg.tileSize, y: (ty + 0.5) * cfg.tileSize };
    }

    function worldToTile(px, py) {
      return { x: Math.floor(px / cfg.tileSize), y: Math.floor(py / cfg.tileSize) };
    }

    return {
      width: w,
      height: h,
      tiles: tiles,
      blocked: blocked,
      rng: rng,
      tileAt: function (x, y) { return inBounds(x, y) ? tiles[idx(x, y)] : T.WATER; },
      isRoad: isRoad,
      isWater: isWater,
      isPark: isPark,
      isBlocked: isBlocked,
      isPassableCitizen: isPassableCitizen,
      isPassableVehicle: isPassableVehicle,
      roadTiles: roadTiles,
      intersections: intersections,
      tileToWorld: tileToWorld,
      worldToTile: worldToTile,
      worldWidth: w * cfg.tileSize,
      worldHeight: h * cfg.tileSize,
      tileTypeName: function (x, y) {
        var t = tiles[idx(x, y)];
        return t === T.ROAD ? 'Road' : t === T.WATER ? 'Water' : t === T.PARK ? 'Park' : 'Ground';
      }
    };
  }

  CitySim.city = { generate: generate, T: T };
})(typeof window !== 'undefined' ? window : globalThis);