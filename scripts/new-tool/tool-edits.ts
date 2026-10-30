/**
 * Where one new tool goes: the files it adds and the anchored insertions into
 * existing files. Pure: file text in, file text out. An anchor that is missing
 * (or, where it must be unique, repeated) throws before anything is written,
 * so a refactor of a target file fails the scaffold loudly instead of
 * scattering half a tool.
 */
import {
  aiToolEntry,
  answerKeyRunCase,
  computeBlock,
  definitionEntry,
  docsRow,
  evalDraftFile,
  mcpRunnerEntry,
  rowCountCase,
  runBlock,
  schemaBlock,
  testFile,
  TODO_IMPORT_FROM_QUERY_TOOLS,
} from "./tool-templates";
import type { ToolNames } from "./tool-names";

export const PATHS = {
  schemas: "packages/query-tools/schemas.ts",
  stats: "packages/query-tools/stats.ts",
  // A new tool's run function lives with the warehouse reads; tools.ts is the index.
  tools: "packages/query-tools/warehouse-tools.ts",
  toolsIndex: "packages/query-tools/tools.ts",
  aiTools: "packages/query-tools/ai-tools.ts",
  mcpServer: "packages/query-tools/mcp-server.ts",
  viewSchema: "packages/query-tools/view-schema.ts",
  genomeConstants: "packages/carbon-x/constants.ts",
  knowledgeSources: "infrastructure/knowledge-sources.ts",
  knowledgeSourcesTest: "infrastructure/knowledge-sources.test.ts",
  skillsTest: "features/skills/skills.test.ts",
  trainingToolList: "scripts/training-data/chat-tool-list.test.ts",
  questionSet: "scripts/evaluation/question-set.ts",
  answerKey: "scripts/evaluation/build-answer-key.ts",
  docs: "docs/query-layer.md",
} as const;

export const newFilePaths = (names: ToolNames) => ({
  test: `packages/query-tools/${names.kebab}.test.ts`,
  evalDraft: `evaluation/drafts/${names.kebab}.questions.ts`,
});

export class ScaffoldError extends Error {}

type Where = "only" | "first" | "last";

const indexOfAnchor = (
  path: string,
  source: string,
  anchor: string,
  where: Where,
): number => {
  const first = source.indexOf(anchor);
  if (first === -1) {
    throw new ScaffoldError(`${path}: anchor not found: ${JSON.stringify(anchor)}`);
  }
  const last = source.lastIndexOf(anchor);
  if (where === "only" && first !== last) {
    throw new ScaffoldError(`${path}: anchor is not unique: ${JSON.stringify(anchor)}`);
  }
  return where === "last" ? last : first;
};

const insertBefore =
  (anchor: string, text: string, where: Where = "only") =>
  (path: string, source: string): string => {
    const at = indexOfAnchor(path, source, anchor, where);
    return source.slice(0, at) + text + source.slice(at);
  };

const insertAfter =
  (anchor: string, text: string, where: Where) =>
  (path: string, source: string): string => {
    const at = indexOfAnchor(path, source, anchor, where) + anchor.length;
    return source.slice(0, at) + text + source.slice(at);
  };

/** Inserts `text` before `anchor` that follows `after` (the first match after it). */
const insertBeforeWithin =
  (after: string, anchor: string, text: string) =>
  (path: string, source: string): string => {
    const start = indexOfAnchor(path, source, after, "only");
    const at = source.indexOf(anchor, start);
    if (at === -1) {
      throw new ScaffoldError(
        `${path}: anchor not found after ${JSON.stringify(after)}: ${JSON.stringify(anchor)}`,
      );
    }
    return source.slice(0, at) + text + source.slice(at);
  };

