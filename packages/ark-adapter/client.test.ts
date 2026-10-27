import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import type { AppendInput } from "@/packages/audit/append";

mock.module("server-only", () => ({}));

import type { ArkAuditFn } from "./hooks";
import appRunFailed from "./fixtures/app-run-failed.json";
import appRunOk from "./fixtures/app-run-ok.json";
import dataListOk from "./fixtures/data-list-ok.json";
import dataPathsOk from "./fixtures/data-paths-ok.json";
import doctorEmulator from "./fixtures/doctor-emulator.json";
import errorApprovalDenied from "./fixtures/error-approval-denied.json";
import errorApprovalTimeout from "./fixtures/error-approval-timeout.json";
import errorApprovalUndelivered from "./fixtures/error-approval-undelivered.json";
import errorArkRefused from "./fixtures/error-ark-refused.json";
import errorDeviceBusy from "./fixtures/error-device-busy.json";
import errorFirmwareOutdated from "./fixtures/error-firmware-outdated.json";
import errorLocked from "./fixtures/error-locked.json";
import errorNoDevice from "./fixtures/error-no-device.json";
import errorNotPaired from "./fixtures/error-not-paired.json";
import statusEmulator from "./fixtures/status-emulator-unenrolled.json";
import statusOk from "./fixtures/status-ok.json";

const envState = {
  GENOME_SOURCE: "ark" as "none" | "ark",
  ARK_DEVICE: undefined as string | undefined,
};

const appendCalls: AppendInput[] = [];

const recordAudit: ArkAuditFn = async (ctx, tool, args, result) => {
  appendCalls.push({
    actor: ctx.actor,
    sessionId: ctx.sessionId,
    subjectRef: ctx.subjectRef ?? null,
    tool,
    args,
    result,
    rowCount: 0,
  });
};

const { setArkAdapterTestHooks } = await import("./hooks");

setArkAdapterTestHooks({
  env: envState,
  audit: recordAudit,
});

type SpawnedIo = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

let nextIo: SpawnedIo | null = null;
let spawnCalls = 0;

const { setArkNodeSpawnForTests } = await import("./spawn");

const installFixtureSpawn = () =>
  setArkNodeSpawnForTests((command, args, options) => {
    spawnCalls += 1;
    if (options.shell !== false) {
      throw new Error("spawn must set shell: false");
    }
    if (
      options.stdio[0] !== "ignore" ||
      options.stdio[1] !== "pipe" ||
      options.stdio[2] !== "pipe"
    ) {
      throw new Error("spawn must use stdio [ignore, pipe, pipe]");
    }
    const argv = [command, ...args];
    if (argv.includes("--unlock")) {
      throw new Error("spawn must never receive --unlock");
    }
    const io = nextIo;
    if (!io) throw new Error("spawn called without a fixture");

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      kill: () => boolean;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = () => true;

    queueMicrotask(() => {
      stdout.end(io.stdout);
      stderr.end(io.stderr);
      child.emit("close", io.exitCode, null);
    });
    return child;
  });

installFixtureSpawn();

const { appRun, dataList, dataPaths, doctor, status } = await import("./client");
const { buildArkArgv, hostTimeoutMsForCliTimeout, hostTimeoutMsForRun, spawnArk } =
  await import("./spawn");
const { GENOME_SOURCE_DISABLED, UNLOCK_FORBIDDEN } = await import("./codes");

const CTX = {
  actor: "test-actor",
  sessionId: "ark-adapter-test",
  subjectRef: null,
} as const;

const jsonIo = (exitCode: number, stdout: unknown, stderr = ""): SpawnedIo => ({
  exitCode,
  stdout: JSON.stringify(stdout, null, 2),
  stderr,
});

const resetHooks = () => {
  envState.GENOME_SOURCE = "ark";
  envState.ARK_DEVICE = undefined;
  setArkAdapterTestHooks({ env: envState, audit: recordAudit });
  installFixtureSpawn();
};

