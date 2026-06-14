/**
 * Zone layout for the procedurally generated city.
 *
 * A `Zone` is an axis-aligned rectangle carved out of the world bounds. The
 * canonical 80x80 layout is hand-tuned so the five required zones
 * (residential, commercial, industrial, entertainment, park) all fit with
 * a 2-tile border of road around them. The layout is exported as a pure
 * function of `bounds`, so the same seed always produces the same shapes.
 */

import type { WorldBounds } from '@/engine/types';

export type ZoneKind =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'entertainment'
  | 'park';

export interface Zone {
  readonly kind: ZoneKind;
  /** Inclusive top-left origin in tile coordinates. */
  readonly origin: { x: number; y: number };
  /** Inclusive bottom-right corner in tile coordinates. */
  readonly end: { x: number; y: number };
  /** Width in tiles. */
  readonly width: number;
  /** Height in tiles. */
  readonly height: number;
}

export interface LayoutOptions {
  /** Width of the road border (in tiles) drawn around every zone. */
  readonly roadWidth?: number;
  /** Minimum size of any zone, in tiles per side. */
  readonly minZoneSize?: number;
}

const DEFAULT_ROAD_WIDTH = 2;
const DEFAULT_MIN_ZONE_SIZE = 8;

/**
 * Compute the canonical 5-zone layout for a given world size.
 *
 * The 80x80 layout is:
 *  - residential:  top-left
 *  - commercial:   top-right
 *  - industrial:   bottom-left
 *  - entertainment: bottom-right
 *  - park:         centred horizontal strip
 *
 * The park is intentionally thin and may yield a small / zero-buildable
 * footprint — the spec allows that and downstream systems must tolerate it.
 */
export function computeZoneLayout(
  bounds: WorldBounds,
  options: LayoutOptions = {},
): Zone[] {
  const roadWidth = options.roadWidth ?? DEFAULT_ROAD_WIDTH;
  const minSize = options.minZoneSize ?? DEFAULT_MIN_ZONE_SIZE;
  const { width: W, height: H } = bounds;

  if (W < minSize * 2 + roadWidth * 3) {
    throw new RangeError(
      `World width ${W} is too small for 5-zone layout with min size ${minSize}`,
    );
  }
  if (H < minSize * 2 + roadWidth * 3) {
    throw new RangeError(
      `World height ${H} is too small for 5-zone layout with min size ${minSize}`,
    );
  }

  // Central horizontal strip for the park. Half the height minus road buffers.
  const parkH = Math.max(4, Math.floor(H * 0.15));
  const parkY = Math.floor((H - parkH) / 2);
  const parkX = roadWidth;
  const parkW = W - roadWidth * 2;

  // Top and bottom band heights, separated by the park strip + road buffer.
  const topBandEnd = parkY - roadWidth;
  const bottomBandStart = parkY + parkH + roadWidth;
  const topBandH = topBandEnd - roadWidth;
  const bottomBandH = H - roadWidth - bottomBandStart;

  // Within each band, split left/right with a vertical road.
  const colSplit = Math.floor(W / 2);
  const topLeftW = colSplit - roadWidth;
  const topRightX = colSplit + roadWidth;
  const topRightW = W - roadWidth - topRightX;
  const bottomLeftW = topLeftW;
  const bottomRightX = topRightX;
  const bottomRightW = topRightW;

  const zones: Zone[] = [
    mkZone(
      'residential',
      roadWidth,
      roadWidth,
      topLeftW,
      topBandH,
    ),
    mkZone(
      'commercial',
      topRightX,
      roadWidth,
      topRightW,
      topBandH,
    ),
    mkZone(
      'industrial',
      roadWidth,
      bottomBandStart,
      bottomLeftW,
      bottomBandH,
    ),
    mkZone(
      'entertainment',
      bottomRightX,
      bottomBandStart,
      bottomRightW,
      bottomBandH,
    ),
    mkZone(
      'park',
      parkX,
      parkY,
      parkW,
      parkH,
    ),
  ];

  return zones;
}

function mkZone(
  kind: ZoneKind,
  x: number,
  y: number,
  width: number,
  height: number,
): Zone {
  return {
    kind,
    origin: { x, y },
    end: { x: x + width - 1, y: y + height - 1 },
    width,
    height,
  };
}

/** True if the given tile is on the perimeter of the zone (1-tile border). */
export function isZoneBorder(zone: Zone, x: number, y: number): boolean {
  return (
    x === zone.origin.x ||
    x === zone.end.x ||
    y === zone.origin.y ||
    y === zone.end.y
  );
}