/** Index just past the string, template or comment that starts at `at`, or `at`. */
const skipNonCode = (source: string, at: number): number => {
  const char = source[at];
  const next = source[at + 1];
  if (char === "/" && next === "/") {
    const end = source.indexOf("\n", at);
    return end === -1 ? source.length : end;
  }
  if (char === "/" && next === "*") {
    const end = source.indexOf("*/", at + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (char === '"' || char === "'" || char === "`") {
    let i = at + 1;
    while (i < source.length && source[i] !== char) i += source[i] === "\\" ? 2 : 1;
    return i + 1;
  }
  return at;
};

/** Index of the `}` that closes the `{` at `open`, skipping strings and comments. */
const closingBrace = (path: string, source: string, open: number): number => {
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const skipped = skipNonCode(source, i);
    if (skipped !== i) {
      i = skipped;
      continue;
    }
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += 1;
  }
  throw new ScaffoldError(`${path}: unbalanced braces after offset ${open}`);
};

/**
 * Inserts `text` as the last entry of the object literal that the arrow
 * function declared by `declaration` returns (`= (...) => ({ ... })`). The
 * function is found by name and its object by matching braces, so another
 * function added after it, or a reordering of the file, cannot pull the
 * entry into the wrong object.
 */
export const insertLastEntryOf =
  (declaration: string, text: string) =>
  (path: string, source: string): string => {
    const start = indexOfAnchor(path, source, declaration, "only");
    const arrow = source.indexOf("=> ({", start);
    if (arrow === -1) {
      throw new ScaffoldError(
        `${path}: ${JSON.stringify(declaration)} does not return an object literal`,
      );
    }
    const close = closingBrace(path, source, arrow + "=> (".length);
    const lineStart = source.lastIndexOf("\n", close) + 1;
    if (source.slice(lineStart, close).trim() !== "") {
      throw new ScaffoldError(
        `${path}: the object ${JSON.stringify(declaration)} returns must close on its own line`,
      );
    }
    return source.slice(0, lineStart) + text + source.slice(lineStart);
  };

/**
 * Adds `name` to the sorted list of quoted names that follows `after`, one
 * per line up to the next `]`, keeping the order `.sort()` gives.
 */
const insertSorted =
  (after: string, name: string) =>
  (path: string, source: string): string => {
    const start = indexOfAnchor(path, source, after, "only") + after.length;
    const end = source.indexOf("]", start);
    const lines = source.slice(start, end).split("\n");
    const items = lines.flatMap((line) => {
      const match = /^(\s*)"([^"]+)",$/.exec(line);
      return match ? [{ indent: match[1] ?? "", name: match[2] ?? "" }] : [];
    });
    const indent = items[0]?.indent;
    if (indent === undefined) {
      throw new ScaffoldError(`${path}: no list of names after ${JSON.stringify(after)}`);
    }
    const sorted = [...items.map((item) => item.name), name].sort();
    const body = sorted.map((item) => `${indent}"${item}",`).join("\n");
    const tail = lines.at(-1) ?? "";
    return `${source.slice(0, start)}\n${body}\n${tail}${source.slice(end)}`;
  };

/** The `todo` import, once, however many tools are pending. */
const ensureTodoImport =
  (line: string, after: string) =>
  (path: string, source: string): string =>
    source.includes(line) ? source : insertAfter(after, line, "first")(path, source);

type Step = (path: string, source: string) => string;

export type FileEdit = Readonly<{ path: string; steps: readonly Step[] }>;

