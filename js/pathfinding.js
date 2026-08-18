/* CitySim pathfinding — A* over the tile grid. Pure module (no DOM). */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  function MinHeap() {
    this.a = [];
  }
  MinHeap.prototype.push = function (node) {
    var a = this.a;
    a.push(node);
    var i = a.length - 1;
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      var t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  };
  MinHeap.prototype.pop = function () {
    var a = this.a;
    if (a.length === 0) return undefined;
    var top = a[0];
    var last = a.pop();
    if (a.length > 0) {
      a[0] = last;
      var i = 0;
      for (;;) {
        var l = i * 2 + 1, r = l + 1, m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        var t = a[m]; a[m] = a[i]; a[i] = t;
        i = m;
      }
    }
    return top;
  };

  function heuristic(x, y, gx, gy) { return Math.abs(x - gx) + Math.abs(y - gy); }

  function reconstruct(came, start, goal, w) {
    var path = [];
    var cur = goal;
    while (cur !== -1) {
      path.push({ x: cur % w, y: Math.floor(cur / w) });
      if (cur === start) break;
      cur = came[cur];
    }
    path.reverse();
    return path;
  }

  // passable(x, y) decides which tiles can be entered.
  // Returns array of {x, y} way points or null.
  function findPath(city, sx, sy, tx, ty, passable) {
    var w = city.width, h = city.height;
    if (sx === tx && sy === ty) return [{ x: tx, y: ty }];
    if (!passable(tx, ty)) return null;

    var open = new MinHeap();
    var g = new Float32Array(w * h).fill(Infinity);
    var came = new Int32Array(w * h).fill(-1);
    var closed = new Uint8Array(w * h);
    var idx = function (x, y) { return y * w + x; };
    var start = idx(sx, sy);
    var goal = idx(tx, ty);
    g[start] = 0;
    open.push({ f: heuristic(sx, sy, tx, ty), x: sx, y: sy });

    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var guard = 0;
    while (open.a.length && guard++ < 40000) {
      var cur = open.pop();
      var ci = idx(cur.x, cur.y);
      if (closed[ci]) continue;
      closed[ci] = 1;
      if (ci === goal) return reconstruct(came, start, goal, w);
      for (var d = 0; d < 4; d++) {
        var nx = cur.x + dirs[d][0], ny = cur.y + dirs[d][1];
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        var ni = idx(nx, ny);
        if (closed[ni]) continue;
        if (!passable(nx, ny)) continue;
        var ng = g[ci] + 1;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = ci;
          open.push({ f: ng + heuristic(nx, ny, tx, ty), x: nx, y: ny });
        }
      }
    }
    return null;
  }

  // LRU path cache keyed "sx,sy->tx,ty|kind"
  var cache = new Map();
  var CACHE_MAX = 600;

  function cachedFindPath(city, sx, sy, tx, ty, passable, kind) {
    var key = sx + ',' + sy + '->' + tx + ',' + ty + '|' + kind;
    var hit = cache.get(key);
    if (hit !== undefined) {
      cache.delete(key);
      cache.set(key, hit);
      return hit;
    }
    var p = findPath(city, sx, sy, tx, ty, passable);
    if (cache.size >= CACHE_MAX) {
      var firstKey = cache.keys().next().value;
      cache.delete(firstKey);
    }
    cache.set(key, p);
    return p;
  }

  function clearCache() { cache.clear(); }

  CitySim.pathfinding = {
    findPath: findPath,
    cachedFindPath: cachedFindPath,
    clearCache: clearCache
  };
})(typeof window !== 'undefined' ? window : globalThis);