import { EMPTY_VALUE } from "@/infrastructure/format-measure";
import {
  OWNER_CLUSTER_COMMAND,
  STORAGE_CHECK_COMMAND,
  type StorageFinding,
  type StorageStatus,
} from "@/infrastructure/storage-hardening";

import { type LabCheck, plural, STATUS_LABEL } from "./lab-check";

/**
 * Local storage (#144): whether the state folder, the env files, the mesh
 * files and the database connection are open to the owner's OS user only.
 * The findings come from `infrastructure/storage-scan.ts`, the same code the
 * startup check runs; this module only words the card. Names and modes only:
 * no password, URL or path under the home folder.
 */

/** Reads one setting from .env.local into the shell without printing it. */
const readSetting = (name: string): string =>
  `${name}="$(grep -m1 '^${name}=' .env.local | cut -d= -f2- | tr -d "\\"'")"`;

/**
 * The shell lines that repeat the card by hand. `vitronic` is the mesh folder
 * as the card shows it: `data/vitronic` or `$VITRONIC_DATA_DIR`.
 */
export const storageHowTo = (vitronic: string): string => {
  const meshFolder = vitronic.startsWith("$") ? `"${vitronic}"` : vitronic;
  return [
    `${STORAGE_CHECK_COMMAND}   # the same findings as this card, names and modes only`,
    "",
    "# By hand, Linux (on macOS: stat -f '%Lp' and find -perm +077).",
    "# Reads settings from .env.local without printing them; set by hand if not there.",
    readSetting("TWINLLM_STATE_DIR"),
    ': "${TWINLLM_STATE_DIR:=${XDG_DATA_HOME:-$HOME/.local/share}/twin-llm}"',
    ...(vitronic.startsWith("$") ? [readSetting("VITRONIC_DATA_DIR")] : []),
    readSetting("DATABASE_URL"),
    "stat -c '%a %n' .env.local     # 600",
    "stat -c '%a' \"$TWINLLM_STATE_DIR\"   # 700",
    `find "$TWINLLM_STATE_DIR" ${meshFolder} -perm /077 | wc -l   # 0`,
    `psql "$DATABASE_URL" -Atc "select rolsuper, current_setting('listen_addresses') from pg_roles where rolname = current_user"   # f, and empty or loopback`,
    "psql -w \"$(printf %s \"$DATABASE_URL\" | sed -E 's#^(postgres(ql)?://[^:@/]*):[^@]*@#\\1@#')\" -c 'select 1'   # must fail: no password",
  ].join("\n");
};

const ID = "local-storage";
const TITLE = "Local storage";

/** What the card shows even when the check cannot run. */
export const storageBase = (vitronic: string) =>
  ({ id: ID, title: TITLE, howTo: storageHowTo(vitronic) }) as const;

export type StorageCheckInput = Readonly<{
  dataMode: "personal" | "synthetic";
  /** As shown: `data/vitronic` or `$VITRONIC_DATA_DIR`. */
  vitronic: string;
  findings: readonly StorageFinding[];
}>;

const overall = (findings: readonly StorageFinding[]): StorageStatus =>
  findings.some((finding) => finding.status === "not-ok")
    ? "not-ok"
    : findings.length === 0 || findings.some((finding) => finding.status === "unknown")
      ? "unknown"
      : "ok";

const PASSWORDLESS_NOTE =
  "Whether Postgres lets the same role in without a password needs a second connection, so `bun run doctor` and the last command below check it.";

const summaryOf = (
  dataMode: StorageCheckInput["dataMode"],
  findings: readonly StorageFinding[],
): string => {
  const problems = findings.filter((finding) => finding.status !== "ok");
  const names = problems.map((finding) => finding.subject).join(", ");
  const note = findings.some((finding) => finding.id === "passwordless")
    ? ""
    : ` ${PASSWORDLESS_NOTE}`;
  if (dataMode === "personal") {
    return problems.length === 0
      ? `Personal mode, and everything here is open to your OS user only. The server checked the same at startup and would not have started otherwise.${note}`
      : `Personal mode needs all of this owner-only. The server checks it at startup and will refuse to start next time until ${plural(problems.length, "item")} ${problems.length === 1 ? "is" : "are"} fixed: ${names}.`;
  }
  return problems.length === 0
    ? `Synthetic mode. Everything here is already owner-only, so personal mode would start with this storage.${note}`
    : `Synthetic mode starts with this storage and logs a warning. Personal mode would refuse to start until ${plural(problems.length, "item")} ${problems.length === 1 ? "is" : "are"} fixed: ${names}. The recommended setup is \`${OWNER_CLUSTER_COMMAND}\`.`;
};

export const storageCheck = (input: StorageCheckInput): LabCheck => ({
  ...storageBase(input.vitronic),
  status: overall(input.findings),
  summary: summaryOf(input.dataMode, input.findings),
  evidence: [
    { label: "DATA_MODE", value: input.dataMode, mono: true },
    {
      label: "At startup",
      value:
        input.dataMode === "personal"
          ? "refuses to start unless all of this is owner-only"
          : "warns and starts",
    },
  ],
  table: {
    caption: "Storage checks: what was found and what owner-only needs",
    columns: ["Item", "Found", "Needs", "Result", "Fix"],
    rows: input.findings.map((finding) => [
      finding.subject,
      finding.found,
      finding.expected,
      STATUS_LABEL[finding.status],
      finding.fix ?? EMPTY_VALUE,
    ]),
  },
  links: [
    {
      label: "Why: privacy design, #144",
      href: "/docs/privacy-design#21-144-harden-local-storage-against-other-programs",
    },
    { label: "Owner-only Postgres (runbook)", href: "/docs/runbook#owner-only-postgres" },
  ],
});