export const fileEdits = (names: ToolNames): readonly FileEdit[] => [
  {
    path: PATHS.schemas,
    steps: [
      ensureTodoImport(TODO_IMPORT_FROM_QUERY_TOOLS, 'import { z } from "zod";\n'),
      insertBefore("export const TOOL_DEFINITIONS = [", schemaBlock(names)),
      insertBefore("] as const;", definitionEntry(names), "last"),
    ],
  },
  {
    path: PATHS.stats,
    steps: [
      ensureTodoImport(TODO_IMPORT_FROM_QUERY_TOOLS, " */\n"),
      (_path, source) => source + computeBlock(names),
    ],
  },
  {
    path: PATHS.tools,
    steps: [
      ensureTodoImport(TODO_IMPORT_FROM_QUERY_TOOLS, 'import type { z } from "zod";\n'),
      // The first `} from "./schemas";` closes the type-only import.
      insertBefore('} from "./schemas";\nimport { windowEndDate', `  ${names.input},\n`),
      insertBefore('} from "./stats";', `  ${names.compute},\n`),
      (_path, source) => source + runBlock(names),
    ],
  },
  {
    path: PATHS.toolsIndex,
    steps: [
      insertBefore(
        '} from "./warehouse-tools";',
        `  type ${names.result},\n  ${names.run},\n`,
      ),
    ],
  },
  {
    path: PATHS.aiTools,
    steps: [
      insertBefore('} from "./schemas";', `  ${names.input},\n`),
      insertBefore('} from "./tools";', `  ${names.run},\n`),
      // Chat's query tools, not the imported-data tools after them (#256).
      insertLastEntryOf("export const createQueryTools = (", aiToolEntry(names)),
    ],
  },
  {
    path: PATHS.mcpServer,
    steps: [
      insertBefore('} from "./schemas";', `  ${names.input},\n`),
      insertBefore('} from "./tools";', `  ${names.run},\n`),
      insertBefore("});\n\nexport const QUERY_MCP_SERVER_INFO", mcpRunnerEntry(names)),
    ],
  },
  {
    // Owned by a source, so turning that source off removes it (forSources).
    path: PATHS.knowledgeSources,
    steps: [
      insertBeforeWithin(
        "export const COHORT_ANALYTICS_TOOLS = [",
        "] as const satisfies",
        `  "${names.snake}",\n`,
      ),
    ],
  },
  {
    path: PATHS.knowledgeSourcesTest,
    steps: [
      insertSorted(
        'disabledToolNames(["cohort-analytics", "gbd"])].sort()).toEqual([',
        names.snake,
      ),
      insertSorted(
        'disabledToolNames(["cohort-records"])].sort()).toEqual([',
        names.snake,
      ),
    ],
  },
  {
    path: PATHS.skillsTest,
    steps: [insertBefore(", gbd_population, genome_report", `, ${names.snake}`)],
  },
  {
    path: PATHS.trainingToolList,
    steps: [insertBefore('      "show_view",\n', `      "${names.snake}",\n`)],
  },
  {
    path: PATHS.questionSet,
    steps: [
      insertBefore('} from "../../packages/query-tools/schemas";', `  ${names.input},\n`),
      insertBefore(
        "} as const;\n\nexport type KeyedTool",
        `  ${names.snake}: ${names.input},\n`,
      ),
      insertBefore('  "guidelines.guideline_search",\n', `  "${names.snake}",\n`),
    ],
  },
  {
    path: PATHS.answerKey,
    steps: [
      insertBefore(
        '    case "latest_by_loinc":\n      return lengthAt',
        rowCountCase(names),
      ),
      insertBefore(
        '      case "latest_by_loinc":\n        return tools.runLatestByLoinc',
        answerKeyRunCase(names),
      ),
    ],
  },
  {
    path: PATHS.docs,
    steps: [insertBefore("| `guideline_search`", docsRow(names))],
  },
];

export const newFiles = (
  names: ToolNames,
): ReadonlyArray<Readonly<{ path: string; content: string }>> => {
  const paths = newFilePaths(names);
  return [
    { path: paths.test, content: testFile(names) },
    { path: paths.evalDraft, content: evalDraftFile(names) },
  ];
};

/** Files whose quoted tool names a new name must not repeat. */
export const NAME_REGISTRIES: readonly string[] = [
  PATHS.schemas,
  PATHS.viewSchema,
  PATHS.genomeConstants,
  PATHS.trainingToolList,
  PATHS.questionSet,
];

/** Identifiers the scaffold declares, and the file each one lands in. */
export const declaredIdentifiers = (
  names: ToolNames,
): ReadonlyArray<Readonly<{ path: string; identifier: string }>> => [
  { path: PATHS.schemas, identifier: names.input },
  { path: PATHS.tools, identifier: names.inputType },
  { path: PATHS.tools, identifier: names.run },
  { path: PATHS.tools, identifier: names.result },
  { path: PATHS.stats, identifier: names.compute },
];

export const applyEdit = (edit: FileEdit, source: string): string =>
  edit.steps.reduce((text, step) => step(edit.path, text), source);