describe("ark-adapter spawn argv", () => {
  beforeEach(resetHooks);
  afterEach(resetHooks);

  test("appends --json and optional --device", () => {
    expect(buildArkArgv(["status"])).toEqual(["ark", "status", "--json"]);
    envState.ARK_DEVICE = "alpha-002";
    expect(buildArkArgv(["data", "list"])).toEqual([
      "ark",
      "data",
      "list",
      "--device",
      "alpha-002",
      "--json",
    ]);
  });

  test("refuses to spawn when GENOME_SOURCE is none", async () => {
    envState.GENOME_SOURCE = "none";
    const before = spawnCalls;
    const result = await spawnArk(["status"]);
    expect(result).toEqual({
      kind: "disabled",
      argv: ["ark", "status", "--json"],
      error: GENOME_SOURCE_DISABLED,
    });
    expect(spawnCalls).toBe(before);
  });

  test("refuses --unlock even when GENOME_SOURCE is ark", async () => {
    const before = spawnCalls;
    const result = await spawnArk(["status", "--unlock"]);
    expect(result).toEqual({
      kind: "disabled",
      argv: ["ark", "status", "--unlock", "--json"],
      error: UNLOCK_FORBIDDEN,
    });
    expect(spawnCalls).toBe(before);
  });

  test("never spawns data upload, delete, repair, or fetch", async () => {
    const before = spawnCalls;
    const forbidden = [
      ["data", "upload", "file.vcf"],
      ["data", "delete", "3"],
      ["data", "repair", "3"],
      ["data", "fetch", "1"],
    ] as const;
    for (const argv of forbidden) {
      await expect(spawnArk(argv)).rejects.toThrow(/not allowed/);
    }
    expect(spawnCalls).toBe(before);
  });

  test("host abort adds approval slack to --timeout", () => {
    expect(hostTimeoutMsForCliTimeout(10)).toBe(100_000);
    expect(hostTimeoutMsForCliTimeout()).toBeUndefined();
  });

  test("ark run is capped past both phone windows (5 + 10 minutes)", () => {
    expect(hostTimeoutMsForRun(30)).toBe(30_000 + 300_000 + 600_000 + 300_000);
    expect(hostTimeoutMsForRun()).toBe(60_000 + 300_000 + 600_000 + 300_000);
  });

  test("ark app run is gone; ark run is the only run command", async () => {
    await expect(spawnArk(["app", "run", "x.wasm"])).rejects.toThrow(/not allowed/);
  });
});

