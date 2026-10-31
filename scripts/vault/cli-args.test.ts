import { describe, expect, test } from "bun:test";

import { backupFileName, parseVaultArgs, pgEnvFor } from "./cli-args";

describe("vault CLI arguments (#141)", () => {
  test("defaults and flags", () => {
    expect(parseVaultArgs([])).toEqual({
      ok: true,
      args: { actor: null, backup: null, backupConfirmed: false, batchSize: 500 },
    });
    expect(
      parseVaultArgs([
        "--actor",
        "local",
        "--backup",
        "/x/b.dump",
        "--backup-confirmed",
        "--batch",
        "50",
      ]),
    ).toEqual({
      ok: true,
      args: { actor: "local", backup: "/x/b.dump", backupConfirmed: true, batchSize: 50 },
    });
  });

  test("refusals", () => {
    expect(parseVaultArgs(["--actor"]).ok).toBe(false);
    expect(parseVaultArgs(["--batch", "0"]).ok).toBe(false);
    expect(parseVaultArgs(["--backup", "--backup-confirmed"]).ok).toBe(false);
    expect(parseVaultArgs(["--force"]).ok).toBe(false);
  });

  test("the backup name sorts by time and has no colons", () => {
    expect(backupFileName(new Date("2026-10-31T12:34:56.789Z"))).toBe(
      "pre-encryption-2026-10-31T123456Z.dump",
    );
  });

  test("pg_dump gets the password in its environment, never on the command line", () => {
    expect(
      pgEnvFor("postgresql://twinllm:s3cret@localhost/twin_llm?host=/state/pg-socket"),
    ).toEqual({
      PGHOST: "/state/pg-socket",
      PGPORT: "5432",
      PGUSER: "twinllm",
      PGPASSWORD: "s3cret",
      PGDATABASE: "twin_llm",
    });
    expect(pgEnvFor("postgresql://u@127.0.0.1:5433/db")).toEqual({
      PGHOST: "127.0.0.1",
      PGPORT: "5433",
      PGUSER: "u",
      PGDATABASE: "db",
    });
    expect(pgEnvFor("mysql://nope")).toBeNull();
  });
});
