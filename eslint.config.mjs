import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Lint configuration. ESLint checks correctness only; Prettier owns layout,
 * so no formatting rule appears here. Each block maps to a rule written down
 * in docs/coding-standards.md; rules a machine cannot check stay in that
 * document instead of being approximated here.
 */

// --- Shared values ----------------------------------------------------------

/** Files nobody here writes by hand. */
const NOT_OURS = [
  ...[".next", "out", "build"].map((dir) => `${dir}/**`), // build output
  "next-env.d.ts", // written by Next
  "generated/**", // Prisma client output
  ".open-twin/**", // synced checkout, linted where it lives
  "python/.venv/**", // uv's environment (matplotlib ships JavaScript)
  "data/**", // local, gitignored data and scratch files
];

/**
 * Any `process.env.X` (dot or bracket form) except NODE_ENV and NEXT_RUNTIME,
 * which describe the runtime rather than configure the app.
 */
const RUNTIME_FLAGS = ["NODE_ENV", "NEXT_RUNTIME"];
const envReadSelector = [
  "MemberExpression[object.object.name='process'][object.property.name='env']",
  ...RUNTIME_FLAGS.flatMap((flag) => [
    `:not([property.name='${flag}'])`,
    `:not([property.value='${flag}'])`,
  ]),
].join("");

/** jsx-a11y rules raised to errors: the accessibility floor for every screen. */
const A11Y_FLOOR = [
  "alt-text",
  "anchor-has-content",
  "anchor-is-valid",
  "aria-props",
  "aria-proptypes",
  "aria-role",
  "click-events-have-key-events",
  "heading-has-content",
  "interactive-supports-focus",
  "label-has-associated-control",
  "no-noninteractive-element-interactions",
  "no-static-element-interactions",
  "role-has-required-aria-props",
];

/** Rules switched on with no options. */
const asErrors = (names) => Object.fromEntries(names.map((name) => [name, "error"]));

/** Rules switched on with options: `{ rule: options }`. */
const asErrorsWith = (table) =>
  Object.fromEntries(
    Object.entries(table).map(([name, options]) => [name, ["error", options]]),
  );

/** Both alias forms (`@/x/*`, `@/x/**`) for each top-level folder. */
const aliasesOf = (...folders) =>
  folders.flatMap((folder) => [`@/${folder}/*`, `@/${folder}/**`]);

/**
 * Wearable adapters are reached through their folder's entry module only
 * (`@/infrastructure/open-twin-adapters`), never a file inside it (#463).
 */
const ADAPTER_ENTRY = {
  group: ["**/open-twin-adapters/*"],
  message:
    "Import the wearable adapters from @/infrastructure/open-twin-adapters, not a file inside it.",
};

const banImports = (patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const FEATURE_SOURCES = "features/**/*.{ts,tsx}";

/** Features that still compose pieces from sibling features (see boundary-debt). */
const BOUNDARY_DEBT_FEATURES = [
  "arena",
  "auth",
  "digital-twin",
  "google-health",
  "leaderboard",
  "oura",
  "shell",
  "vitronic",
  "wearables",
  "whoop",
];
const INFRASTRUCTURE_SOURCES = "infrastructure/**/*.ts";

// --- Config -----------------------------------------------------------------

export default defineConfig([
  globalIgnores(NOT_OURS),
  ...[nextVitals, nextTs].flat(),

  {
    name: "twin-llm/typescript-and-style",
    rules: {
      // No `any`; `const` by default; nothing reassigned in place.
      ...asErrors(["@typescript-eslint/no-explicit-any", "prefer-const", "no-var"]),
      ...asErrorsWith({
        "@typescript-eslint/consistent-type-imports": { fixStyle: "inline-type-imports" },
        "@typescript-eslint/no-unused-vars": {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
        "no-param-reassign": { props: true },
        eqeqeq: "smart",
      }),
      // console.error / console.warn carry real failures to the server log;
      // anything else is leftover debugging. Warnings fail the lint run.
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-restricted-syntax": [
        "error",
        {
          selector: envReadSelector,
          message:
            "Configuration comes from serverEnv() (infrastructure/env.ts) or publicEnv (infrastructure/public-env.ts); reading process.env directly skips startup validation.",
        },
      ],
    },
  },

  {
    name: "twin-llm/accessibility-floor",
    rules: {
      ...asErrors(A11Y_FLOOR.map((rule) => `jsx-a11y/${rule}`)),
      ...asErrorsWith({ "jsx-a11y/no-autofocus": { ignoreNonDOM: true } }),
    },
  },

  {
    // A feature is a walled folder: its own files by relative path, shared
    // code from infrastructure/, never another feature and never app/.
    name: "twin-llm/feature-walls",
    files: [FEATURE_SOURCES],
    rules: banImports([
      {
        group: aliasesOf("app"),
        message: "Features never import routes or layouts; app/ composes features.",
      },
      {
        group: aliasesOf("features"),
        message:
          "Use a relative path inside this feature. Code two features share belongs in infrastructure/.",
      },
      {
        group: ["../*/**"], // a relative path out of the feature folder
        message:
          "This path climbs out of the feature folder; shared code lives in @/infrastructure/*.",
      },
      ADAPTER_ENTRY,
    ]),
  },

  {
    // The bottom layer depends on nothing above it.
    name: "twin-llm/infrastructure-floor",
    files: [INFRASTRUCTURE_SOURCES],
    rules: banImports([
      {
        group: aliasesOf("app", "features"),
        message: "infrastructure/ may not import features or routes.",
      },
      ADAPTER_ENTRY,
    ]),
  },

  {
    // Allowed to read process.env: the two config modules, their tests, and
    // files that run outside Next (config files, scripts).
    name: "twin-llm/env-readers",
    files: [
      ...["env.ts", "public-env.ts", "**/*.test.ts"].map(
        (file) => `infrastructure/${file}`,
      ),
      "features/leaderboard/leaderboard-screen.tsx",
      "*.config.{ts,mjs}",
      "scripts/**/*.{ts,mjs}",
    ],
    rules: { "no-restricted-syntax": "off", "no-console": "off" },
  },

  {
    // Known boundary debt: these folders still compose pieces from sibling
    // features. Tracked as follow-up work; listed so CI stays green meanwhile.
    name: "twin-llm/boundary-debt",
    files: [
      "app/api/**/*.{ts,tsx}",
      ...BOUNDARY_DEBT_FEATURES.map((feature) => `features/${feature}/**/*.{ts,tsx}`),
    ],
    rules: {
      "no-restricted-imports": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },

  {
    // The adapter entry rule for everything the blocks above leave without
    // one: routes, boundary-debt features, packages, scripts and tests. Last,
    // so it is back on where boundary-debt switched the rule off.
    name: "twin-llm/wearable-entry",
    files: [
      "app/**/*.{ts,tsx}",
      ...BOUNDARY_DEBT_FEATURES.map((feature) => `features/${feature}/**/*.{ts,tsx}`),
      "{packages,scripts,tests,evaluation}/**/*.{ts,tsx,mjs}",
      "*.{ts,mjs}",
    ],
    rules: banImports([ADAPTER_ENTRY]),
  },
]);
