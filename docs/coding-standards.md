# Coding standards

TwinLLM has two kinds of rules. Some are checked by a tool on every change; the rest
need a reviewer. This page says which is which, so nobody assumes a linter is catching
something it is not. When a rule here and `eslint.config.mjs` disagree, the config is
what actually runs; fix whichever one is wrong.

## Commands

| Command                  | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `bun run typecheck`      | `tsc --noEmit` over the whole project                |
| `bun run lint`           | ESLint with `--max-warnings=0`: any warning fails    |
| `bun run lint:claims`    | Banned product-claim wording (see `CONTRIBUTING.md`) |
| `bun run test`           | Unit tests                                           |
| `bun run test:isolation` | Test folders that must also pass in their own run    |
| `bun run format`         | Prettier rewrites files in place                     |
| `bun run format:check`   | Prettier reports files it would change               |
| `bun run build`          | Production Next.js build                             |

Run typecheck, lint and build before you call a change finished.

## Formatting

Prettier decides layout and ESLint decides correctness. ESLint has no formatting rules
and Prettier is not run through ESLint, so a lint failure always means a real problem.

`prettier.config.mjs` sets a print width of 90 and loads `prettier-plugin-tailwindcss`, which
puts Tailwind classes in a fixed order. Everything else is Prettier's default.
`.prettierignore` keeps Prettier away from files we do not author or that must stay
byte-exact: `generated/`, `prisma/migrations/`, `public/`, `third_party/`, lockfiles,
the Synthea fixtures and the Ark goldens. ESLint ignores `generated/` and `.open-twin/`.

## Git hooks

`bun install` sets up Husky:

- **pre-commit** runs lint-staged (`.lintstagedrc.json`): `eslint --fix --max-warnings=0`
  and then Prettier on staged code under `app/`, `features/`, `infrastructure/` and
  `scripts/`, and Prettier alone on staged Markdown, JSON and CSS.
- **pre-push** runs `bun run typecheck`.

The commit hook only touches staged files so that it stays quick enough that nobody
reaches for `--no-verify`. The full typecheck waits for the push.

## Checked by ESLint

**TypeScript.** `any` is an error (`@typescript-eslint/no-explicit-any`). Type-only
imports use the inline form, `import { type Thing, value } from "…"`. Unused variables
and arguments are errors unless the name starts with `_`.

**No reassignment.** `prefer-const`, `no-var` and `no-param-reassign` with `props: true`
are errors. Build new values with `map`, `filter`, `reduce` or spreads instead of
mutating what you were given.

**Equality.** `eqeqeq` in `smart` mode: `===` everywhere, except `== null` to test for
both `null` and `undefined`.

**Logging.** `console.error` and `console.warn` are allowed; anything else from
`console` is a warning, and warnings fail lint. Scripts under `scripts/` may log freely.

**Configuration.** Reading `process.env.SOMETHING` is an error outside
`infrastructure/env.ts` (server, through `serverEnv()`) and
`infrastructure/public-env.ts` (browser, through `publicEnv`). Those two modules check
required variables when the app starts, so a missing value stops the app with a clear
message instead of failing later inside a request. `NODE_ENV` and `NEXT_RUNTIME` may be
read anywhere. Config files, scripts and `proxy.ts` run outside the app and are exempt.

**Layers.** `no-restricted-imports` keeps the folders in one direction:

1. `app/` holds routes and layouts. It may import from `features/` and
   `infrastructure/`. Nothing imports from `app/`.
2. `features/<name>/` holds one product area. Files inside it import each other with
   relative paths. A feature does not import another feature, either through
   `@/features/…` or by climbing out with `../`. Code two features need moves down to
   `infrastructure/`.
3. `infrastructure/` is shared code with no knowledge of features or routes.

Some feature folders still have this rule switched off while they are being separated;
`eslint.config.mjs` lists them. Do not add to that list.

**Accessibility.** These `jsx-a11y` rules are errors: `alt-text`, `anchor-has-content`,
`anchor-is-valid`, `aria-props`, `aria-proptypes`, `aria-role`,
`click-events-have-key-events`, `heading-has-content`, `interactive-supports-focus`,
`label-has-associated-control`, `no-autofocus`, `no-noninteractive-element-interactions`,
`no-static-element-interactions` and `role-has-required-aria-props`.

## Checked in review

No lint rule can check these well, so a reviewer does.

**Errors shown to people.** A person sees a short plain sentence and, where it makes
sense, a way to retry. The underlying exception, provider message or response body goes
to the server log with `console.error` and nowhere else.

**Configuration and connections are opened lazily.** Read config and create clients
inside a function that caches its result on first call, never at module top level.
`next build` loads route modules, and a top-level read would make the build need real
secrets. `serverEnv()` and the database client already work this way.

