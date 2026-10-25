import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export const BANNED_TERMS = [
  { id: "diagnos", source: String.raw`\bdiagnos` },
  { id: "treat", source: String.raw`\btreat` },
  { id: "prescri", source: String.raw`\bprescri` },
  { id: "cure", source: String.raw`\bcure\b` },
  { id: "medical advice", source: String.raw`\bmedical advice\b` },
  { id: "risk of", source: String.raw`\brisk of\b` },
  { id: "you have", source: String.raw`\byou have\b` },
  { id: "your condition", source: String.raw`\byour condition\b` },
  { id: "symptom", source: String.raw`\bsymptom` },
] as const;

const bannedRes = BANNED_TERMS.map((term) => ({
  id: term.id,
  re: new RegExp(term.source, "i"),
}));

export const allowlistEntrySchema = z.object({
  file: z.string().min(1),
  "line-pattern": z.string().min(1),
  reason: z.string().min(1),
});

export const allowlistSchema = z.array(allowlistEntrySchema);

export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;

export type ClaimHit = {
  file: string;
  line: number;
  term: string;
};

export type AllowlistedHit = ClaimHit & {
  reason: string;
};

export type ClaimReport = {
  findings: ClaimHit[];
  allowlisted: AllowlistedHit[];
};

export type ScanUnit = {
  line: number;
  text: string;
};

const SKIP_TEST = /\.test\.tsx?$/;

const isTestFile = (rel: string): boolean => SKIP_TEST.test(rel);

const walkFiles = (abs: string, acc: string[]): void => {
  const st = statSync(abs);
  if (st.isDirectory()) {
    for (const name of readdirSync(abs)) {
      if (name === "node_modules" || name === ".git" || name === ".next") continue;
      walkFiles(join(abs, name), acc);
    }
    return;
  }
  acc.push(abs);
};

const lineAt = (source: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
};

