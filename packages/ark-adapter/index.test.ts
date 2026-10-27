import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

export const ARK_ADAPTER_BARREL_KEYS = [
  "ARK_CLI_VERSION",
  "ARK_FIRMWARE_VERSION",
  "ARK_PATH_PREFIX",
  "ARK_SLOT_NAMES",
  "GENOME_SOURCE_DISABLED",
  "UNLOCK_FORBIDDEN",
  "allPathsStartWithGenome",
  "appRun",
  "auditArkCall",
  "buildArkArgv",
  "dataList",
  "dataPaths",
  "doctor",
  "errorFromExitCode",
  "errorFromObject",
  "hostTimeoutMsForCliTimeout",
  "isArkOk",
  "mapArkFailure",
  "redactStatusDocument",
  "status",
] as const;

describe("ark-adapter barrel", () => {
  test("Object.keys of index equals the exact sorted list", async () => {
    const exported = Object.keys(await import("./index")).sort();
    expect(exported).toEqual([...ARK_ADAPTER_BARREL_KEYS]);
    expect(exported).not.toContain("spawnArk");
    expect(exported).not.toContain("setArkAdapterTestHooks");
  });
});
