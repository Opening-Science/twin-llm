import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { STATUS_LABEL } from "../../features/lab/lab-check";
import { storageCheck } from "../../features/lab/storage-check";
import { formatFindings } from "../../infrastructure/storage-hardening";
import { probeStorage } from "../setup/storage-probe";

/**
 * `bun run lab:storage`: the Local storage card from the Lab page as text,
 * plus the sign-in without a password, which needs its own connection. Names,
 * modes and fixes only; never a password, a URL or a path under the home
 * folder. Exit 0 OK, 1 Not OK, 2 Unknown.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { settings, findings } = await probeStorage(root);
const check = storageCheck({
  dataMode: settings.dataMode,
  vitronic: settings.vitronicShown,
  findings,
});
console.log(
  [
    `${check.title}: ${STATUS_LABEL[check.status]}`,
    check.summary.replace(/`/g, ""),
    ...formatFindings(findings),
  ].join("\n"),
);
process.exit(check.status === "ok" ? 0 : check.status === "not-ok" ? 1 : 2);
