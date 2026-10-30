import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { SBOM_PATH } from "../../infrastructure/local-artefacts";
import { bomText, buildBom, parseBunLock } from "../../infrastructure/cyclonedx";

/**
 * `bun run sbom`: writes the CycloneDX file for this checkout's bun.lock to
 * the gitignored SBOM_PATH and prints its component count and SHA-256.
 * `--out <path>` writes it there instead, so the Lab page's check can be
 * repeated without overwriting the file it is about.
 */

const outFlag = process.argv.indexOf("--out");
const outArg = outFlag === -1 ? undefined : process.argv[outFlag + 1];
if (outFlag !== -1 && (outArg === undefined || outArg === "")) {
  console.error("sbom: --out needs a path");
  process.exit(1);
}

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
};
const bom = buildBom(parseBunLock(readFileSync(resolve(root, "bun.lock"), "utf8")), pkg);
const text = bomText(bom);
const out = resolve(root, outArg ?? SBOM_PATH);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, text);
const sha = createHash("sha256").update(text).digest("hex");
console.log(
  `Wrote ${outArg ?? SBOM_PATH}: ${bom.components.length} components, sha256 ${sha}`,
);
