/**
 * The owner-only storage checks (#144) for `bun run doctor` and
 * `bun run lab:storage`: the same findings as the startup check and the Lab
 * card, plus the two that need their own connection (a sign-in without a
 * password, and the statement-logging settings). Reads `.env.local` with the
 * shell on top, like the other setup scripts; prints nothing itself.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  defaultStateDir,
  isInside,
  SERVER_FACTS_SQL,
  type ServerFacts,
  serverFactsFromRow,
  type StorageFinding,
} from "../../infrastructure/storage-hardening";
import { ownUid, statFacts, walkFacts } from "../../infrastructure/storage-ports";
import { ENV_FILES, scanStorage } from "../../infrastructure/storage-scan";
import { currentPlatform, effectiveEnv, openSql, openSqlWith } from "./detect";
import { withoutPassword } from "./env-file";

export type StorageSettings = Readonly<{
  dataMode: "personal" | "synthetic";
  stateDir: string;
  vitronicDir: string;
  /** `data/vitronic` or `$VITRONIC_DATA_DIR`, as the Lab card writes it. */
  vitronicShown: string;
  databaseUrl: string;
}>;

/** The settings the app would use, from a raw environment (blank counts as unset). */
export const storageSettings = (
  root: string,
  env: Readonly<Record<string, string | undefined>>,
  where: Readonly<{ platform: "linux" | "darwin"; home: string }>,
): StorageSettings => {
  const value = (name: string): string | undefined => {
    const raw = env[name]?.trim();
    return raw === undefined || raw === "" ? undefined : raw;
  };
  const vitronicDir = resolve(root, value("VITRONIC_DATA_DIR") ?? "data/vitronic");
  return {
    // As in infrastructure/env.ts: personal unless DATA_MODE says synthetic.
    dataMode: value("DATA_MODE") === "synthetic" ? "synthetic" : "personal",
    stateDir:
      value("TWINLLM_STATE_DIR") ??
      defaultStateDir({ ...where, xdgDataHome: value("XDG_DATA_HOME") }),
    vitronicDir,
    vitronicShown: isInside(root, vitronicDir)
      ? vitronicDir.slice(root.replace(/\/+$/, "").length + 1) || "."
      : "$VITRONIC_DATA_DIR",
    databaseUrl: value("DATABASE_URL") ?? "",
  };
};

const serverFacts = async (url: string): Promise<ServerFacts | null> => {
  try {
    const sql = openSql(url);
    try {
      const [row] = await sql.unsafe(SERVER_FACTS_SQL);
      return serverFactsFromRow(row);
    } finally {
      await sql.close();
    }
  } catch {
    return null;
  }
};

/** True when an empty password is accepted, false when refused, null when not tried. */
const acceptsNoPassword = async (url: string): Promise<boolean | null> => {
  const options = withoutPassword(url);
  if (options === null) return null;
  try {
    const sql = openSqlWith(options);
    try {
      await sql.unsafe("select 1");
      return true;
    } finally {
      await sql.close();
    }
  } catch {
    return false;
  }
};

export type StorageProbe = Readonly<{
  settings: StorageSettings;
  findings: readonly StorageFinding[];
}>;

export const probeStorage = async (root: string): Promise<StorageProbe> => {
  const platform = currentPlatform();
  const { env } = await effectiveEnv(root, platform);
  const settings = storageSettings(root, env, { platform, home: homedir() });
  const facts = await serverFacts(settings.databaseUrl);
  const findings = await scanStorage(
    {
      cwd: root,
      home: homedir(),
      ownUid: ownUid(),
      stateDir: settings.stateDir,
      vitronicDir: settings.vitronicDir,
      databaseUrl: settings.databaseUrl,
      envFiles: ENV_FILES,
      logging: true,
    },
    {
      stat: statFacts,
      walk: walkFacts,
      serverFacts: async () => facts,
      // Only meaningful once the password connection worked.
      passwordless: () =>
        facts === null ? Promise.resolve(null) : acceptsNoPassword(settings.databaseUrl),
    },
  );
  return { settings, findings };
};
