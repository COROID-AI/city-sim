/**
 * Snake game core — public barrel.
 * Exports all shared types, config constants, and pure game functions so the
 * renderer and input layers can import from a single module.
 */
export * from './types';
export { spawnFood } from './food';
export { createInitialState, tick, setDirection } from './snake';
