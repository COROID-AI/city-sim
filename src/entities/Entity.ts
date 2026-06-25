/**
 * Entity — abstract base class for all movable simulation actors
 * (Citizens, Vehicles) per spec §5.3.
 *
 * Provides a stable identity, a world-space position, and an abstract
 * `update()` hook that systems call once per GameLoop step.
 */
import type { Vector2 } from '@/engine/types';

/** Monotonically increasing id counter for default id generation. */
let nextEntityId = 0;

/** Prefix namespace for auto-generated entity ids. */
const ENTITY_ID_PREFIX = 'entity';

/**
 * Generate a unique entity id when none is supplied.
 * @returns A string of the form `entity-<n>`.
 */
function generateEntityId(): string {
  nextEntityId += 1;
  return `${ENTITY_ID_PREFIX}-${nextEntityId}`;
}

export abstract class Entity {
  /** Unique, immutable identifier for this entity. */
  readonly id: string;

  /** Current world-space position (mutable). */
  protected position: Vector2;

  /**
   * @param position Initial world-space position (defaults to origin).
   * @param id       Optional explicit id; auto-generated when omitted.
   */
  constructor(position: Vector2 = { x: 0, y: 0 }, id?: string) {
    this.id = id ?? generateEntityId();
    this.position = { ...position };
  }

  /** Current world-space position (returns a defensive copy). */
  getPosition(): Vector2 {
    return { ...this.position };
  }

  /** Set the world-space position. */
  setPosition(pos: Vector2): void {
    this.position = { x: pos.x, y: pos.y };
  }

  /**
   * Per-step update hook. Concrete subclasses implement their behaviour.
   *
   * @param deltaMs Simulation milliseconds since the last update.
   */
  abstract update(deltaMs: number): void;
}
