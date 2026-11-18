import { describe, expect, test } from "bun:test";

import { passphraseProblem } from "../../infrastructure/vault-crypto";
import {
  type DatabaseState,
  doneCounts,
  migrateInput,
  newRunPassphrase,
  redactLine,
  sealedProblems,
  seededProblems,
  stateLines,
  unchangedProblems,
} from "./ci-migrate-checks";

const seeded: DatabaseState = {
  personal_datasets: { rows: 2, plain: 10, digest: "a" },
  personal_observations: { rows: 5, plain: 30, digest: "b" },
  threads: { rows: 0, plain: 0, digest: "" },
};

const sealed: DatabaseState = {
  personal_datasets: { rows: 2, plain: 0, digest: "c" },
  personal_observations: { rows: 5, plain: 0, digest: "d" },
  threads: { rows: 0, plain: 0, digest: "" },
};

describe("the run's passphrase", () => {
  test("passes the passphrase rules and differs each run", () => {
    const one = newRunPassphrase();
    expect(passphraseProblem(one)).toBeNull();
    expect(one).not.toBe(newRunPassphrase());
    expect(one).not.toContain("\n");
  });

  test("set up types it twice and confirms the recovery code; unlock types it once", () => {
    expect(migrateInput("setup", "p".repeat(20))).toBe(
      `${"p".repeat(20)}\n${"p".repeat(20)}\nsaved\n`,
    );
    expect(migrateInput("unlock", "p".repeat(20))).toBe(`${"p".repeat(20)}\n`);
  });
});

describe("the log", () => {
  test("hides the recovery code and leaves other lines as they are", () => {
    expect(redactLine("Recovery code (shown once): ABCD-EFGH-IJKL")).toBe(
      "Recovery code (shown once): [hidden]",
    );
    expect(redactLine("  personal_datasets: 2 row(s) sealed")).toBe(
      "  personal_datasets: 2 row(s) sealed",
    );
  });

  test("lists tables with rows only, with counts and no digest", () => {
    expect(stateLines(seeded)).toEqual([
      "  personal_datasets: 2 row(s), 10 plain",
      "  personal_observations: 5 row(s), 30 plain",
    ]);
  });
});

describe("doneCounts", () => {
  test("reads the counts of the Done line", () => {
    expect(
      doneCounts("Backup: x\nDone: 46 row(s) and 1 mesh file(s) sealed.\nWhen ..."),
    ).toEqual({ rows: 46, meshFiles: 1 });
  });

  test("is null when the run stopped before it", () => {
    expect(doneCounts("Not confirmed. Nothing was changed.")).toBeNull();
  });
});

describe("checks", () => {
  test("a seed needs a dataset and plain observations", () => {
    expect(seededProblems(seeded)).toEqual([]);
    expect(seededProblems(sealed)).toEqual([
      "no plain observation to seal",
      "no plain value to seal",
    ]);
    expect(seededProblems({})).toContain("no dataset was seeded");
  });

  test("after a run no plain value is left and no row is lost", () => {
    expect(sealedProblems(seeded, sealed)).toEqual([]);
    expect(
      sealedProblems(seeded, {
        ...sealed,
        personal_observations: { rows: 4, plain: 1, digest: "d" },
      }),
    ).toEqual([
      "personal_observations: 1 plain value(s) left",
      "personal_observations: 5 row(s) before, 4 after",
    ]);
  });

  test("dropped plain search vectors are not a lost row", () => {
    expect(
      sealedProblems(
        { thread_search_embeddings: { rows: 3, plain: 3, digest: "e" } },
        { thread_search_embeddings: { rows: 0, plain: 0, digest: "" } },
      ),
    ).toEqual([]);
  });

  test("a second run must leave every table byte for byte as it was", () => {
    expect(unchangedProblems(sealed, sealed)).toEqual([]);
    expect(
      unchangedProblems(sealed, {
        ...sealed,
        personal_datasets: { rows: 2, plain: 0, digest: "resealed" },
      }),
    ).toEqual(["personal_datasets changed on the second run"]);
    expect(
      unchangedProblems(sealed, { ...sealed, extra: { rows: 0, plain: 0, digest: "" } }),
    ).toEqual(["extra changed on the second run"]);
  });
});
