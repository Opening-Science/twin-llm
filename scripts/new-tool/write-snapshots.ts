/**
 * bun run tools:snapshots — rewrites the two committed tool manifests
 * (packages/query-tools/__snapshots__/) from TOOL_DEFINITIONS, for after a
 * tool was added or its schema changed. Review the diff: it is what models
 * and MCP clients will see. manifests.test.ts checks the files stay in step.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mcpToolManifest, openaiToolList } from "../../packages/query-tools/manifests";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = join(ROOT, "packages", "query-tools", "__snapshots__");

const write = (file: string, value: unknown): string => {
  writeFileSync(join(DIR, file), `${JSON.stringify(value, null, 2)}\n`);
  return join(DIR, file);
};

const written = [
  write("openai-tools.json", openaiToolList()),
  write("mcp-tools.json", mcpToolManifest()),
];

// The committed files are in Prettier's layout, as `bun run format:check` wants them.
const prettier = spawnSync(
  join(ROOT, "node_modules", ".bin", "prettier"),
  ["--write", ...written],
  { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] },
);
if (prettier.status !== 0) process.exit(1);
written.forEach((path) => console.log(`wrote ${path}`));
