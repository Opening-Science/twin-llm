/**
 * Host CLI: copy the licensed brand web fonts into public/fonts/.
 *
 * Usage (from repo root):
 *   bun run fonts:install              # from BRAND_FONTS_DIR, else the default folder
 *   bun run fonts:install <dir>        # from <dir>
 *   bun run fonts:install --check      # report what public/fonts/ holds, copy nothing
 *   bun run fonts:install --force      # also replace a file in public/fonts/ whose hash is wrong
 *
 * Selecta (Maxitype) and ABC Diatype Semi Mono (Dinamo) are licensed to the
 * Open Science Foundation. The files never enter git: public/fonts/ ignores
 * them. Each file is checked against its pinned SHA-256 before it is copied,
 * so a renamed or different file is refused. A missing folder or file is not a
 * build error; the CSS falls back to system faces.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The WOFF2 files the CSS asks for, with the hashes of the licensed set. */
export const BRAND_FONTS: Readonly<Record<string, string>> = {
  "Selecta-Regular.woff2":
    "3c21983fd4c8ae818bd85fdf300a43b7ff04ff35ec45f1bb1c186cb5b7f6c7a6",
  "Selecta-Italic.woff2":
    "64d81af391010d335a6f3ff97da9b7b491547c17ae0f9ece86c08ef2c686eca4",
  "Selecta-Medium.woff2":
    "8e5d88f8111cdbb5aebb2eec7ef3150645c26532cb1f9c7d9daf5427b25e308a",
  "Selecta-MediumItalic.woff2":
    "9e1d139aed8496582cf11b4a442c99ab4de1a89d3e486faddd77ad4a3ebcfd99",
  "Selecta-Bold.woff2":
    "faf0d34feac5f36323edc0a0091b1c73416a64de5871de1dc30c3403b955f27d",
  "Selecta-BoldItalic.woff2":
    "530c97498d31122eeaed296b13619f553b618db28912b27a92339eee2f1abc8e",
  "ABCDiatypeSemiMono-Regular.woff2":
    "19d6c742d20cf3572c7295884af1d8f4c8f6b79fe5a9175e42c402524b343c70",
  "ABCDiatypeSemiMono-RegularItalic.woff2":
    "2510477baca7e5d38c9ba26b066359ae421e36fdb66642f27e08a9526628fb8e",
  "ABCDiatypeSemiMono-Bold.woff2":
    "55830765bddac90699b4df6e45a83e6c4cd58c890f95d34ae7416486b5d27234",
  "ABCDiatypeSemiMono-BoldItalic.woff2":
    "9c8c6aa2acc6c55d4da59d4e8368ec63b93ab55b2c7d0d3a1fdf77138d8a4d86",
};

/** Where the licensed set lives on the foundation's machines. */
export const defaultFontsDir = (home: string): string =>
  join(home, "Developer", "osf-brand", "fonts");

export type InstallIo = Readonly<{
  stdout: { write: (chunk: string) => void };
  stderr: { write: (chunk: string) => void };
}>;

export type InstallDeps = Readonly<{
  /** The file's bytes, or null when it does not exist. */
  readFile: (path: string) => Promise<Uint8Array | null>;
  writeFile: (path: string, bytes: Uint8Array) => Promise<void>;
  mkdir: (dir: string) => Promise<void>;
  sha256: (bytes: Uint8Array) => string;
  /** public/fonts/ in this checkout. */
  targetDir: string;
  /** Used when no folder is passed on the command line. */
  defaultSourceDir: string;
  fonts?: Readonly<Record<string, string>>;
}>;

type Outcome = "installed" | "replaced" | "present" | "missing" | "mismatch";

export const runFontsInstall = async (
  argv: readonly string[],
  io: InstallIo,
  deps: InstallDeps,
): Promise<number> => {
  const fonts = deps.fonts ?? BRAND_FONTS;
  const check = argv.includes("--check");
  const force = argv.includes("--force");
  const sourceDir = argv.find((arg) => !arg.startsWith("--")) ?? deps.defaultSourceDir;

  if (!check) await deps.mkdir(deps.targetDir);

  const outcomes: Outcome[] = [];
  for (const [name, pin] of Object.entries(fonts)) {
    const target = join(deps.targetDir, name);
    const installed = await deps.readFile(target);
    if (installed && deps.sha256(installed) === pin) {
      io.stdout.write(`present    ${name}\n`);
      outcomes.push("present");
      continue;
    }
    if (check) {
      io.stdout.write(`${installed ? "mismatch" : "missing "}   ${name}\n`);
      outcomes.push(installed ? "mismatch" : "missing");
      continue;
    }
    // A wrong file already in place is somebody's; replace it only when asked.
    if (installed && !force) {
      io.stderr.write(
        `mismatch   ${name}: public/fonts/ holds a different file; rerun with --force to replace it\n`,
      );
      outcomes.push("mismatch");
      continue;
    }
    const source = join(sourceDir, name);
    const bytes = await deps.readFile(source);
    if (!bytes) {
      io.stderr.write(`missing    ${name} (not in ${sourceDir})\n`);
      outcomes.push("missing");
      continue;
    }
    if (deps.sha256(bytes) !== pin) {
      io.stderr.write(`mismatch   ${name}: not the licensed file, not copied\n`);
      outcomes.push("mismatch");
      continue;
    }
    // Write the bytes that were hashed, so nothing can change between check and copy.
    await deps.writeFile(target, bytes);
    io.stdout.write(
      installed ? `replaced   ${name} (was mismatched)\n` : `installed  ${name}\n`,
    );
    outcomes.push(installed ? "replaced" : "installed");
  }

  const bad = outcomes.filter((o) => o === "missing" || o === "mismatch").length;
  if (bad > 0) {
    io.stderr.write(
      `${bad} of ${outcomes.length} fonts not in place. The app falls back to system fonts.\n`,
    );
    return 1;
  }
  return 0;
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const code = await runFontsInstall(process.argv.slice(2), process, {
    readFile: async (path) => {
      try {
        return new Uint8Array(await readFile(path));
      } catch {
        return null;
      }
    },
    writeFile: (path, bytes) => writeFile(path, bytes),
    mkdir: async (dir) => {
      await mkdir(dir, { recursive: true });
    },
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    targetDir: join(root, "public", "fonts"),
    defaultSourceDir: process.env.BRAND_FONTS_DIR || defaultFontsDir(homedir()),
  });
  process.exit(code);
}
