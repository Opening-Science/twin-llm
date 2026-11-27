/**
 * What `bun run db:upgrade` does to a database, worked out from its state.
 *
 * `prisma migrate deploy` applies every pending migration at once. On an
 * install with saved chats from before the chat tables move (0.1.0, say),
 * that runs the expand and mirror migrations and then the switch, which
 * refuses until the older rows are copied and checked. The upgrade stops
 * the deploy just before the switch, runs the backfill and the parity
 * check, and only then deploys the rest. See docs/storage.md, "Upgrading
 * from 0.1.0".
 */

/** The migration that switches the app to the new chat tables (C.4). */
export const SWITCH_MIGRATION = "20261124120000_chat_tables_switch";

export type MovePhase = "expanded" | "backfilled" | "switched";

export type UpgradeState = Readonly<{
  /** Every migration folder in prisma/migrations. */
  migrations: readonly string[];
  /** Migrations recorded as finished and not rolled back. */
  applied: readonly string[];
  /** Migrations recorded as started, neither finished nor rolled back. */
  failed: readonly string[];
  /** The chat-tables move's phase; null before the expand migration. */
  phase: MovePhase | null;
  /** True when threads or conversations hold a row (the switch's own test). */
  chatRows: boolean;
}>;

export type UpgradeStep =
  | Readonly<{ kind: "deploy-through"; migration: string }>
  | Readonly<{ kind: "backfill" }>
  | Readonly<{ kind: "parity" }>
  | Readonly<{ kind: "resolve-rolled-back"; migration: string }>
  | Readonly<{ kind: "deploy" }>;

export type UpgradePlan =
  | Readonly<{ ok: true; steps: readonly UpgradeStep[] }>
  | Readonly<{ ok: false; reason: string }>;

const plan = (...steps: UpgradeStep[]): UpgradePlan => ({ ok: true, steps });

export const planUpgrade = (state: UpgradeState): UpgradePlan => {
  const otherFailed = state.failed.filter((name) => name !== SWITCH_MIGRATION);
  if (otherFailed.length > 0) {
    return {
      ok: false,
      reason: `migration ${otherFailed.join(", ")} failed earlier; see bunx prisma migrate status`,
    };
  }
  const switchFailed = state.failed.includes(SWITCH_MIGRATION);
  if (
    !state.migrations.includes(SWITCH_MIGRATION) ||
    state.applied.includes(SWITCH_MIGRATION) ||
    state.phase === "switched"
  ) {
    return plan({ kind: "deploy" });
  }
  // With no chat rows the switch passes on its own (a new install).
  if (!state.chatRows) {
    return switchFailed
      ? plan(
          { kind: "resolve-rolled-back", migration: SWITCH_MIGRATION },
          { kind: "deploy" },
        )
      : plan({ kind: "deploy" });
  }
  const steps: UpgradeStep[] = [];
  const before = [...state.migrations]
    .sort()
    .filter((name) => name < SWITCH_MIGRATION && !state.applied.includes(name));
  const last = before.at(-1);
  if (last !== undefined) steps.push({ kind: "deploy-through", migration: last });
  if (state.phase !== "backfilled") steps.push({ kind: "backfill" });
  steps.push({ kind: "parity" });
  // The switch is one transaction, so a failed run changed nothing.
  if (switchFailed)
    steps.push({ kind: "resolve-rolled-back", migration: SWITCH_MIGRATION });
  steps.push({ kind: "deploy" });
  return plan(...steps);
};

/** The migrations a deploy through `migration` applies, in order. */
export const migrationsThrough = (
  migrations: readonly string[],
  migration: string,
): readonly string[] => [...migrations].sort().filter((name) => name <= migration);

export const describeStep = (step: UpgradeStep): string => {
  switch (step.kind) {
    case "deploy-through":
      return `prisma migrate deploy, through ${step.migration}`;
    case "backfill":
      return "bun run db:chat-backfill";
    case "parity":
      return "bun run db:chat-parity";
    case "resolve-rolled-back":
      return `prisma migrate resolve --rolled-back ${step.migration}`;
    case "deploy":
      return "prisma migrate deploy";
  }
};

/**
 * A Prisma config for a deploy that stops at a migration: the real schema,
 * and a migrations folder holding only the migrations up to it. The database
 * URL is read from the environment, as prisma.config.ts reads it.
 */
export const partialConfigSource = (schemaPath: string, migrationsPath: string): string =>
  [
    "export default {",
    `  schema: ${JSON.stringify(schemaPath)},`,
    `  migrations: { path: ${JSON.stringify(migrationsPath)} },`,
    '  datasource: { url: process.env["DATABASE_URL"] },',
    "};",
    "",
  ].join("\n");
