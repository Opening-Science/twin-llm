/**
 * bun run new:tool:prove — local proof that a fresh scaffold fails the real
 * typecheck on its todo() markers and on nothing else.
 *
 * Copies this checkout (without node_modules, .git, .next and data/) to a
 * temporary folder, links node_modules, scaffolds a throwaway tool there and
 * runs `tsc --noEmit` over the whole project. Passes when tsc fails, every
 * error is a todo() marker, and there is one error per marker. Takes a few
 * minutes, so CI runs the faster checks in new-tool.test.ts instead.
 * The checkout itself is never touched.
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { scaffoldTool } from "./scaffold-tool";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOOL = "prove_new_tool";
const SKIPPED = new Set([
  "node_modules",
  ".git",
  ".next",
  "data",
  "tsconfig.tsbuildinfo",
]);

const root = mkdtempSync(join(tmpdir(), "new-tool-prove-"));

const prove = (): number => {
  cpSync(REPO, root, {
    recursive: true,
    filter: (source) => {
      const path = relative(REPO, source);
      return path === "" || !SKIPPED.has(path.split("/")[0] ?? "");
    },
  });
  symlinkSync(join(REPO, "node_modules"), join(root, "node_modules"));

  const { created, edited } = scaffoldTool(root, TOOL);
  const markers = [...created, ...edited]
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
    .reduce(
      (total, path) =>
        total +
        (readFileSync(join(root, path), "utf8").match(/\btodo\("|\btodo\(\n/g) ?? [])
          .length,
      0,
    );

  console.log(`scaffolded ${TOOL} in ${root}; running tsc (a few minutes)…`);
  const tsc = spawnSync(
    join(REPO, "node_modules", ".bin", "tsc"),
    ["--noEmit", "-p", root],
    {
      cwd: root,
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=8192" },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  const errors = tsc.stdout.split("\n").filter((line) => / error TS\d+:/.test(line));
  const todoErrors = errors.filter((line) => line.includes("& TodoFillIn'"));
  const others = errors.filter((line) => !line.includes("& TodoFillIn'"));

  console.log(todoErrors.join("\n"));
  if (others.length > 0) console.error(`\nNot todo markers:\n${others.join("\n")}`);
  console.log(
    `\ntsc exit ${tsc.status}; ${todoErrors.length} todo errors for ${markers} markers; ${others.length} other errors`,
  );
  const proven = tsc.status !== 0 && others.length === 0 && todoErrors.length === markers;
  console.log(proven ? "PROVEN" : "NOT PROVEN");
  return proven ? 0 : 1;
};

const code = prove();
rmSync(root, { recursive: true, force: true });
process.exit(code);
