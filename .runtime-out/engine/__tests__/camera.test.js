"use strict";
/**
 * Camera math tests.
 *
 * These cover the deterministic behaviors of Camera (pan/zoom/anchoring)
 * that the renderer and input layer depend on. We avoid the smoothing
 * code by either snapping to target or by using zero dt in `update`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
/// <reference types="jest" />
const index_1 = require("../index");
describe('Camera', () => {
    test('initial transform equals the configured initial state', () => {
        const cam = new index_1.Camera({
            ...index_1.DEFAULT_CAMERA_CONFIG,
            initial: { x: 5, y: 7, zoom: 2 },
        });
        const t = cam.getTransform();
        expect(t.x).toBe(5);
        expect(t.y).toBe(7);
        expect(t.zoom).toBe(2);
    });
    test('pan clamps to configured bounds', () => {
        const cam = new index_1.Camera({
            ...index_1.DEFAULT_CAMERA_CONFIG,
            minX: 0,
            maxX: 10,
            minY: 0,
            maxY: 10,
        });
        cam.pan(100, 100);
        cam.snap();
        const t = cam.getTransform();
        expect(t.x).toBe(10);
        expect(t.y).toBe(10);
        cam.pan(-1000, -1000);
        cam.snap();
        const t2 = cam.getTransform();
        expect(t2.x).toBe(0);
        expect(t2.y).toBe(0);
    });
    test('setPosition is absolute and clamps', () => {
        const cam = new index_1.Camera({
            ...index_1.DEFAULT_CAMERA_CONFIG,
            minX: -5,
            maxX: 5,
            minY: -5,
            maxY: 5,
        });
        cam.setPosition(3, -2);
        cam.snap();
        expect(cam.getTransform().x).toBe(3);
        expect(cam.getTransform().y).toBe(-2);
        cam.setPosition(99, 99);
        cam.snap();
        expect(cam.getTransform().x).toBe(5);
        expect(cam.getTransform().y).toBe(5);
    });
    test('zoomBy is multiplicative and clamped to min/max zoom', () => {
        const cam = new index_1.Camera({
            ...index_1.DEFAULT_CAMERA_CONFIG,
            minZoom: 0.5,
            maxZoom: 4,
        });
        cam.zoomBy(2); // 1 * 2 = 2
        cam.snap();
        expect(cam.getTransform().zoom).toBe(2);
        cam.zoomBy(2); // 2 * 2 = 4 (at max)
        cam.snap();
        expect(cam.getTransform().zoom).toBe(4);
        cam.zoomBy(2); // would be 8, clamps to 4
        cam.snap();
        expect(cam.getTransform().zoom).toBe(4);
        cam.zoomBy(0.1); // 4 * 0.1 = 0.4, clamps to 0.5
        cam.snap();
        expect(cam.getTransform().zoom).toBe(0.5);
    });
    test('zoomAt keeps the anchor world point under the screen point', () => {
        // Construct a camera focused at (0,0) at zoom 1, no clamping.
        const cam = new index_1.Camera({
            ...index_1.DEFAULT_CAMERA_CONFIG,
            minX: -Infinity,
            maxX: Infinity,
            minY: -Infinity,
            maxY: Infinity,
            minZoom: 0.25,
            maxZoom: 8,
        });
        // Anchor: the screen-relative point (0.25, 0.75) (i.e. left, down).
        const anchorX = 0.25;
        const anchorY = 0.75;
        // World point under the anchor at zoom 1: (anchor - 0.5) / zoom + cam
        // = (0.25 - 0.5, 0.75 - 0.5) + (0,0) = (-0.25, 0.25).
        const worldXBefore = -0.25;
        const worldYBefore = 0.25;
        // Zoom in 2x.
        cam.zoomAt(2, anchorX, anchorY);
        cam.snap();
        // After zoom, the same world point should still be at the anchor.
        // sx = (wx - cam.x) * zoom + 0.5
        const t = cam.getTransform();
        const sx = (worldXBefore - t.x) * t.zoom + 0.5;
        const sy = (worldYBefore - t.y) * t.zoom + 0.5;
        expect(sx).toBeCloseTo(anchorX, 6);
        expect(sy).toBeCloseTo(anchorY, 6);
    });
    test('worldToScreen maps world (cam.x, cam.y) to screen center (0.5, 0.5)', () => {
        const cam = new index_1.Camera();
        cam.setPosition(10, 20);
        cam.setZoom(1.5);
        cam.snap();
        const { sx, sy } = cam.worldToScreen(10, 20);
        expect(sx).toBeCloseTo(0.5, 10);
        expect(sy).toBeCloseTo(0.5, 10);
    });
    test('worldToScreen applies zoom', () => {
        const cam = new index_1.Camera();
        cam.setPosition(0, 0);
        cam.setZoom(2);
        cam.snap();
        // 1 world unit right of the camera, at zoom 2, is 2 screen units
        // right of center, i.e. sx = 0.5 + 2.
        const { sx } = cam.worldToScreen(1, 0);
        expect(sx).toBeCloseTo(2.5, 10);
    });
    test('update(0) does not move the camera', () => {
        const cam = new index_1.Camera();
        cam.setPosition(3, 4);
        cam.setZoom(2);
        cam.snap();
        const before = cam.getTransform();
        cam.update(0);
        const after = cam.getTransform();
        expect(after.x).toBe(before.x);
        expect(after.y).toBe(before.y);
        expect(after.zoom).toBe(before.zoom);
    });
    test('update with large dt approaches target (frame-rate independent)', () => {
        const cam = new index_1.Camera();
        cam.setPosition(10, 0);
        cam.snap();
        // A single very large dt should converge to within float tolerance.
        cam.update(10);
        const t = cam.getTransform();
        expect(t.x).toBeCloseTo(10, 5);
    });
    test('getTarget reflects input even before smoothing', () => {
        const cam = new index_1.Camera();
        cam.setPosition(7, 8);
        cam.zoomBy(2);
        const tgt = cam.getTarget();
        expect(tgt.x).toBe(7);
        expect(tgt.y).toBe(8);
        expect(tgt.zoom).toBe(2);
        const cur = cam.getTransform();
        // current is still the initial {0,0,1} until snap/update.
        expect(cur.x).toBe(0);
        expect(cur.y).toBe(0);
        expect(cur.zoom).toBe(1);
    });
});
