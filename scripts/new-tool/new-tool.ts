/**
 * bun run new:tool <snake_name> [--root <dir>] [--no-format]
 *
 * Scaffolds one closed query tool in every place the contract needs it
 * (docs/query-layer.md, "How to add a tool"). Each piece carries `todo("…")`
 * calls that fail `bun run typecheck` until they are filled. Refuses a name
 * that is not snake_case or already exists. `--root` writes into another
 * checkout (the tests and `new:tool:prove` use it).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

import { scaffoldTool } from "./scaffold-tool";
import { ScaffoldError } from "./tool-edits";
import { toolNames } from "./tool-names";

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf("--root");
const root = rootFlag === -1 ? process.cwd() : (argv[rootFlag + 1] ?? "");
const format = !argv.includes("--no-format");
const name =
  argv.find(
    (arg, index) => !arg.startsWith("--") && (rootFlag === -1 || index !== rootFlag + 1),
  ) ?? "";

const run = (): number => {
  try {
    const result = scaffoldTool(root, name);
    const touched = [...result.created, ...result.edited];
    if (format) {
      const prettier = spawnSync(
        join(root, "node_modules", ".bin", "prettier"),
        ["--write", ...touched],
        { cwd: root, stdio: ["ignore", "ignore", "inherit"] },
      );
      if (prettier.status !== 0) console.error("prettier failed; run bun run format");
    }
    const names = toolNames(name);
    console.log(
      [
        `Scaffolded ${name}.`,
        "",
        "Created:",
        ...result.created.map((path) => `  ${path}`),
        "Edited:",
        ...result.edited.map((path) => `  ${path}`),
        "",
        "Left to do:",
        "  1. bun run typecheck: every todo() it lists is a decision still open.",
        `  2. Hand-compute the expected values in packages/query-tools/${names.kebab}.test.ts; bun test packages/query-tools.`,
        "  3. docs/query-layer.md: fill the TODO in the table row; add an Analytics bullet if it has maths.",
        "  4. bun run tools:snapshots, then review the manifest and openai-tools snapshot diff.",
        "  5. The tool joined COHORT_ANALYTICS_TOOLS (infrastructure/knowledge-sources.ts); move it to",
        "     COHORT_RECORD_TOOLS if it is a plain read, and keep the source description true.",
        `  6. evaluation/drafts/${names.kebab}.questions.ts: fill, move into questions.v1.json,`,
        "     rebuild the answer key offline (bun run eval:answer-key), delete the draft.",
        "  7. Remove leftover `todo` imports; bun run lint, bun run build, bun run test.",
      ].join("\n"),
    );
    return 0;
  } catch (error: unknown) {
    if (error instanceof ScaffoldError) {
      console.error(`new:tool: ${error.message}. Nothing was written.`);
      return 1;
    }
    throw error;
  }
};

process.exit(run());
