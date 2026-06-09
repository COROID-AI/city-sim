"use strict";
/**
 * Shared types for the city generation pipeline.
 *
 * All coordinates are integer cell coordinates on a 2D grid where
 * (0, 0) is the top-left cell and (width-1, height-1) is the bottom-right.
 * x increases rightward, y increases downward. This matches the
 * downstream renderer's expected convention.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZONE_IDS = void 0;
/** A list of all valid zone IDs. Order is stable for iteration. */
exports.ZONE_IDS = [
    'residential',
    'commercial',
    'industrial',
    'civic',
    'park',
];
