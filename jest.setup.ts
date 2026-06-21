import '@testing-library/jest-dom';

/**
 * Jest setup file.
 *
 * Imported via `setupFilesAfterEnv` in jest.config.js. Adds the
 * @testing-library/jest-dom matchers (toBeInTheDocument, toHaveAttribute, …)
 * to the global expect.
 *
 * NOTE: The global coverage threshold in jest.config.js is intentionally 0
 * during scaffolding. Downstream tasks add real tests under src/engine and
 * src/systems, at which point the per-glob 80% threshold is enforced.
 */
