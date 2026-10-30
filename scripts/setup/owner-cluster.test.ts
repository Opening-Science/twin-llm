import { describe, expect, test } from "bun:test";

import { parseDatabaseConnection } from "../../infrastructure/storage-hardening";
import { socketOptions, withoutPassword } from "./env-file";
import {
  choosePgBin,
  envSwapCommand,
  hasOwnerClusterConf,
  ownerClusterConf,
  ownerClusterPaths,
  ownerClusterRequested,
  ownerDatabaseUrl,
  parseSecretsFile,
  passwordFromBytes,
  secretsFileText,
  socketPathProblem,
  urlPassword,
} from "./owner-cluster";
import { storageSettings } from "./storage-probe";

const STATE = "/Users/someone/Library/Application Support/TwinLLM";
const PASSWORD = passwordFromBytes(new Uint8Array(32).fill(7));

describe("ownerClusterRequested", () => {
  test("alone, absent, or mixed with other flags", () => {
    expect(ownerClusterRequested(["--", "--owner-cluster"])).toBe(true);
    expect(ownerClusterRequested(["--skip-cohort"])).toBe(false);
    expect(ownerClusterRequested(["--owner-cluster", "--skip-cohort"])).toBeNull();
  });
});

describe("paths and configuration", () => {
  test("everything lives in the state folder", () => {
    expect(ownerClusterPaths(`${STATE}/`)).toEqual({
      dataDir: `${STATE}/pg`,
      socketDir: `${STATE}/pg-socket`,
      secrets: `${STATE}/owner-cluster.env`,
      log: `${STATE}/pg/server.log`,
    });
  });

  test("a socket path the OS cannot hold is refused before initdb", () => {
    expect(socketPathProblem(`${STATE}/pg-socket`)).toBeNull();
    expect(socketPathProblem(`/${"x".repeat(100)}`)).toContain("TWINLLM_STATE_DIR");
  });

  test("no TCP listener, an owner-only socket, no statement logging", () => {
    const conf = ownerClusterConf("/tmp/it's here");
    expect(conf).toContain("listen_addresses = ''");
    expect(conf).toContain("unix_socket_directories = '/tmp/it''s here'");
    expect(conf).toContain("unix_socket_permissions = 0700");
    expect(conf).toContain("log_statement = 'none'");
    expect(hasOwnerClusterConf(`# existing\n${conf}`)).toBe(true);
    expect(hasOwnerClusterConf("listen_addresses = '*'")).toBe(false);
  });
});

describe("passwords and the URL", () => {
  test("32 bytes give 43 URL-safe characters", () => {
    expect(PASSWORD).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test("the URL is a socket in the state folder that Prisma and pg both read", () => {
    const url = ownerDatabaseUrl({ password: PASSWORD, socketDir: `${STATE}/pg-socket` });
    expect(url.startsWith("postgresql://twinllm:")).toBe(true);
    expect(url).toContain("@localhost/twin_llm?host=");
    expect(parseDatabaseConnection(url)).toEqual({
      kind: "socket",
      socketDir: `${STATE}/pg-socket`,
      port: 5432,
      user: "twinllm",
      hasPassword: true,
      database: "twin_llm",
    });
    expect(urlPassword(url)).toBe(PASSWORD);
  });

  test("the secrets file round-trips", () => {
    const secrets = {
      adminPassword: PASSWORD,
      databaseUrl: ownerDatabaseUrl({ password: PASSWORD, socketDir: "/s" }),
    };
    expect(parseSecretsFile(secretsFileText(secrets))).toEqual(secrets);
    expect(parseSecretsFile("DATABASE_URL=x")).toBeNull();
  });

  test("the swap command copies the line without printing it", () => {
    const command = envSwapCommand(
      "$HOME/Library/Application Support/TwinLLM/owner-cluster.env",
    );
    expect(command).toContain("umask 077");
    expect(command).toContain(
      `grep '^DATABASE_URL=' "$HOME/Library/Application Support/TwinLLM/owner-cluster.env"`,
    );
    expect(command).toContain("mv .env.local.new .env.local");
    expect(command).not.toContain("cat ");
  });
});

describe("choosePgBin", () => {
  test("TWINLLM_PG_BIN, then pg_config, then PATH; each only with an initdb", () => {
    const has = (dirs: string[]) => (dir: string) => dirs.includes(dir);
    const all = {
      fromEnv: "/opt/pg/bin",
      fromPgConfig: "/usr/lib/pg/bin",
      fromPath: "/usr/bin",
    };
    expect(choosePgBin(all, has(["/opt/pg/bin", "/usr/bin"]))).toBe("/opt/pg/bin");
    expect(choosePgBin(all, has(["/usr/lib/pg/bin", "/usr/bin"]))).toBe(
      "/usr/lib/pg/bin",
    );
    expect(choosePgBin({ ...all, fromEnv: " " }, has(["/usr/bin"]))).toBe("/usr/bin");
    expect(choosePgBin(all, has([]))).toBeNull();
  });
});

describe("connections for Bun's client", () => {
  test("a socket URL becomes the socket file path", () => {
    expect(
      socketOptions(ownerDatabaseUrl({ password: PASSWORD, socketDir: "/s d" })),
    ).toEqual({
      path: "/s d/.s.PGSQL.5432",
      username: "twinllm",
      password: PASSWORD,
      database: "twin_llm",
    });
    expect(socketOptions("postgresql://u:p@127.0.0.1/db")).toBeNull();
  });

  test("the passwordless probe keeps server, role and database", () => {
    expect(withoutPassword("postgresql://u:p@127.0.0.1:5433/db")).toEqual({
      hostname: "127.0.0.1",
      port: 5433,
      username: "u",
      password: "",
      database: "db",
    });
    expect(withoutPassword("postgresql://u:p@localhost/db?host=/s")).toMatchObject({
      path: "/s/.s.PGSQL.5432",
      password: "",
    });
    expect(withoutPassword("not a url")).toBeNull();
  });
});

describe("storageSettings", () => {
  test("defaults as the app reads them", () => {
    const settings = storageSettings(
      "/work/twin-llm",
      { DATABASE_URL: "postgresql://u:p@127.0.0.1/db", DATA_MODE: " " },
      { platform: "linux", home: "/home/synthetic-owner" },
    );
    expect(settings).toEqual({
      dataMode: "personal",
      stateDir: "/home/synthetic-owner/.local/share/twin-llm",
      vitronicDir: "/work/twin-llm/data/vitronic",
      vitronicShown: "data/vitronic",
      databaseUrl: "postgresql://u:p@127.0.0.1/db",
    });
  });

  test("set folders win", () => {
    const settings = storageSettings(
      "/work/twin-llm",
      {
        DATA_MODE: "synthetic",
        TWINLLM_STATE_DIR: "/srv/state",
        VITRONIC_DATA_DIR: "/srv/scans",
      },
      { platform: "darwin", home: "/Users/someone" },
    );
    expect(settings).toMatchObject({
      dataMode: "synthetic",
      stateDir: "/srv/state",
      vitronicDir: "/srv/scans",
      vitronicShown: "$VITRONIC_DATA_DIR",
      databaseUrl: "",
    });
  });
});
