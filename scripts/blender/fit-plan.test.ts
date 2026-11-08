import { expect, test } from "bun:test";

import { ATLASES } from "../../packages/anatomy/manifest";
import { RIGGED_BODIES } from "../../packages/anatomy/rigged-bodies";
import { fitArgs, fitJobs, isPersonalDataPath } from "./fit-plan";

test("fitJobs covers every rigged body and atlas, on the pinned files", () => {
  const jobs = fitJobs("/data/anatomy");
  expect(jobs.map((job) => `${job.bodyId}.${job.atlasId}`)).toEqual([
    "anny-adult-m.bodyparts3d",
    "anny-adult-m.hra-f",
    "anny-adult-m.hra-m",
    "anny-adult-f.bodyparts3d",
    "anny-adult-f.hra-f",
    "anny-adult-f.hra-m",
  ]);
  const first = jobs[0];
  expect(first?.atlas).toEqual({
    path: "/data/anatomy/bodyparts3d.ao.glb",
    sha256: ATLASES.bodyparts3d.sha256,
    bytes: ATLASES.bodyparts3d.bytes,
  });
  expect(first?.body).toEqual({
    path: "/data/anatomy/anny-adult-m.rigged.glb",
    sha256: RIGGED_BODIES["anny-adult-m"].sha256,
    bytes: RIGGED_BODIES["anny-adult-m"].bytes,
  });
  expect(first?.out).toBe("/data/anatomy/fitted/anny-adult-m.bodyparts3d.fitted.glb");
  expect(first?.report).toBe("/data/anatomy/fitted/anny-adult-m.bodyparts3d.report.json");
  expect(jobs[1]?.scheme).toBe("hra");
});

test("fitJobs narrows to one body and one atlas", () => {
  expect(fitJobs("/a", ["anny-adult-f"], ["hra-f"]).map((job) => job.renderName)).toEqual(
    ["anny-adult-f.hra-f"],
  );
});

test("fitArgs passes renders and the no-stretch switch only when asked", () => {
  const [job] = fitJobs("/a", ["anny-adult-f"], ["hra-f"]);
  if (!job) throw new Error("no job");
  expect(fitArgs(job, { renderDir: null, stretch: true })).toEqual([
    "--atlas",
    "/a/hra.ao.glb",
    "--scheme",
    "hra",
    "--body",
    "/a/anny-adult-f.rigged.glb",
    "--out",
    "/a/fitted/anny-adult-f.hra-f.fitted.glb",
    "--report",
    "/a/fitted/anny-adult-f.hra-f.report.json",
  ]);
  expect(fitArgs(job, { renderDir: "/shots", stretch: false }).slice(10)).toEqual([
    "--render-dir",
    "/shots",
    "--render-name",
    "anny-adult-f.hra-f",
    "--no-stretch",
  ]);
});

test("isPersonalDataPath spots BodyLoop data and nothing else", () => {
  expect(isPersonalDataPath("/repo/data/vitronic/subject-1/scan.glb")).toBe(true);
  expect(isPersonalDataPath("C:\\repo\\data\\vitronic\\scan.glb")).toBe(true);
  expect(isPersonalDataPath("/repo/data/vitronic")).toBe(true);
  expect(isPersonalDataPath("/repo/data/anatomy/anny-adult-m.pose-bodyparts3d.glb")).toBe(
    false,
  );
  expect(isPersonalDataPath("/repo/data/vitronic-notes/x.glb")).toBe(false);
});
