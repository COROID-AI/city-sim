/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  // Source files use explicit `.js` extensions on relative imports so the
  // compiled output loads as native ES modules in the browser (no bundler).
  // Jest needs the extensions stripped so its resolver finds the `.ts` files.
  moduleNameMapper: {
    "^(\\.{1,2}/.+)\\.js$": "$1",
  },
};
