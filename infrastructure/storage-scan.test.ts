import { describe, expect, test } from "bun:test";

import { type PathFacts, type ServerFacts } from "./storage-hardening";
import {
  bootStorageCheck,
  ENV_FILES,
  scanStorage,
  type StoragePorts,
  type StorageScanInput,
  StorageNotOwnerOnlyError,
} from "./storage-scan";

const HOME = "/home/synthetic-owner";
const CWD = "/work/twin-llm";
const STATE = `${HOME}/.local/share/twin-llm`;
const UID = 1000;
const SOCKET_URL = `postgresql://twinllm:not-a-real-password@localhost/twin_llm?host=${encodeURIComponent(`${STATE}/pg-socket`)}`;

const dir = (mode = 0o700): PathFacts => ({
  kind: "found",
  mode,
  uid: UID,
  directory: true,
});
const file = (mode = 0o600): PathFacts => ({
  kind: "found",
  mode,
  uid: UID,
  directory: false,
});

const input = (overrides: Partial<StorageScanInput> = {}): StorageScanInput => ({
  cwd: CWD,
  home: HOME,
  ownUid: UID,
  stateDir: STATE,
  vitronicDir: `${CWD}/data/vitronic`,
  databaseUrl: SOCKET_URL,
  envFiles: ENV_FILES,
  logging: false,
  ...overrides,
});

const GOOD_FACTS: ServerFacts = {
  superuser: false,
  listenAddresses: "",
  logStatement: "none",
  logMinDurationStatement: "-1",
};

const ports = (
  paths: Readonly<Record<string, PathFacts>>,
  facts: ServerFacts | null = GOOD_FACTS,
  extra: Partial<StoragePorts> = {},
): StoragePorts => ({
  stat: async (path) => paths[path] ?? { kind: "missing" },
  walk: async () => ({ files: [dir(), file()], truncated: false }),
  serverFacts: async () => facts,
  ...extra,
});

const OWNER_ONLY = {
  [STATE]: dir(),
  [`${STATE}/pg-socket`]: dir(),
  [`${CWD}/.env.local`]: file(),
  [`${CWD}/data/vitronic`]: dir(),
};

describe("scanStorage", () => {
  test("an owner-only install is OK on every line", async () => {
    const findings = await scanStorage(input(), ports(OWNER_ONLY));
    expect(findings.map((finding) => [finding.id, finding.status])).toEqual([
      ["state-dir", "ok"],
      ["env-file:.env.local", "ok"],
      ["vitronic-dir", "ok"],
      ["vitronic-files", "ok"],
      ["database-url", "ok"],
      ["socket-dir", "ok"],
      ["database-role", "ok"],
      ["listen-addresses", "ok"],
    ]);
  });

  test("the dev setup: wide files, a superuser on loopback TCP", async () => {
    const findings = await scanStorage(
      input({
        databaseUrl: "postgresql://postgres:postgres@127.0.0.1:5432/twin_llm_synthetic",
        logging: true,
      }),
      ports(
        {
          [STATE]: dir(0o755),
          [`${CWD}/.env.local`]: file(0o644),
          [`${CWD}/.env`]: file(0o644),
        },
        {
          superuser: true,
          listenAddresses: "localhost",
          logStatement: "none",
          logMinDurationStatement: "-1",
        },
        { passwordless: async () => true },
      ),
    );
    const byId = Object.fromEntries(findings.map((finding) => [finding.id, finding]));
    expect(byId["state-dir"]?.fix).toBe('chmod 700 "$HOME/.local/share/twin-llm"');
    expect(byId["env-file:.env.local"]?.status).toBe("not-ok");
    expect(byId["env-file:.env"]?.status).toBe("not-ok");
    expect(byId["vitronic-dir"]?.found).toBe(
      "not created yet (the app creates it owner-only)",
    );
    expect(byId["database-url"]?.status).toBe("ok");
    expect(byId["socket-dir"]).toBeUndefined();
    expect(byId["database-role"]?.status).toBe("not-ok");
    expect(byId["listen-addresses"]?.status).toBe("ok");
    expect(byId["statement-logging"]?.status).toBe("ok");
    expect(byId.passwordless?.status).toBe("not-ok");
    const text = JSON.stringify(findings);
    expect(text).not.toContain(HOME);
    expect(text).not.toContain("postgres:postgres");
  });

  test("a mesh folder outside the repository is shown as its variable", async () => {
    const findings = await scanStorage(
      input({ vitronicDir: `${HOME}/scans` }),
      ports({ ...OWNER_ONLY, [`${HOME}/scans`]: dir(0o755) }),
    );
    const vitronic = findings.find((finding) => finding.id === "vitronic-dir");
    expect(vitronic).toMatchObject({
      subject: "$VITRONIC_DATA_DIR",
      status: "not-ok",
      fix: 'chmod 700 "$HOME/scans"',
    });
  });

  test("no database answer is Unknown, never OK", async () => {
    const findings = await scanStorage(input(), ports(OWNER_ONLY, null));
    expect(
      findings.filter((finding) => finding.status === "unknown").map((f) => f.id),
    ).toEqual(["database-role", "listen-addresses"]);
  });
});

describe("bootStorageCheck", () => {
  const problem = scanStorage(
    input(),
    ports({ ...OWNER_ONLY, [`${CWD}/.env.local`]: file(0o644) }),
  );

  test("personal mode creates the state folder, then refuses with the plain message", async () => {
    const calls: string[] = [];
    const error = await bootStorageCheck({
      dataMode: "personal",
      ensureStateDir: async () => {
        calls.push("ensure");
      },
      scan: async () => {
        calls.push("scan");
        return problem;
      },
      warn: () => calls.push("warn"),
    }).catch((caught: unknown) => caught);
    expect(calls).toEqual(["ensure", "scan"]);
    expect(error).toBeInstanceOf(StorageNotOwnerOnlyError);
    expect((error as Error).message).toContain("Fix: chmod 600 .env.local");
  });

  test("personal mode starts when everything is owner-only", async () => {
    const warnings: string[] = [];
    await bootStorageCheck({
      dataMode: "personal",
      ensureStateDir: async () => {
        throw new Error("EACCES /home/synthetic-owner");
      },
      scan: () => scanStorage(input(), ports(OWNER_ONLY)),
      warn: (line) => warnings.push(line),
    });
    expect(warnings).toEqual([]);
  });

  test("synthetic mode warns once and starts, without creating anything", async () => {
    const calls: string[] = [];
    await bootStorageCheck({
      dataMode: "synthetic",
      ensureStateDir: async () => {
        calls.push("ensure");
      },
      scan: async () => problem,
      warn: (line) => calls.push(line),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("DATA_MODE=synthetic starts anyway");
  });
});
