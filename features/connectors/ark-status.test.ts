import { describe, expect, mock, test } from "bun:test";

import dataListOk from "@/packages/ark-adapter/fixtures/data-list-ok.json";
import dataPathsOk from "@/packages/ark-adapter/fixtures/data-paths-ok.json";
import statusRealShape from "@/packages/ark-adapter/fixtures/status-real-shape.json";
import type { ArkResult } from "@/packages/ark-adapter";

mock.module("server-only", () => ({}));

const { getArkStatusResponse } = await import("./ark-status");

type Ctx = { readonly actor: string; readonly sessionId: string };

const liveSlots = [
  {
    slot: "reference-genome",
    name: "Reference Genome",
    state: "filled",
    build: "GRCh38",
    version: null,
  },
  {
    slot: "gene-annotations",
    name: "Gene Annotations",
    state: "empty",
    build: null,
    version: null,
  },
  {
    slot: "snp-indel-calls",
    name: "SNP and Indel Calls",
    state: "empty",
    build: null,
    version: null,
  },
  {
    slot: "variant-catalog",
    name: "Variant Catalog",
    state: "empty",
    build: null,
    version: "2024.03",
  },
];

const unused = async (): Promise<ArkResult<never>> => {
  throw new Error("adapter call not expected");
};

describe("GET /api/ark/status", () => {
  test("401 without an actor", async () => {
    const response = await getArkStatusResponse({
      resolveActorId: async () => null,
      genomeSource: () => "ark",
      status: unused,
      dataList: unused,
      dataPaths: unused,
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in to view Ark status." });
  });

  test("returns enabled false when GENOME_SOURCE is none", async () => {
    const response = await getArkStatusResponse({
      resolveActorId: async () => "user-ark-1",
      genomeSource: () => "none",
      status: unused,
      dataList: unused,
      dataPaths: unused,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
  });

  test("ok path from the real-shape fixture omits pubkey and identity", async () => {
    const sessions: string[] = [];
    const response = await getArkStatusResponse({
      resolveActorId: async () => "user-ark-1",
      genomeSource: () => "ark",
      status: async (ctx: Ctx) => {
        expect(ctx.actor).toBe("user-ark-1");
        sessions.push(ctx.sessionId);
        return { status: "ok", data: statusRealShape };
      },
      dataList: async (ctx: Ctx) => {
        sessions.push(ctx.sessionId);
        return { status: "ok", data: { slots: liveSlots } };
      },
      dataPaths: async (ctx: Ctx) => {
        sessions.push(ctx.sessionId);
        return { status: "ok", data: dataPathsOk };
      },
    });
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    const text = JSON.stringify(body);

    expect(text).not.toContain("pubkey");
    expect(text).not.toContain("identity");
    expect(text).not.toContain(statusRealShape.identity);
    expect(body).toEqual({
      enabled: true,
      state: "ok",
      serial: "alpha-002",
      hardware: {
        model: "Ark I",
        version: "0.5.0",
        revision: "4035-1030",
      },
      firmware: "0.11.6-924f716",
      trust: "attested",
      paired: true,
      unlocked: true,
      slots: [
        {
          slot: "reference-genome",
          name: "Reference Genome",
          state: "filled",
          build: "GRCh38",
          version: null,
        },
        {
          slot: "gene-annotations",
          name: "Gene Annotations",
          state: "empty",
          build: null,
          version: null,
        },
        {
          slot: "snp-indel-calls",
          name: "SNP and Indel Calls",
          state: "empty",
          build: null,
          version: null,
        },
        {
          slot: "variant-catalog",
          name: "Variant Catalog",
          state: "empty",
          build: null,
          version: "2024.03",
        },
      ],
      pathCount: 3,
      allGenome: true,
    });
    expect(sessions).toHaveLength(3);
    expect(sessions[0]).toBe(sessions[1]);
    expect(sessions[1]).toBe(sessions[2]);
    expect(sessions[0]?.length).toBeGreaterThan(0);
  });

  test("busy returns state and error.code only", async () => {
    let listed = 0;
    const response = await getArkStatusResponse({
      resolveActorId: async () => "user-ark-1",
      genomeSource: () => "ark",
      status: async () => ({
        status: "busy",
        error: { code: "device-busy", message: "hub tab is open" },
      }),
      dataList: async () => {
        listed += 1;
        return {
          status: "busy",
          error: { code: "device-busy", message: "hub tab is open" },
        };
      },
      dataPaths: unused,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      state: "busy",
      error: { code: "device-busy" },
    });
    expect(listed).toBe(0);
  });

  test("CLI 0.5.0 slots: six of them, catalog release as text", async () => {
    const response = await getArkStatusResponse({
      resolveActorId: async () => "user-ark-1",
      genomeSource: () => "ark",
      status: async () => ({ status: "ok", data: statusRealShape }),
      dataList: async () => ({ status: "ok", data: dataListOk }),
      dataPaths: async () => ({ status: "ok", data: dataPathsOk }),
    });
    const body = (await response.json()) as {
      slots: { slot: string; build: string | null; version: string | null }[];
    };
    expect(body.slots.map((row) => [row.slot, row.build, row.version])).toEqual([
      ["reference-genome", "GRCh38.p14", null],
      ["gene-annotations", "GRCh38.p14", null],
      ["small-variants", "GRCh38.p14", null],
      ["structural-variants", null, null],
      ["copy-number-variants", null, null],
      ["variant-catalog", "GRCh38.p14", "157"],
    ]);
  });

  test("firmware older than 0.13.1 is its own state", async () => {
    const response = await getArkStatusResponse({
      resolveActorId: async () => "user-ark-1",
      genomeSource: () => "ark",
      status: async () => ({
        status: "outdated",
        error: { code: "firmware-outdated", message: "raw cli text" },
      }),
      dataList: unused,
      dataPaths: unused,
    });
    expect(await response.json()).toEqual({
      enabled: true,
      state: "outdated",
      error: { code: "firmware-outdated" },
    });
  });
});
