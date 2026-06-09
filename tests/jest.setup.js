// Jest setup — runs before every test suite.
//
// React 19's `act` from `react` requires `IS_REACT_ACT_ENVIRONMENT` to be
// truthy. Without this flag, calls to `act()` throw
//   "act(...) is not supported in production builds of React."
// The flag must be set on `globalThis` BEFORE the `react` module is
// required, so this file is registered via Jest's `setupFiles` (which
// runs before the test framework's transform pipeline).
// React 19's `act` export is only available in the development build
// of `react` (the production build throws "act(...) is not supported
// in production builds of React"). Force the dev build so tests can
// use `act`.
process.env.NODE_ENV = 'test';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
