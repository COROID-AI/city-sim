/* CitySim camera — viewport math. Pure module (no DOM). */
(function (global) {
  'use strict';
  var CitySim = (global.CitySim = global.CitySim || {});

  function create(viewW, viewH) {
    return { x: 0, y: 0, zoom: 1, viewW: viewW, viewH: viewH };
  }

  function worldToScreen(cam, wx, wy) {
    return { x: (wx - cam.x) * cam.zoom, y: (wy - cam.y) * cam.zoom };
  }

  function screenToWorld(cam, sx, sy) {
    return { x: cam.x + sx / cam.zoom, y: cam.y + sy / cam.zoom };
  }

  function clampToBounds(cam, worldW, worldH) {
    var vw = cam.viewW / cam.zoom, vh = cam.viewH / cam.zoom;
    cam.x = CitySim.utils.clamp(cam.x, 0, Math.max(0, worldW - vw));
    cam.y = CitySim.utils.clamp(cam.y, 0, Math.max(0, worldH - vh));
  }

  function pan(cam, dxWorld, dyWorld) {
    cam.x += dxWorld;
    cam.y += dyWorld;
  }

  function zoomAt(cam, sx, sy, factor) {
    var before = screenToWorld(cam, sx, sy);
    cam.zoom = CitySim.utils.clamp(cam.zoom * factor, 0.5, 3);
    var after = screenToWorld(cam, sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }

  function visibleWorldRect(cam) {
    return { x: cam.x, y: cam.y, w: cam.viewW / cam.zoom, h: cam.viewH / cam.zoom };
  }

  function centerOn(cam, wx, wy, worldW, worldH) {
    cam.x = wx - cam.viewW / (2 * cam.zoom);
    cam.y = wy - cam.viewH / (2 * cam.zoom);
    clampToBounds(cam, worldW, worldH);
  }

  CitySim.camera = {
    create: create,
    worldToScreen: worldToScreen,
    screenToWorld: screenToWorld,
    clampToBounds: clampToBounds,
    pan: pan,
    zoomAt: zoomAt,
    visibleWorldRect: visibleWorldRect,
    centerOn: centerOn
  };
})(typeof window !== 'undefined' ? window : globalThis);