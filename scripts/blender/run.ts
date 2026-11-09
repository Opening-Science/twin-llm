/**
 * Host CLI for the headless Blender pipeline (scripts/blender/*.py).
 *
 * Usage (from the repo root; needs Blender 5.2.x, found through BLENDER_BIN or PATH):
 *   bun run blender:fit-atlas                         # every rigged demo body × atlas
 *   bun run blender:fit-atlas --body anny-adult-f --atlas hra-f --render-dir <dir> [--stretch]
 *   bun run blender:cleanup                           # the damaged-ANNY demo
 *   bun run blender:cleanup --in <glb> --out-dir <dir> [--lods 0.5,0.25] [--voxel 0.005]
 *   bun run blender:self-check                        # both scripts on tiny synthetic meshes
 *
 * Without Blender it prints why and exits 0, so CI (which has none) skips.
 * Inputs for the fit are the pinned anatomy files, checked by SHA-256 before
 * Blender starts; outputs go to the gitignored data/anatomy/fitted/. The
 * cleanup refuses anything under data/vitronic/: it is tested on synthetic
 * ANNY only.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { isAtlasId } from "../../packages/anatomy/manifest";
import { DEMO_BODIES, isDemoBodyId } from "../../packages/anatomy/demo-bodies";
import { resolveAnatomyDir } from "../../packages/anatomy/paths";
import {
  blenderArgs,
  findOnPath,
  isSupportedBlender,
  parseBlenderVersion,
  resolveBlenderBin,
} from "./blender-bin";
import {
  fitArgs,
  fitJobs,
  fittedDir,
  isPersonalDataPath,
  type PinnedInput,
} from "./fit-plan";
import {
  jointTable,
  missedTargets,
  parseFitReport,
  stretchSummary,
  type LabelledReport,
} from "./fit-report";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");

const valueOf = (argv: readonly string[], flag: string): string | null => {
  const i = argv.indexOf(flag);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};

const pinMismatch = (input: PinnedInput): string | null => {
  if (!existsSync(input.path))
    return `${input.path} is missing. Run bun run anatomy:fetch.`;
  const bytes = readFileSync(input.path);
  const sha = createHash("sha256").update(bytes).digest("hex");
  return sha === input.sha256
    ? null
    : `${input.path} does not match its pin (SHA-256 ${sha}). Run bun run anatomy:fetch.`;
};

const runBlender = (bin: string, script: string, args: readonly string[]): number => {
  const result = spawnSync(bin, blenderArgs(join(here, script), args), {
    cwd: root,
    stdio: ["ignore", "inherit", "inherit"],
  });
  return result.status ?? 1;
};

const fitAtlas = async (
  bin: string,
  argv: readonly string[],
  anatomyDir: string,
): Promise<number> => {
  const bodyArg = valueOf(argv, "--body");
  const atlasArg = valueOf(argv, "--atlas");
  const bodies = bodyArg === null ? undefined : isDemoBodyId(bodyArg) ? [bodyArg] : null;
  const atlases = atlasArg === null ? undefined : isAtlasId(atlasArg) ? [atlasArg] : null;
  if (bodies === null || atlases === null) {
    console.error(
      `Unknown ${bodies === null ? `body ${bodyArg}` : `atlas ${atlasArg}`}.`,
    );
    return 2;
  }
  const jobs = fitJobs(anatomyDir, bodies, atlases);
  const inputs = new Map(
    jobs.flatMap((job) => [job.atlas, job.body]).map((i) => [i.path, i]),
  );
  const problems = [...inputs.values()]
    .map(pinMismatch)
    .filter((problem): problem is string => problem !== null);
  if (problems.length > 0) {
    for (const problem of problems) console.error(problem);
    return 1;
  }
  const renderArg = valueOf(argv, "--render-dir");
  const options = {
    renderDir: renderArg ? resolve(renderArg) : null,
    stretch: argv.includes("--stretch"),
  };
  const done: LabelledReport[] = [];
  for (const job of jobs) {
    console.log(`Fitting ${job.atlasId} to ${job.bodyId}…`);
    const status = runBlender(bin, "fit_atlas.py", fitArgs(job, options));
    if (status !== 0) {
      console.error(
        `fit_atlas.py failed for ${job.bodyId} × ${job.atlasId} (exit ${status}).`,
      );
      return status;
    }
    const report = parseFitReport(readFileSync(job.report, "utf8"));
    if (!report) {
      console.error(`${job.report} is not a fit report this script understands.`);
      return 1;
    }
    done.push({ body: DEMO_BODIES[job.bodyId].name, atlas: job.atlasId, report });
  }
  const summaryPath = join(fittedDir(anatomyDir), "fit-report.json");
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      done.map(({ body, atlas, report }) => ({
        bodyName: body,
        atlasId: atlas,
        ...report,
      })),
      null,
      2,
    )}\n`,
  );
  console.log(`\n${jointTable(done)}\n`);
  for (const { body, atlas, report } of done) {
    console.log(
      report.stretchLimbs
        ? `${body} × ${atlas}: stretch ${stretchSummary(report)}.`
        : `${body} × ${atlas}: bones keep their length, so knees can stand off ANNY's.`,
    );
    for (const note of report.notes) console.log(`  ${note}`);
    // Without --stretch a knee miss is the expected cost, not a failure.
    for (const row of report.stretchLimbs ? missedTargets(report) : []) {
      console.warn(
        `  ${row.joint} is ${row.afterDistanceM} m from the body's joint after the fit.`,
      );
    }
  }
  console.log(
    `\nWrote ${summaryPath}. The fitted files carry the atlases' CC BY 4.0 attribution (docs/anatomy.md).`,
  );
  console.log(
    "bun run anatomy:quantise-fitted makes the copies the viewer shows behind Fit atlas to body.",
  );
  return 0;
};

const cleanup = (bin: string, argv: readonly string[], anatomyDir: string): number => {
  const input = valueOf(argv, "--in");
  if (input === null) {
    // The demo: the static ANNY male, damaged on purpose, then cleaned.
    const demo = DEMO_BODIES["anny-adult-m"];
    const path = join(anatomyDir, demo.fileName);
    const problem = pinMismatch({ path, sha256: demo.sha256, bytes: demo.bytes });
    if (problem) {
      console.error(problem);
      return 1;
    }
    const defaults = [
      ["--out-dir", join(anatomyDir, "cleanup-demo")],
      ["--name", "anny-adult-m.damaged"],
    ].flatMap(([flag, value]) =>
      flag && value && !argv.includes(flag) ? [flag, value] : [],
    );
    return runBlender(bin, "cleanup_mesh.py", [
      "--in",
      path,
      ...defaults,
      "--demo-damage",
      ...argv,
    ]);
  }
  if (isPersonalDataPath(resolve(input))) {
    console.error(
      "The cleanup is not run on BodyLoop data from here; it is tested on synthetic ANNY only.",
    );
    return 2;
  }
  return runBlender(bin, "cleanup_mesh.py", argv);
};

const main = async (): Promise<number> => {
  const [task, ...argv] = process.argv.slice(2);
  const bin = resolveBlenderBin({
    envValue: process.env.BLENDER_BIN,
    which: (command) => findOnPath(command, process.env.PATH, existsSync),
    exists: existsSync,
  });
  if (bin.kind === "missing") {
    console.log(bin.message);
    return 0;
  }
  const versionRun = spawnSync(bin.path, ["--version"], { encoding: "utf8" });
  const version = parseBlenderVersion(versionRun.stdout ?? "");
  if (!isSupportedBlender(version)) {
    console.error(
      `${bin.path} is ${version ? `Blender ${version.major}.${version.minor}.${version.patch}` : "not a Blender this script can read"}; the pipeline needs Blender 5.2.x LTS. Set BLENDER_BIN.`,
    );
    return 1;
  }
  const anatomyDir = resolveAnatomyDir(process.env.ANATOMY_DATA_DIR, root);
  if (task === "fit-atlas") return fitAtlas(bin.path, argv, anatomyDir);
  if (task === "cleanup") return cleanup(bin.path, argv, anatomyDir);
  if (task === "self-check") {
    const fit = runBlender(bin.path, "fit_atlas.py", ["--self-check"]);
    const clean = runBlender(bin.path, "cleanup_mesh.py", ["--self-check"]);
    return fit === 0 && clean === 0 ? 0 : 1;
  }
  console.error(
    "Usage: bun scripts/blender/run.ts fit-atlas|cleanup|self-check [options]",
  );
  return 2;
};

if ((import.meta as { main?: boolean }).main) {
  process.exit(await main());
}
