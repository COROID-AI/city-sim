/* CitySim utils — pure helpers. */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function dist(ax, ay, bx, by) { return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }
  function distSq(ax, ay, bx, by) { return (ax - bx) * (ax - bx) + (ay - by) * (ay - by); }
  function rand(rng, lo, hi) { return lo + (hi - lo) * rng(); }
  function randInt(rng, lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function chance(rng, p) { return rng() < p; }

  function formatTime(minutesOfDay) {
    var m = Math.floor(minutesOfDay) % 1440;
    if (m < 0) m += 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm;
  }

  var WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  function weekdayName(day) { return WEEKDAYS[((day - 1) % 7 + 7) % 7]; }

  function formatMoney(n) {
    var v = Math.round(n);
    var sign = v < 0 ? '-' : '';
    v = Math.abs(v);
    if (v >= 1000000) return sign + '$' + (v / 1000000).toFixed(2) + 'M';
    if (v >= 1000) return sign + '$' + (v / 1000).toFixed(1) + 'k';
    return sign + '$' + v;
  }

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function pointInRect(px, py, r) {
    return px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h;
  }

  CitySim.utils = {
    mulberry32: mulberry32,
    hashString: hashString,
    clamp: clamp,
    lerp: lerp,
    dist: dist,
    distSq: distSq,
    rand: rand,
    randInt: randInt,
    pick: pick,
    chance: chance,
    formatTime: formatTime,
    weekdayName: weekdayName,
    formatMoney: formatMoney,
    rectsOverlap: rectsOverlap,
    pointInRect: pointInRect
  };
})(typeof window !== 'undefined' ? window : globalThis);