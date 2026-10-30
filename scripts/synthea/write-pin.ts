import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SYNTHEA_JAR_SHA256,
  SYNTHEA_JAR_URL,
  SYNTHEA_VERSION,
} from "../../infrastructure/local-artefacts";

/**
 * `bun run synthea:pin`: writes `scripts/synthea/synthea-pin.sh` from the
 * pins in infrastructure/local-artefacts.ts, so `generate-local.sh` (plain
 * bash, run without bun) downloads and checks the same JAR the app and the
 * Lab page expect. The file is committed; a test checks it is current.
 */

export const SYNTHEA_PIN_FILE = "synthea-pin.sh";

export const syntheaPinText = (): string =>
  [
    "# Generated from infrastructure/local-artefacts.ts by `bun run synthea:pin`. Do not edit.",
    `SYNTHEA_VERSION=${SYNTHEA_VERSION}`,
    `SYNTHEA_JAR_URL=${SYNTHEA_JAR_URL}`,
    `SYNTHEA_JAR_SHA256=${SYNTHEA_JAR_SHA256}`,
    "",
  ].join("\n");

if ((import.meta as { main?: boolean }).main) {
  const out = join(dirname(fileURLToPath(import.meta.url)), SYNTHEA_PIN_FILE);
  writeFileSync(out, syntheaPinText());
  console.log(`Wrote scripts/synthea/${SYNTHEA_PIN_FILE}`);
}
