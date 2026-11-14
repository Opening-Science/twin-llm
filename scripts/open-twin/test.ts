/**
 * `bun run test:open-twin`: the tests copied with each open-twin package, run
 * under vitest (they use vi.mocked, vi.setSystemTime and vi.stubGlobal, which
 * Bun's test runner does not have), one process per package so a stubbed
 * global or fake clock cannot leak into another package.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGES_DIR = join(ROOT, "packages/open-twin");
const CONFIG = join(ROOT, "scripts/open-twin/vitest.config.ts");
const VITEST = join(ROOT, "node_modules/.bin/vitest");

/** Packages with code, and so with tests; anchor-layer is data only. */
const packagesWithSource = (): readonly string[] =>
  readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(PACKAGES_DIR, name, "src")))
    .sort();

const runPackage = (name: string): boolean => {
  console.log(`\n== open-twin/${name}`);
  const run = spawnSync(
    VITEST,
    ["run", "--root", join(PACKAGES_DIR, name), "--config", CONFIG],
    { cwd: ROOT, stdio: "inherit" },
  );
  return run.status === 0;
};

const failed = packagesWithSource().filter((name) => !runPackage(name));
if (failed.length > 0) {
  console.error(`\ntest:open-twin: failed in ${failed.join(", ")}`);
  process.exit(1);
}
console.log("\ntest:open-twin: every package passed");
