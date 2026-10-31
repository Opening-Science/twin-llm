import { PERSONAL_TABLES } from "@/infrastructure/personal-columns";
import { type PlaintextFinding } from "@/infrastructure/reseal";

import { type LabCheck, plural, STATUS_LABEL } from "./lab-check";

/**
 * Encryption at rest (#141): whether every listed personal column holds
 * sealed values (`tlenc1.`). The counts come from the same SQL as
 * `bun run doctor` (`plaintextCountSql` in `infrastructure/personal-columns.ts`);
 * this module only words the card. Table and column names and counts only,
 * never a value; the count reads nothing personal, so the card works while
 * the vault is locked.
 */

const ID = "encryption-at-rest";
const TITLE = "Encryption at rest";

const COLUMN_COUNT = PERSONAL_TABLES.reduce((sum, entry) => sum + entry.sealed.length, 0);

/** One column's count by hand, as an example; the doctor runs all of them. */
export const ENCRYPTION_HOW_TO = [
  "bun run doctor   # the Encryption at rest section counts every listed column",
  "",
  "# By hand, one column (reads DATABASE_URL from .env.local without printing it):",
  `DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d "\\"'")"`,
  `psql "$DATABASE_URL" -Atc "select count(*) from personal_observations where display not like 'tlenc1.%'"   # 0`,
  `psql "$DATABASE_URL" -Atc "select count(*) from thread_search_embeddings where embedding is not null"   # 0 in personal mode`,
].join("\n");

export const encryptionBase = { id: ID, title: TITLE, howTo: ENCRYPTION_HOW_TO } as const;

export type EncryptionCheckInput = Readonly<{
  dataMode: "personal" | "synthetic";
  findings: readonly PlaintextFinding[];
}>;

const links = [
  {
    label: "Why: privacy design, #141",
    href: "/docs/privacy-design#23-141-encrypt-personal-data-at-rest",
  },
  { label: "Migration and rotation (runbook)", href: "/docs/runbook#encryption-at-rest" },
] as const;

export const encryptionCheck = (input: EncryptionCheckInput): LabCheck => {
  const evidence = [
    { label: "DATA_MODE", value: input.dataMode, mono: true },
    { label: "Columns checked", value: plural(COLUMN_COUNT, "column") },
  ];
  if (input.dataMode !== "personal") {
    return {
      ...encryptionBase,
      status: "unknown",
      summary:
        "Synthetic mode: synthetic rows stay plain by design, so there is nothing to encrypt. In personal mode this card counts plain values in every listed column.",
      evidence,
      links,
    };
  }
  const rows = input.findings.reduce((sum, finding) => sum + finding.rows, 0);
  return {
    ...encryptionBase,
    status: input.findings.length === 0 ? "ok" : "not-ok",
    summary:
      input.findings.length === 0
        ? "Every listed personal column holds values encrypted with your passphrase's key. A copied table or a stray backup of the database holds ciphertext."
        : `${plural(rows, "value")} in ${plural(input.findings.length, "column")} ${rows === 1 ? "is" : "are"} not encrypted yet. Stop the app and run \`bun run vault:migrate\`.`,
    evidence,
    table: {
      caption: "Columns that still hold plain values",
      columns: ["Table", "Column", "Rows", "Result"],
      rows: input.findings.map((finding) => [
        finding.table,
        finding.column,
        String(finding.rows),
        STATUS_LABEL["not-ok"],
      ]),
    },
    links,
  };
};
