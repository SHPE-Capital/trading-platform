/**
 * eslint.config.js
 *
 * ESLint 9 flat config for the backend.
 *
 * The repo had eslint + @typescript-eslint installed and an `npm run lint`
 * script, but no config file — so linting has never actually run. ESLint 9
 * dropped .eslintrc support, and the flat format also makes the old
 * `--ext .ts` CLI flag redundant (file matching lives in `files` below).
 *
 * Node and Jest globals are declared explicitly rather than pulled from the
 * `globals` package, which is only present here as a transitive dependency of
 * eslint itself and shouldn't be relied on directly.
 */

const tsParser = require("@typescript-eslint/parser");
const tsPlugin = require("@typescript-eslint/eslint-plugin");

/** Globals available in the Node runtime this backend targets. */
const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  AbortController: "readonly",
  fetch: "readonly",
  Response: "readonly",
  Request: "readonly",
  Headers: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  queueMicrotask: "readonly",
  structuredClone: "readonly",
  NodeJS: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  module: "writable",
  require: "readonly",
  exports: "writable",
  global: "readonly",
};

/** Globals injected by Jest in test files. */
const jestGlobals = {
  jest: "readonly",
  describe: "readonly",
  it: "readonly",
  test: "readonly",
  expect: "readonly",
  beforeAll: "readonly",
  beforeEach: "readonly",
  afterAll: "readonly",
  afterEach: "readonly",
};

module.exports = [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "*.config.js"],
  },

  // ---------------------------------------------------------------------
  // Application code
  // ---------------------------------------------------------------------
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: nodeGlobals,
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,

      // Unused code is worth catching, but an underscore prefix is the
      // established way this codebase marks a deliberately-ignored binding
      // (e.g. `_intent` in riskEngine's check signatures).
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // `any` appears where Supabase rows and event payloads cross the
      // boundary untyped. Worth flagging as a warning to chip away at, not an
      // error that blocks the build today.
      "@typescript-eslint/no-explicit-any": "warn",

      // Real bug classes.
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
      "no-throw-literal": "error",

      // Console is the logger's own transport (utils/logger.ts) and the
      // backtest debug counters print through it deliberately.
      "no-console": "off",
    },
  },

  // ---------------------------------------------------------------------
  // Tests — same rules, plus the Jest globals and a little more latitude
  // ---------------------------------------------------------------------
  {
    files: ["src/tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: { ...nodeGlobals, ...jestGlobals },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Fixtures and mock shapes legitimately reach for `any` and non-null
      // assertions to stand in for wide third-party types.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": "off",
    },
  },
];
