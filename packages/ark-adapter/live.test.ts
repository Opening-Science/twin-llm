import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { afterAll, describe, expect, mock, test } from "bun:test";

import type { ArkResult } from "./codes";

mock.module("server-only", () => ({}));

const runLive = Reflect.get(process.env, "RUN_ARK") === "1";
const configured = Reflect.get(process.env, "ARK_DEVICE");
const device =
  typeof configured === "string" && configured.length > 0 ? configured : "alpha-002";

const RSID_GENOTYPES_PANEL = [
  "rs4244285",
  "rs4986893",
  "rs12248560",
  "rs1799853",
  "rs1057910",
  "rs3892097",
  "rs1065852",
  "rs4149056",
  "rs3918290",
  "rs1142345",
  "rs9923231",
] as const;

const RSID_GENOTYPES_GRANTS = RSID_GENOTYPES_PANEL.map(
  (rsid) => `v1/genome/rsids/${rsid}`,
);

const failUnlessOk = <T>(label: string, result: ArkResult<T>): T => {
  if (result.status === "ok") return result.data;
  const issues = result.error.issues?.join("; ") ?? "";
  throw new Error(
    `${label} state=${result.status} error.code=${result.error.code} zod issues: ${issues}`,
  );
};

describe.skipIf(!runLive)("ark-adapter live device (RUN_ARK=1)", () => {
  test("status, four slots, and every path starts with v1/genome", async () => {
    const { setArkAdapterTestHooks } = await import("./hooks");
    setArkAdapterTestHooks({
      env: {
        GENOME_SOURCE: "ark",
        ARK_DEVICE: device,
      },
      audit: async () => undefined,
    });

    const { dataList, dataPaths, status } = await import("./client");
    const { ARK_SLOT_NAMES, allPathsStartWithGenome } = await import("./schemas");
    const ctx = {
      actor: "live-test",
      sessionId: "ark-adapter-live",
      subjectRef: null,
    };

    const deviceStatus = failUnlessOk("status", await status(ctx));
    expect(deviceStatus.serial).toBeDefined();

    const listed = failUnlessOk("dataList", await dataList(ctx));
    const ids = listed.slots.map((entry) => entry.slot);
    for (const id of ARK_SLOT_NAMES) {
      expect(ids).toContain(id);
    }
    expect(
      listed.slots.every(
        (entry) => typeof entry.name === "string" && entry.name.length > 0,
      ),
    ).toBe(true);

    const paths = failUnlessOk("dataPaths", await dataPaths(ctx));
    expect(paths.paths.length).toBeGreaterThan(0);
    expect(allPathsStartWithGenome(paths.paths)).toBe(true);
  });

  test("appRun rsid-genotypes prints recorded table and footer", async () => {
    const { setArkAdapterTestHooks } = await import("./hooks");
    setArkAdapterTestHooks({
      env: {
        GENOME_SOURCE: "ark",
        ARK_DEVICE: device,
      },
      audit: async () => undefined,
    });

    const wasm = resolve(
      import.meta.dir,
      "../../apps/ark/rsid-genotypes/build/rsid-genotypes.wasm",
    );
    if (!existsSync(wasm)) {
      throw new Error("rsid-genotypes.wasm missing; run bun run ark:build first");
    }

    const { appRun } = await import("./client");
    const ctx = {
      actor: "live-test",
      sessionId: "ark-adapter-live",
      subjectRef: null,
    };
    const result = await appRun(ctx, {
      app: wasm,
      grants: RSID_GENOTYPES_GRANTS,
      timeout: 15,
    });
    const data = failUnlessOk("appRun", result);
    const hasTitle = data.report.startsWith("# rsID genotypes\n");
    const hasFooter = data.report.includes(
      "Research use only; genotypes as recorded in the loaded call file.",
    );
    const hasElevenRows =
      data.report.split("\n").filter((line) => /^rs\d+\t/.test(line)).length === 11;
    expect(hasTitle).toBe(true);
    expect(hasFooter).toBe(true);
    expect(hasElevenRows).toBe(true);
  });
});

afterAll(async () => {
  if (!runLive) return;
  const { setArkAdapterTestHooks } = await import("./hooks");
  setArkAdapterTestHooks({ env: null, audit: null });
});
