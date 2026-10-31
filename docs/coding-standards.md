# Coding standards

TwinLLM has two kinds of rules. Some are checked by a tool on every change; the rest
need a reviewer. This page says which is which, so nobody assumes a linter is catching
something it is not. When a rule here and `eslint.config.mjs` disagree, the config is
what actually runs; fix whichever one is wrong.

## Commands

| Command                  | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `bun run typecheck`      | `tsc --noEmit` over the whole project                  |
| `bun run lint`           | ESLint with `--max-warnings=0`: any warning fails      |
| `bun run lint:claims`    | Banned product-claim wording (see `CONTRIBUTING.md`)   |
| `bun run test`           | Unit tests                                             |
| `bun run test:isolation` | Test folders that must also pass in their own run      |
| `bun run skills:check`   | Validates skills and runs their evals (`bun test` too) |
| `bun run format`         | Prettier rewrites files in place                       |
| `bun run format:check`   | Prettier reports files it would change                 |
| `bun run build`          | Production Next.js build                               |

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
- **`Switch`** for one setting that turns on or off at once (`role="switch"`, a
  real button, a label naming what it turns on).
- **`Field`** for a labelled input or select. It connects the label, hint and error for
  screen readers. A placeholder never replaces the label.
- **`Tabs`** for panels of one view, with Radix roles and arrow-key navigation.
- **`StatusBadge`** for a connection or job state. It always has text; the tone (`ok`,
  `warn`, `neutral`, `off`) only adds to it.
- **`Card`** for a framed block on `.surface`, with `sm`, `md` or `lg` padding.
- **`Legend`** for the series names of a chart. Only the swatch is coloured.
- **`StepTrace`**, **`UndoButton`**, **`HoldToConfirm`**, **`StatusLattice`** and
  **`Rating`**: see "Interaction patterns" below.

### Interaction patterns

Five components show what the app is doing or ask for a deliberate act. Each has its
words in a pure, tested module beside it, draws only with tokens (success is
`--winner`, danger is `--destructive`; `interaction-tokens.test.ts` measures them in
both themes), and stops its motion under reduced motion.

- **`StepTrace`** for work made of steps. While working, one line names the step in
  progress with a quiet shimmer and a live timer, over a list where finished steps are
  ticked and the current one pulses. When it settles the line reads "Used N tools in
  X.Xs" (no time when it was loaded already finished) and the list folds; the line is
  a button with `aria-expanded`. A live region speaks at the start and at the end
  only, never per step or tick. A step's `detail` replaces its label in the list. The
  chat answer uses it for tool calls (`features/arena/tool-call-cards.tsx`): each
  step is the call in plain words with its measure (named from the data, code in
  brackets) and window, or "No data: <code>"
  for a refusal, and its card keeps the arguments, rows and the answer's numbers.
- **`UndoButton`** for a delete that can wait. Pressing it runs the soft step and the
  button becomes Undo, with a line burning down along its bottom for `undoWindow` ms.
  Undo or Escape reverts; when the time runs out `onExpire` does the real delete. The
  time stands still while the tab is hidden and while a mouse rests on the button
  after leaving it once. Focus stays on the button.
- **`HoldToConfirm`** for what cannot be undone, such as erasing personal data. It
  fills at a constant speed while held by a pointer, Space or Enter, empties quickly
  on early release, cancels when the pointer drifts off, and calls `onConfirm` once.
  Under reduced motion nothing moves and the label counts down ("Keep holding: 2").
  A screen-reader hint states the hold time. The label says what will happen ("Hold
  to withdraw consent"). The timing is `hold-timer.ts`, tested with a fake clock.
  **`HoldToSubmit`** is the same button as the submit control of a form: a completed
  hold calls `requestSubmit` once, so a server action runs as for any submit, and every
  other submission of that form (Enter in a field) is stopped. While `pending` it shows
  `pendingLabel`; a refused submission leaves it ready to hold again.
- **`StatusLattice`** for a long job: a 3 by 3 dot wave while it runs, then a tick or
  a cross, with its name, its state in words and a timer that stops.
- **`Rating`** for a 1 to 5 score: a radio group with a label per value, a pointer
  preview, arrows, Home, End and Backspace to clear, and a read-only mode.

Where they are used: `StepTrace` in chat answers; `UndoButton` for deleting a thread
(thread bar) and an imported dataset (Customize · Data), through `useSoftDelete`
(`soft-delete.ts`: the item hides at once, the server delete runs only when the window
ends, Undo sends nothing; leaving for another page in the app runs it early, closing the
tab asks first and then deletes nothing); `StatusLattice` for a Synthea run;
`HoldToSubmit` for the two privacy actions that cannot be undone (#350): withdrawing a
learning consent (Customize · Privacy) and replacing the passphrase and recovery code
with the recovery code (the unlock screen). The app has no erase-everything action and
no genome dataset to delete; a delete that can wait uses `UndoButton`, not a hold.
`Rating` scores answers in the Lab's second-rater view
(`features/lab/second-rater.tsx`, #351), with a written anchor per level. Their look lives in
`globals.css` under "Interaction patterns".

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
  unit. Powers are typeset the same way through `formatUnit`: a stored `m2`, `m3` or
  `kg/m2` reads `m²`, `m³`, `kg/m²`.
- Halves round away from zero (`0.15` becomes `0.2`). Missing, `NaN` and infinite values
  show as `—`. A measured zero, such as the cost of a free model, is shown as zero.
- "Today" is `isoLocalDate()`, the viewer's own calendar day, not a UTC date.
- Metric names come from `metricLabel(key)` and carry no date; show a date separately
  with `formatDate`. Stored keys and labels are never rewritten.
