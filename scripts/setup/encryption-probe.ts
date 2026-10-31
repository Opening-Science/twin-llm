/**
 * The "Encryption at rest" lines of `bun run doctor` (#141): how many rows
 * per listed personal column still hold a plain value (any count above zero
 * in personal mode is Not OK), and whether a pre-encryption backup, which
 * holds plain data, is still in the state directory. Table and column names,
 * counts and file names only; never a value.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import {
  formatPlaintextFindings,
  type PlaintextFinding,
  plaintextFindings,
} from "../../infrastructure/reseal";
import { openSql } from "./detect";
import { type StorageSettings } from "./storage-probe";

export type EncryptionProbe = Readonly<{
  dataMode: "personal" | "synthetic";
  /** Null when the database could not be asked. */
  findings: readonly PlaintextFinding[] | null;
  /** Pre-encryption backups still in `$TWINLLM_STATE_DIR/backups`. */
  backups: readonly string[];
}>;

/** The doctor's section. Pure. */
export const encryptionSection = (probe: EncryptionProbe): readonly string[] => {
  if (probe.dataMode !== "personal") {
    return [
      "Encryption at rest (DATA_MODE=synthetic: synthetic rows stay plain by design)",
      "",
    ];
  }
  return [
    "Encryption at rest (DATA_MODE=personal: every listed personal column must be sealed)",
    ...(probe.findings === null
      ? ["  [??] the database did not answer; the plaintext count is Unknown"]
      : formatPlaintextFindings(probe.findings)),
    ...probe.backups.map(
      (name) =>
        `  [!!] $TWINLLM_STATE_DIR/backups/${name} holds plain data from before the migration; delete it once you no longer need it`,
    ),
    "",
  ];
};

const backupsIn = async (stateDir: string): Promise<readonly string[]> =>
  (await readdir(join(stateDir, "backups")).catch((): string[] => []))
    .filter((name) => name.startsWith("pre-encryption-"))
    .sort();

export const probeEncryption = async (
  settings: StorageSettings,
): Promise<EncryptionProbe> => {
  const backups =
    settings.dataMode === "personal" ? await backupsIn(settings.stateDir) : [];
  if (settings.dataMode !== "personal")
    return { dataMode: "synthetic", findings: [], backups };
  try {
    const sql = openSql(settings.databaseUrl);
    try {
      const findings = await plaintextFindings((query, params) =>
        sql.unsafe(query, params),
      );
      return { dataMode: "personal", findings, backups };
    } finally {
      await sql.close();
    }
  } catch {
    return { dataMode: "personal", findings: null, backups };
  }
};
