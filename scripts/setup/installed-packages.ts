import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { checkPrismaClient } from "./prisma-client";

/**
 * Whether `node_modules` still matches `package.json`. A pull that adds or
 * bumps a dependency (#154 added `ollama-ai-provider-v2`) otherwise breaks
 * `bun run dev` with "Module not found" until someone runs `bun install`.
 * `bun run dev` runs this first and installs when something is stale, then
 * regenerates the Prisma client when the schema moved on without it;
 * `bun run doctor` reports both.
 */

export type PackageProblem = Readonly<{
  name: string;
  wanted: string;
  /** The installed version, or null when the package is not installed. */
  installed: string | null;
}>;

type Manifest = Readonly<{
  dependencies?: Readonly<Record<string, string>>;
  devDependencies?: Readonly<Record<string, string>>;
}>;

/** A range Bun can check; workspace, file, git and URL specs are skipped. */
const isSemverRange = (range: string): boolean =>
  !/^(workspace:|file:|link:|git|https?:|npm:|github:)/.test(range) &&
  !range.includes("/");

/**
 * Pure: every declared dependency whose installed version is missing or
 * outside its range. `installedVersion` reads one package's installed version.
 */
export const stalePackages = (
  manifest: Manifest,
  installedVersion: (name: string) => string | null,
  satisfies: (version: string, range: string) => boolean,
): readonly PackageProblem[] =>
  Object.entries({ ...manifest.dependencies, ...manifest.devDependencies })
    .filter(([, range]) => isSemverRange(range))
    .flatMap(([name, wanted]) => {
      const installed = installedVersion(name);
      return installed !== null && satisfies(installed, wanted)
        ? []
        : [{ name, wanted, installed }];
    });

const readInstalledVersion =
  (root: string) =>
  (name: string): string | null => {
    const file = join(root, "node_modules", name, "package.json");
    if (!existsSync(file)) return null;
    try {
      const { version } = JSON.parse(readFileSync(file, "utf8")) as { version?: unknown };
      return typeof version === "string" ? version : null;
    } catch {
      return null;
    }
  };

/** Bun's own semver, typed here because the app's types do not include Bun's globals. */
const bunSatisfies = (version: string, range: string): boolean =>
  (
    globalThis as unknown as {
      Bun: { semver: { satisfies: (version: string, range: string) => boolean } };
    }
  ).Bun.semver.satisfies(version, range);

export const checkInstalledPackages = (root: string): readonly PackageProblem[] => {
  const manifest = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ) as Manifest;
  return stalePackages(manifest, readInstalledVersion(root), bunSatisfies);
};

export const describeProblems = (problems: readonly PackageProblem[]): string =>
  problems
    .slice(0, 5)
    .map(({ name, wanted, installed }) =>
      installed === null
        ? `${name} (not installed)`
        : `${name} ${installed}, wants ${wanted}`,
    )
    .join(", ") + (problems.length > 5 ? ` and ${problems.length - 5} more` : "");

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const problems = checkInstalledPackages(root);
  if (problems.length > 0) {
    process.stdout.write(
      `Packages changed since the last install: ${describeProblems(problems)}. Running bun install…\n`,
    );
    const install = spawnSync("bun", ["install"], { cwd: root, stdio: "inherit" });
    if (install.status !== 0) process.exit(install.status ?? 1);
  }
  // bun install runs prisma generate, so this is usually ok by now.
  const client = checkPrismaClient(root);
  if (client !== "ok") {
    process.stdout.write(
      `The Prisma client is ${client === "missing" ? "missing" : "older than prisma/schema.prisma"}. Running prisma generate…\n`,
    );
    const generate = spawnSync("bunx", ["prisma", "generate"], {
      cwd: root,
      stdio: "inherit",
    });
    process.exit(generate.status ?? 1);
  }
}
