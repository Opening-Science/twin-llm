/**
 * The programs a local TwinLLM needs, how to tell their version, and how to
 * install each one with Homebrew (macOS) or apt (Debian/Ubuntu). Pure: the
 * probing lives in `detect.ts`. Setup never installs a system package; it
 * prints these commands.
 */

export type Platform = "darwin" | "linux";

export const TOOL_IDS = [
  "bun",
  "node",
  "git",
  "python3",
  "java",
  "shasum",
  "curl",
  "uv",
  "zstd",
  "ollama",
] as const;

export type ToolId = (typeof TOOL_IDS)[number];

/** What `<tool> --version` (or `java -version`) printed, or null when it did not run. */
export type ToolProbe = Readonly<{ output: string | null }>;

export type ToolSpec = Readonly<{
  label: string;
  /** What breaks without it. */
  neededFor: string;
  /** The smallest major (or major.minor.patch) that works, when one matters. */
  minimum: string | null;
  install: Readonly<Record<Platform, string>>;
}>;

export const TOOLS: Readonly<Record<ToolId, ToolSpec>> = {
  bun: {
    label: "Bun",
    neededFor: "everything (package manager and scripts)",
    minimum: "1.4.2",
    install: {
      darwin: "brew install oven-sh/bun/bun",
      linux: "curl -fsSL https://bun.sh/install | bash",
    },
  },
  node: {
    label: "Node.js",
    neededFor: "next dev and next build",
    minimum: "26",
    install: {
      darwin: "brew install node@26 && brew link --overwrite node@26",
      linux: "install Node.js 26 from https://nodejs.org (or nvm install 26)",
    },
  },
  git: {
    label: "git",
    neededFor: "sync:open-twin",
    minimum: null,
    install: { darwin: "xcode-select --install", linux: "sudo apt install git" },
  },
  python3: {
    label: "Python 3",
    neededFor: "sync:open-twin (rewrites package.json files)",
    minimum: null,
    install: { darwin: "xcode-select --install", linux: "sudo apt install python3" },
  },
  java: {
    label: "Java",
    neededFor: "Synthea (generating the synthetic cohort)",
    minimum: "21",
    install: {
      darwin:
        "brew install openjdk@21 && echo 'export PATH=\"$(brew --prefix openjdk@21)/bin:$PATH\"' >> ~/.zshrc",
      linux: "sudo apt install openjdk-21-jre-headless",
    },
  },
  shasum: {
    label: "shasum",
    neededFor: "Synthea (checks the JAR and the cohort)",
    minimum: null,
    install: { darwin: "ships with macOS", linux: "sudo apt install perl" },
  },
  curl: {
    label: "curl",
    neededFor: "Synthea (downloads the JAR)",
    minimum: null,
    install: { darwin: "ships with macOS", linux: "sudo apt install curl" },
  },
  uv: {
    label: "uv",
    neededFor: "anatomy:bake-rigged (Demo bodies that walk)",
    minimum: null,
    install: {
      darwin: "brew install uv",
      linux: "curl -LsSf https://astral.sh/uv/install.sh | sh",
    },
  },
  zstd: {
    label: "zstd",
    neededFor: "--cohort-10k (unpacks the release archive)",
    minimum: null,
    install: { darwin: "brew install zstd", linux: "sudo apt install zstd" },
  },
  ollama: {
    label: "Ollama",
    neededFor: "chat with a local model",
    minimum: null,
    install: {
      darwin: "brew install ollama && brew services start ollama",
      linux: "curl -fsSL https://ollama.com/install.sh | sh",
    },
  },
};

/** Postgres and pgvector are not programs on PATH; these are their install lines. */
export const POSTGRES_INSTALL: Readonly<Record<Platform, string>> = {
  darwin: "brew install postgresql@18 && brew services start postgresql@18",
  linux: "sudo apt install postgresql && sudo systemctl start postgresql",
};

export const pgvectorInstall = (
  platform: Platform,
  serverMajor: number | null,
): string =>
  platform === "darwin"
    ? "brew install pgvector, then brew services restart postgresql@18 (brew info pgvector lists the Postgres versions it supports)"
    : `sudo apt install postgresql-${serverMajor ?? "<major>"}-pgvector (PGDG apt repository)`;

/** A dotted version first (`v1.5.7` in "Zstandard CLI (64-bit) v1.5.7"), else a bare number. */
const DOTTED = /(\d+)\.(\d+)(?:\.(\d+))?/;
const BARE = /(\d+)/;

/**
 * The version a tool printed, as [major, minor, patch]. Java 8 and older print
 * `1.8.0`, which is major 8. Null when there is no number in the output.
 */
export const parseVersion = (
  tool: ToolId,
  output: string,
): readonly [number, number, number] | null => {
  const source =
    tool === "java" ? (/version "([^"]+)"/.exec(output)?.[1] ?? null) : output;
  if (source === null) return null;
  const match = DOTTED.exec(source) ?? BARE.exec(source);
  if (!match) return null;
  const parts = [match[1], match[2], match[3]].map((part) => Number(part ?? 0));
  const [major = 0, minor = 0, patch = 0] = parts;
  return tool === "java" && major === 1 ? [minor, patch, 0] : [major, minor, patch];
};

const atLeast = (
  got: readonly [number, number, number],
  minimum: readonly [number, number, number],
): boolean => {
  for (let i = 0; i < 3; i += 1) {
    const a = got[i] ?? 0;
    const b = minimum[i] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
};

export type ToolCheck =
  | Readonly<{ id: ToolId; status: "ok"; version: string | null }>
  | Readonly<{ id: ToolId; status: "missing" | "too-old"; detail: string; fix: string }>;

/** Whether one probed tool is usable, and if not, how to install it here. */
export const checkTool = (
  id: ToolId,
  probe: ToolProbe,
  platform: Platform,
): ToolCheck => {
  const spec = TOOLS[id];
  const fix = spec.install[platform];
  if (probe.output === null) {
    return { id, status: "missing", detail: `${spec.label} not found`, fix };
  }
  const version = parseVersion(id, probe.output);
  if (spec.minimum === null) {
    return { id, status: "ok", version: version ? version.join(".") : null };
  }
  const minimum = parseVersion("bun", spec.minimum);
  if (version === null) {
    return {
      id,
      status: "missing",
      detail: `${spec.label} did not report a version`,
      fix,
    };
  }
  if (minimum !== null && !atLeast(version, minimum)) {
    return {
      id,
      status: "too-old",
      detail: `${spec.label} ${version.join(".")} found, ${spec.minimum} or newer needed`,
      fix,
    };
  }
  return { id, status: "ok", version: version.join(".") };
};
