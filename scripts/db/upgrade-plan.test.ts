import { describe, expect, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  migrationsThrough,
  partialConfigSource,
  planUpgrade,
  SWITCH_MIGRATION,
  type UpgradeState,
} from "./upgrade-plan";
import { migrationFolders } from "./upgrade";

const BASELINE = "20261025000000_baseline";
const EXPAND = "20261118120000_chat_tables_expand";
const MIRROR = "20261118120200_chat_tables_mirror";
const MIGRATIONS = [
  BASELINE,
  EXPAND,
  "20261118120100_schema_moves",
  MIRROR,
  SWITCH_MIGRATION,
];

/** A 0.1.0 install: the baseline only, with saved chats. */
const V010: UpgradeState = {
  migrations: MIGRATIONS,
  applied: [BASELINE],
  failed: [],
  phase: null,
  chatRows: true,
};

describe("planUpgrade", () => {
  test("0.1.0 with saved chats stops before the switch, copies, checks, then deploys", () => {
    expect(planUpgrade(V010)).toEqual({
      ok: true,
      steps: [
        { kind: "deploy-through", migration: MIRROR },
        { kind: "backfill" },
        { kind: "parity" },
        { kind: "deploy" },
      ],
    });
  });

  test("a new install, or one with no chats, is a plain deploy", () => {
    expect(planUpgrade({ ...V010, applied: [], chatRows: false })).toEqual({
      ok: true,
      steps: [{ kind: "deploy" }],
    });
    expect(planUpgrade({ ...V010, chatRows: false })).toEqual({
      ok: true,
      steps: [{ kind: "deploy" }],
    });
  });

  test("a switched database is a plain deploy", () => {
    expect(planUpgrade({ ...V010, applied: MIGRATIONS, phase: "switched" })).toEqual({
      ok: true,
      steps: [{ kind: "deploy" }],
    });
  });

  test("a failed switch from a plain deploy is copied, checked, marked rolled back and applied", () => {
    const state: UpgradeState = {
      ...V010,
      applied: MIGRATIONS.filter((name) => name !== SWITCH_MIGRATION),
      failed: [SWITCH_MIGRATION],
      phase: "expanded",
    };
    expect(planUpgrade(state)).toEqual({
      ok: true,
      steps: [
        { kind: "backfill" },
        { kind: "parity" },
        { kind: "resolve-rolled-back", migration: SWITCH_MIGRATION },
        { kind: "deploy" },
      ],
    });
  });

  test("a failed switch with no chats is marked rolled back and applied", () => {
    expect(
      planUpgrade({
        ...V010,
        chatRows: false,
        failed: [SWITCH_MIGRATION],
        phase: "expanded",
      }),
    ).toEqual({
      ok: true,
      steps: [
        { kind: "resolve-rolled-back", migration: SWITCH_MIGRATION },
        { kind: "deploy" },
      ],
    });
  });

  test("a backfilled move skips the copy but is still checked", () => {
    const state: UpgradeState = {
      ...V010,
      applied: MIGRATIONS.filter((name) => name !== SWITCH_MIGRATION),
      phase: "backfilled",
    };
    expect(planUpgrade(state)).toEqual({
      ok: true,
      steps: [{ kind: "parity" }, { kind: "deploy" }],
    });
  });

  test("any other failed migration stops the upgrade", () => {
    const result = planUpgrade({ ...V010, failed: [EXPAND] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(EXPAND);
  });
});

describe("migrationsThrough", () => {
  test("keeps the migrations up to and including the named one, in name order", () => {
    expect(migrationsThrough([...MIGRATIONS].reverse(), MIRROR)).toEqual([
      BASELINE,
      EXPAND,
      "20261118120100_schema_moves",
      MIRROR,
    ]);
  });
});

describe("the repository's migrations", () => {
  const folders = migrationFolders(
    join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "prisma/migrations"),
  );

  test("hold the switch, and the mirror is the last migration before it", () => {
    expect(folders).toContain(SWITCH_MIGRATION);
    expect(folders.filter((name) => name < SWITCH_MIGRATION).at(-1)).toBe(MIRROR);
  });
});

describe("partialConfigSource", () => {
  test("points Prisma at the schema and the cut migrations, URL from the environment", () => {
    const source = partialConfigSource("/r/prisma/schema.prisma", "/tmp/x/migrations");
    expect(source).toContain('schema: "/r/prisma/schema.prisma"');
    expect(source).toContain('migrations: { path: "/tmp/x/migrations" }');
    expect(source).toContain('url: process.env["DATABASE_URL"]');
    expect(source).not.toContain("postgres");
  });
});
