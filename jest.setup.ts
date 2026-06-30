/**
 * Jest test setup.
 *
 * Imported once per test suite via `setupFilesAfterEach` in jest.config.mjs.
 * Adds the @testing-library/jest-dom matchers (toBeInTheDocument, etc.) to the
 * global `expect` so component tests can use them without per-file imports.
 */
import '@testing-library/jest-dom';