export const extractTsCopy = (source: string, includeJsx: boolean): ScanUnit[] => {
  const units: ScanUnit[] = [];
  const n = source.length;
  let i = 0;

  const push = (text: string, start: number) => {
    if (text.length === 0) return;
    units.push({ line: lineAt(source, start), text });
  };

  const readUntil = (quote: string): string => {
    let text = "";
    while (i < n) {
      const ch = source[i];
      if (ch === "\\") {
        text += ch + (source[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (ch === quote) {
        i += 1;
        return text;
      }
      text += ch;
      i += 1;
    }
    return text;
  };

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const start = i + 1;
      i += 1;
      push(readUntil(ch), start);
      continue;
    }
    if (ch === "`") {
      const start = i + 1;
      i += 1;
      let text = "";
      while (i < n) {
        const c = source[i];
        if (c === "\\") {
          text += c + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (c === "`") {
          i += 1;
          break;
        }
        if (c === "$" && source[i + 1] === "{") {
          push(text, start);
          text = "";
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (source[i] === "{") depth += 1;
            else if (source[i] === "}") depth -= 1;
            i += 1;
          }
          continue;
        }
        text += c;
        i += 1;
      }
      push(text, start);
      continue;
    }
    if (includeJsx && ch === ">" && source[i - 1] !== "=" && source[i - 1] !== "-") {
      i += 1;
      let j = i;
      while (j < n && (source[j] === " " || source[j] === "\t" || source[j] === "\n")) {
        j += 1;
      }
      const peek = source[j];
      if (peek && peek !== "<" && peek !== "{") {
        const start = i;
        let text = "";
        while (i < n && source[i] !== "<") {
          text += source[i];
          i += 1;
        }
        if (text.trim().length > 0) push(text, start);
        continue;
      }
      continue;
    }
    i += 1;
  }

  return units;
};

export const extractMarkdownLines = (source: string): ScanUnit[] =>
  source.split(/\n/).map((text, idx) => ({ line: idx + 1, text }));

const hitsInUnits = (file: string, units: ScanUnit[]): ClaimHit[] => {
  const hits: ClaimHit[] = [];
  for (const unit of units) {
    for (const term of bannedRes) {
      if (term.re.test(unit.text)) {
        hits.push({ file, line: unit.line, term: term.id });
      }
    }
  }
  return hits;
};

const matchingAllowlist = (
  hit: ClaimHit,
  lineText: string,
  allowlist: readonly AllowlistEntry[],
): AllowlistEntry | undefined =>
  allowlist.find((entry) => {
    if (entry.file !== hit.file) return false;
    return new RegExp(entry["line-pattern"]).test(lineText);
  });

export const collectScanTargets = (root: string): string[] => {
  const targets: string[] = [];
  const readme = join(root, "README.md");
  try {
    if (statSync(readme).isFile()) targets.push(readme);
  } catch {
    // optional in fixture roots
  }

  // docs/ and the OpenTwin knowledge corpus (knowledge/, read by the model).
  for (const dir of ["docs", "knowledge"]) {
    const absDir = join(root, dir);
    try {
      if (!statSync(absDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const found: string[] = [];
    walkFiles(absDir, found);
    for (const abs of found) {
      const rel = relative(root, abs).split("\\").join("/");
      if (!rel.endsWith(".md")) continue;
      targets.push(abs);
    }
  }

  // packages/biomarkers holds user-facing notes (region and vital wording).
  for (const dir of ["app", "features", "packages/biomarkers"]) {
    const absDir = join(root, dir);
    try {
      if (!statSync(absDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const found: string[] = [];
    walkFiles(absDir, found);
    for (const abs of found) {
      const rel = relative(root, abs).split("\\").join("/");
      if (isTestFile(rel)) continue;
      if (rel.endsWith(".ts") || rel.endsWith(".tsx")) targets.push(abs);
    }
  }

  return targets;
};

export const scanClaims = (options: {
  readonly root: string;
  readonly allowlist: readonly AllowlistEntry[];
}): ClaimReport => {
  const allowlist = allowlistSchema.parse(options.allowlist);
  const findings: ClaimHit[] = [];
  const allowlisted: AllowlistedHit[] = [];

  for (const abs of collectScanTargets(options.root)) {
    const rel = relative(options.root, abs).split("\\").join("/");
    const source = readFileSync(abs, "utf8");
    const units = rel.endsWith(".md")
      ? extractMarkdownLines(source)
      : extractTsCopy(source, rel.endsWith(".tsx"));
    const fileHits = hitsInUnits(rel, units);
    const lines = source.split(/\n/);
    for (const hit of fileHits) {
      const lineText = lines[hit.line - 1] ?? "";
      const entry = matchingAllowlist(hit, lineText, allowlist);
      if (entry) {
        allowlisted.push({ ...hit, reason: entry.reason });
      } else {
        findings.push(hit);
      }
    }
  }

  return { findings, allowlisted };
};

export const lintClaims = (options: {
  readonly root: string;
  readonly allowlist: readonly AllowlistEntry[];
}): ClaimHit[] => scanClaims(options).findings;

export const loadAllowlist = (root: string): AllowlistEntry[] => {
  const raw = JSON.parse(
    readFileSync(join(root, "docs", "claims-allowlist.json"), "utf8"),
  ) as unknown;
  return allowlistSchema.parse(raw);
};

export const formatHits = (hits: readonly ClaimHit[]): string =>
  hits.map((hit) => `${hit.file}:${hit.line}`).join("\n");

export const formatReport = (report: ClaimReport): string => {
  const lines = [
    `${report.findings.length} findings`,
    `${report.allowlisted.length} allowlisted`,
    ...report.allowlisted.map((hit) => `${hit.file}:${hit.line} ${hit.reason}`),
  ];
  return lines.join("\n");
};

const invokedAsCli = process.argv[1]?.endsWith("lint-claims.ts") === true;

if (invokedAsCli) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const report = scanClaims({ root, allowlist: loadAllowlist(root) });
  if (report.findings.length > 0) {
    console.error(formatHits(report.findings));
    process.exit(1);
  }
  console.log(formatReport(report));
}
