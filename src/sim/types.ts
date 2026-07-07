/**
 * Core simulation type definitions.
 *
 * All types are pure data — no React, Canvas, or DOM dependencies.
 * Discriminated unions use a `kind` discriminant field for exhaustive
 * pattern matching in switch statements.
 */

// ─── Citizen State ───────────────────────────────────────────────────────────

/**
 * The finite-state machine a citizen cycles through each day.
 *
 * Daily schedule: HOME → COMMUTING → WORKING → COMMUTING → ENTERTAINMENT
 *                → RETURNING → HOME
 */
export type CitizenState =
  | { readonly kind: 'HOME'; buildingId: string }
  | {
      readonly kind: 'COMMUTING';
      readonly fromId: string;
      readonly toId: string;
      readonly progress: number;
    }
  | { readonly kind: 'WORKING'; buildingId: string }
  | { readonly kind: 'ENTERTAINMENT'; buildingId: string }
  | {
      readonly kind: 'RETURNING';
      readonly fromId: string;
      readonly toId: string;
      readonly progress: number;
    };

/** String-literal union of all citizen state kinds. */
export type CitizenStateKind = CitizenState['kind'];

// ─── Vehicle ─────────────────────────────────────────────────────────────────

/** Categorises vehicles for rendering and behaviour. */
export type VehicleKind = 'CAR' | 'TRUCK' | 'BUS' | 'MOTORCYCLE';

// ─── Building ────────────────────────────────────────────────────────────────

/** The functional purpose of a building. */
export type BuildingKind = 'HOME' | 'WORK' | 'ENTERTAINMENT';

// ─── Zone ────────────────────────────────────────────────────────────────────

/** High-level zoning designation for a region of the grid. */
export type Zone = 'RESIDENTIAL' | 'COMMERCIAL' | 'INDUSTRIAL' | 'MIXED';
