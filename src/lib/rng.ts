/**
 * Public barrel for utility helpers.
 *
 * Kept tiny on purpose; we want to avoid an accidental
 * "utils" dumping ground that pulls DOM-only deps into the systems layer.
 */
export { createRng, type Rng } from './_createRng';