**Effects stay at the edges.** Helpers are pure functions. Network calls, database
writes and logging happen in route handlers, server actions and functions whose names
say they do I/O. When a module has both pure logic and a fetch, split it into two files
and mark the fetching one `server-only`, so client code can use the pure half.

**Tests.**

- Assert exact values, not counts or truthiness.
- Pass fakes into the code under test (a handler factory such as
  `createWearablesSummaryHandler`). Do not use `mock.module` in new tests: Bun keeps the
  replacement for later test files in the same process, so results start depending on
  file order. `bun run test:isolation` runs the affected folders on their own as a
  check.
- `bunfig.toml` already preloads a `server-only` stub; do not add another.

**Data.** Use synthetic or fixture data for development, tests, screenshots and
recordings. Do not open, print or copy real personal data: `data/vitronic/**`, real
people's database rows, wearable exports or `.env.local` values. The running app can
still show someone their own data on their own machine. A missing measurement stays
missing; never turn it into `0`.

**Repeated styling.** When the same group of Tailwind classes turns up in a third place,
make it a component in `infrastructure/ui-kit/` or a class in `app/globals.css`.

**Accessibility the linter cannot see.** Check contrast, a visible focus ring and full
keyboard use by eye, in the light and the dark theme.

**three.js.** three.js is built around mutating materials, uniforms and shaders. Do
that in one `Object.assign(...)` call with a comment explaining it, not by assigning to
a parameter's fields one by one. Keep per-object state in a module-level `WeakMap` keyed
by the object rather than in `userData`. See
`features/digital-twin/anatomy/layer-material.ts`.

## Files and names

- Group code by product area (`features/wearables/`), not by kind (no global `hooks/`
  or `types/` folders).
- File names are `kebab-case` and match the main export: `format-measure.ts` exports
  `formatMeasure`.
- React components are `PascalCase`; other values and functions are `camelCase`.
  Prefer `const name = (…) => …` to `function` declarations.
- Prefer `type` to `interface`. Mark data types `Readonly` when they are not meant to
  change.
- Start a module with a short comment when its shape needs explaining: why it is split
  the way it is, what it must never do. Do not restate what the code says.
- UI primitives live in
  `infrastructure/ui-kit/`, because every feature has to be able to import them.

## UI kit

Use these from `infrastructure/ui-kit/` before writing classes by hand:

- **`Button`** for every action. Variants: `primary` (the one main action on a screen),
  `secondary` (the default), `ghost` (quiet, such as Unlink) and `pill` (a small inline
  choice). `buttonClassName(...)` styles a link as a button.
- **`SegmentedControl`** for a set of exclusive options that apply immediately. It sets
  `aria-pressed`. A server-rendered group of links uses the `.segmented` and
  `.segmented-item` classes with `aria-current` instead.
- **`Field`** for a labelled input or select. It connects the label, hint and error for
  screen readers. A placeholder never replaces the label.
- **`Tabs`** for panels of one view, with Radix roles and arrow-key navigation.
- **`StatusBadge`** for a connection or job state. It always has text; the tone (`ok`,
  `warn`, `neutral`, `off`) only adds to it.
- **`Card`** for a framed block on `.surface`, with `sm`, `md` or `lg` padding.
- **`Legend`** for the series names of a chart. Only the swatch is coloured.

Charts use `text-chart-1` to `text-chart-5`, in that order. `primary` marks things you
can click, so it is never a data colour. `chart-tokens.test.ts` checks each chart colour
against the card background in both themes.

Colours and typefaces follow the Open Science Foundation brand guide as described in
[`docs/brand.md`](brand.md); `brand-tokens.test.ts` checks the tokens. Fonts are
installed with `bun run fonts:install` and are never committed.

## Showing numbers and dates

All display formatting goes through `infrastructure/format-measure.ts`, which has no I/O
and works the same on server and client.

- Use `formatMeasure(kind, value)` for a value with a known kind (heart rate, HRV,
  minutes of sleep, cm, degrees, tokens per second, cost, …), `formatNumber` for a plain
  number and `formatMetricValue(metric)` for a stored metric. Do not call `toFixed`,
  `Math.round` or `toISOString().slice(0, 10)` to prepare text for the screen anywhere
  else. Chart coordinates and React keys are not display text.
- The locale is `en-GB` (`12,345.7`, `16 Oct 2026`).
- Degrees are written `12.3°`, without a space. Stored BodyLoop data keeps its `deg`
  unit.
- Halves round away from zero (`0.15` becomes `0.2`). Missing, `NaN` and infinite values
  show as `—`. A measured zero, such as the cost of a free model, is shown as zero.
- "Today" is `isoLocalDate()`, the viewer's own calendar day, not a UTC date.
- Metric names come from `metricLabel(key)` and carry no date; show a date separately
  with `formatDate`. Stored keys and labels are never rewritten.