describe("ark-adapter client states", () => {
  beforeEach(() => {
    appendCalls.length = 0;
    nextIo = null;
    resetHooks();
  });

  afterEach(() => {
    nextIo = null;
  });

  test("ok status redacts pubkey and audits row_count 0", async () => {
    nextIo = jsonIo(0, { ...statusOk, pubkey: "ab".repeat(64) });
    const result = await status(CTX);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.serial).toBe("test-001");
      expect("pubkey" in result.data).toBe(false);
    }
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]?.tool).toBe("ark.status");
    expect(appendCalls[0]?.rowCount).toBe(0);
    expect(appendCalls[0]?.args).toEqual({ argv: ["ark", "status", "--json"] });
    expect(JSON.stringify(appendCalls[0]?.result)).not.toContain("pubkey");
  });

  test("ok data list and data paths stay inventories", async () => {
    nextIo = jsonIo(0, dataListOk);
    const listed = await dataList(CTX);
    expect(listed.status).toBe("ok");
    if (listed.status === "ok") {
      expect(listed.data.slots.map((slot) => slot.slot)).toEqual([
        "reference-genome",
        "gene-annotations",
        "small-variants",
        "structural-variants",
        "copy-number-variants",
        "variant-catalog",
      ]);
      expect(listed.data.slots[2]?.build).toBe("GRCh38.p14");
      expect(listed.data.slots[5]?.version).toBe(157);
    }

    nextIo = jsonIo(0, dataPathsOk);
    const paths = await dataPaths(CTX);
    expect(paths.status).toBe("ok");
    if (paths.status === "ok") {
      expect(paths.data.paths.every((entry) => entry.path.startsWith("v1/genome"))).toBe(
        true,
      );
    }
  });

  test("ok appRun spawns ark run, returns the report and audits grants", async () => {
    nextIo = jsonIo(0, appRunOk);
    const result = await appRun(CTX, {
      app: "/tmp/fixture.wasm",
      grants: ["v1/genome/rsids/rs72921001"],
      timeout: 15,
    });
    expect(result).toEqual({
      status: "ok",
      data: { report: "# Finding\n\nSynthetic fixture report.\n" },
    });
    expect(appendCalls[0]?.tool).toBe("ark.app.run");
    expect(appendCalls[0]?.args).toEqual({
      argv: ["ark", "run", "/tmp/fixture.wasm", "--timeout", "15", "--json"],
      grants: ["v1/genome/rsids/rs72921001"],
    });
    expect(appendCalls[0]?.result).toEqual({
      task: "1",
      app: { name: "fixture", version: "0.1.0", develop: false },
      success: true,
      media: "text/markdown",
      duration_seconds: 0.5,
      paths_mounted: 1,
      report_chars: 37,
    });
    expect(JSON.stringify(appendCalls[0]?.result)).not.toContain("rs72921001");
  });

  test("doctor keeps check names and results, even when a check fails", async () => {
    nextIo = jsonIo(4, doctorEmulator);
    const result = await doctor(CTX);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.version).toBe("0.5.0");
      expect(result.data.checks.find((check) => check.name === "registry")).toEqual({
        name: "registry",
        result: "fail",
      });
      expect(JSON.stringify(result.data)).not.toContain("detail");
    }
    expect(appendCalls[0]?.tool).toBe("ark.doctor");
  });

  test("status parses a self-signed emulator with null attestation fields", async () => {
    nextIo = jsonIo(0, { ...statusEmulator, pubkey: "ab".repeat(64) });
    const result = await status(CTX);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.serial).toBeNull();
      expect(result.data.trust).toBe("self-signed");
      expect("pubkey" in result.data).toBe(false);
    }
  });

  test("outdated from firmware-outdated", async () => {
    nextIo = jsonIo(5, errorFirmwareOutdated);
    const result = await dataList(CTX);
    expect(result.status).toBe("outdated");
  });

  test("undelivered from approval-undelivered (exit 4)", async () => {
    nextIo = jsonIo(4, errorApprovalUndelivered);
    const result = await appRun(CTX, { app: "/tmp/fixture.wasm", grants: [] });
    expect(result.status).toBe("undelivered");
  });

  test("rejected from the Ark's own refusal, with its remote code kept", async () => {
    nextIo = jsonIo(5, errorArkRefused);
    const result = await appRun(CTX, { app: "/tmp/fixture.wasm", grants: [] });
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error.remoteCode).toBe("9001");
    }
  });

  test("app_failed from exit 8: run document on stdout, error event on stderr", async () => {
    nextIo = jsonIo(
      8,
      appRunFailed,
      '{"event":"error","message":"app failed","error":{"code":"app-failed","message":"app failed","hints":[]}}',
    );
    const result = await appRun(CTX, { app: "/tmp/fixture.wasm", grants: [] });
    expect(result.status).toBe("app_failed");
  });

  test("locked", async () => {
    nextIo = jsonIo(5, errorLocked);
    const result = await status(CTX);
    expect(result.status).toBe("locked");
    if (result.status === "locked") expect(result.error.code).toBe("locked");
  });

  test("unpaired", async () => {
    nextIo = jsonIo(5, errorNotPaired);
    const result = await dataList(CTX);
    expect(result.status).toBe("unpaired");
  });

  test("busy from device-busy", async () => {
    nextIo = jsonIo(3, errorDeviceBusy);
    const result = await dataPaths(CTX);
    expect(result.status).toBe("busy");
  });

  test("refused from approval-denied", async () => {
    nextIo = jsonIo(6, errorApprovalDenied);
    const result = await appRun(CTX, { app: "/tmp/fixture.wasm", grants: [] });
    expect(result.status).toBe("refused");
  });

  test("awaiting_approval from approval-timeout", async () => {
    nextIo = jsonIo(6, errorApprovalTimeout);
    const result = await appRun(CTX, { app: "/tmp/fixture.wasm", grants: [] });
    expect(result.status).toBe("awaiting_approval");
  });

  test("error from no-device and usage fallback", async () => {
    nextIo = jsonIo(3, errorNoDevice);
    const missing = await status(CTX);
    expect(missing.status).toBe("error");
    if (missing.status === "error") expect(missing.error.code).toBe("no-device");

    nextIo = { exitCode: 2, stdout: "", stderr: "" };
    const usage = await status(CTX);
    expect(usage.status).toBe("error");
    if (usage.status === "error") expect(usage.error.code).toBe("usage");
  });

  test("GENOME_SOURCE disabled does not claim ok", async () => {
    envState.GENOME_SOURCE = "none";
    const before = spawnCalls;
    const result = await status(CTX);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("genome-source-disabled");
    }
    expect(appendCalls[0]?.rowCount).toBe(0);
    expect(spawnCalls).toBe(before);
  });
});

afterAll(() => {
  setArkAdapterTestHooks({ env: null, audit: null });
  setArkNodeSpawnForTests(null);
});
