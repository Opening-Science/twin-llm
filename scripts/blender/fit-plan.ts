/**
 * Which atlas fits to run, on which pinned files, and where they write. Pure.
 *
 * Inputs are only the pinned anatomy files (packages/anatomy/manifest.ts and
 * rigged-bodies.ts), checked against their SHA-256 before Blender starts.
 * Outputs go to `data/anatomy/fitted/`, inside the gitignored anatomy dir:
 * they are derived from the CC BY 4.0 atlases and are never committed.
 */
import { join } from "node:path";

import { ATLASES, ATLAS_IDS, type AtlasId } from "../../packages/anatomy/manifest";
import { DEMO_BODY_IDS, type DemoBodyId } from "../../packages/anatomy/demo-bodies";
import { RIGGED_BODIES } from "../../packages/anatomy/rigged-bodies";

export const FITTED_DIR_NAME = "fitted";

export type PinnedInput = Readonly<{ path: string; sha256: string; bytes: number }>;

export type FitJob = Readonly<{
  bodyId: DemoBodyId;
  atlasId: AtlasId;
  scheme: "bodyparts3d" | "hra";
  atlas: PinnedInput;
  body: PinnedInput;
  out: string;
  report: string;
  /** File stem for renders: `<stem>.before.png`, `<stem>.after.png`. */
  renderName: string;
}>;

export const fittedDir = (anatomyDir: string): string =>
  join(anatomyDir, FITTED_DIR_NAME);

export const fitJobs = (
  anatomyDir: string,
  bodies: readonly DemoBodyId[] = DEMO_BODY_IDS,
  atlases: readonly AtlasId[] = ATLAS_IDS,
): FitJob[] =>
  bodies.flatMap((bodyId) =>
    atlases.map((atlasId) => {
      const atlas = ATLASES[atlasId];
      const body = RIGGED_BODIES[bodyId];
      const stem = `${bodyId}.${atlasId}`;
      return {
        bodyId,
        atlasId,
        scheme: atlas.scheme,
        atlas: {
          path: join(anatomyDir, atlas.fileName),
          sha256: atlas.sha256,
          bytes: atlas.bytes,
        },
        body: {
          path: join(anatomyDir, body.fileName),
          sha256: body.sha256,
          bytes: body.bytes,
        },
        out: join(fittedDir(anatomyDir), `${stem}.fitted.glb`),
        report: join(fittedDir(anatomyDir), `${stem}.report.json`),
        renderName: stem,
      };
    }),
  );

/** The arguments `fit_atlas.py` takes for one job. */
export const fitArgs = (
  job: FitJob,
  options: Readonly<{ renderDir: string | null; stretch: boolean }>,
): string[] => [
  "--atlas",
  job.atlas.path,
  "--scheme",
  job.scheme,
  "--body",
  job.body.path,
  "--out",
  job.out,
  "--report",
  job.report,
  ...(options.renderDir
    ? ["--render-dir", options.renderDir, "--render-name", job.renderName]
    : []),
  ...(options.stretch ? [] : ["--no-stretch"]),
];

/**
 * Never feed a person's scan to these scripts from here: BodyLoop data lives
 * under data/vitronic/ and stays there. True when a path points inside it.
 */
export const isPersonalDataPath = (absolutePath: string): boolean =>
  /(^|[\\/])data[\\/]vitronic([\\/]|$)/.test(absolutePath);
