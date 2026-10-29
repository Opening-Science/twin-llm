import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import type { AppendInput } from "@/packages/audit/append";
import { sha256Hex, toCanonicalJson } from "@/packages/audit/hash";

import {
  assertTransportAllowedForDataMode,
  createQueryMcpServer,
  mcpImportedPermit,
  queryToolRunners,
  TRANSPORT_NOT_PERMITTED_ERROR,
} from "./mcp-server";
import type { ObservationRecord, QueryToolPorts } from "./ports";
import type { SessionScope } from "./scope";

const SUBJECT = "synthetic-hr-subject";
const HR = "8867-4";
const T0 = Date.parse("2024-01-01T08:00:00.000Z");
const DAY = 86_400_000;

/** Heart rate 70→78 every other day in early January: slope 1 /min per day. */
const ROWS: readonly ObservationRecord[] = [70, 72, 74, 76, 78].map((value, index) => ({
  loinc: HR,
  value,
  unitUcum: "/min",
  effectiveAt: new Date(T0 + index * 2 * DAY),
}));

type AuditRecord = AppendInput & Readonly<{ argsSha256: string; resultSha256: string }>;

const fakePorts = () => {
  const audits: AuditRecord[] = [];
  const ports: QueryToolPorts = {
    findSubject: async (subjectRef) =>
      subjectRef === SUBJECT
        ? { isSynthetic: true, cohortId: "synthea-v4-seed42" }
        : null,
    findObservations: async (query) =>
      ROWS.filter(
        (row) =>
          query.subjectRef === SUBJECT &&
          query.loinc.includes(row.loinc) &&
          row.effectiveAt.getTime() >= query.start.getTime() &&
          row.effectiveAt.getTime() <= query.end.getTime(),
      ).slice(0, query.take),
    appendAudit: async (input) => {
      audits.push({
        ...input,
        argsSha256: sha256Hex(toCanonicalJson(input.args)),
        resultSha256: sha256Hex(toCanonicalJson(input.result)),
      });
    },
  };
  return { ports, audits };
};

const SCOPE: SessionScope = { actor: "mcp", sessionId: "mcp-test", mode: "synthetic" };

const connectedClient = async (ports: QueryToolPorts) => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createQueryMcpServer(queryToolRunners(SCOPE, ports)).connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
};

const asJson = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const snapshot = (): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dir, "__snapshots__", "mcp-tools.json"), "utf8"),
  );

const textOf = (result: { content: unknown }): string => {
  const [first] = result.content as ReadonlyArray<{ type: string; text?: string }>;
  if (first?.type !== "text" || first.text === undefined) {
    throw new Error("expected one text content block");
  }
  return first.text;
};

describe("query tools MCP server", () => {
  test("lists exactly the tools of the committed manifest", async () => {
    const client = await connectedClient(fakePorts().ports);
    expect(asJson(await client.listTools())).toEqual(snapshot());
  });

  test("a trend call runs the tool and audits it once as actor mcp", async () => {
    const { ports, audits } = fakePorts();
    const client = await connectedClient(ports);
    const args = {
      subject_ref: SUBJECT,
      loinc: HR,
      start: "2024-01-01T00:00:00.000Z",
      end: "2024-01-10T00:00:00.000Z",
    };
    const result = await client.callTool({ name: "trend", arguments: args });
    const expected = {
      loinc: HR,
      unit: "/min",
      n: 5,
      first_at: "2024-01-01T08:00:00.000Z",
      last_at: "2024-01-09T08:00:00.000Z",
      slope_per_day: 1,
      slope_unit: "/min/d",
      fitted_first: 70,
      fitted_last: 78,
    };
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(textOf(result))).toEqual(expected);
    expect(audits).toEqual([
      {
        actor: "mcp",
        sessionId: "mcp-test",
        subjectRef: SUBJECT,
        tool: "trend",
        args,
        result: expected,
        rowCount: 5,
        argsSha256: sha256Hex(toCanonicalJson(args)),
        resultSha256: sha256Hex(toCanonicalJson(expected)),
      },
    ]);
  });

  test("invalid arguments are refused before the tool or the audit chain", async () => {
    const { ports, audits } = fakePorts();
    const client = await connectedClient(ports);
    const result = await client.callTool({
      name: "trend",
      arguments: {
        subject_ref: SUBJECT,
        loinc: HR,
        start: "2024-01-10",
        end: "2024-01-01",
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("invalid arguments: ✖ start must be before end");
    expect(audits).toEqual([]);
  });

  test("an imported-data tool always refuses over MCP, audited with its code only", async () => {
    const { ports, audits } = fakePorts();
    const client = await connectedClient(ports);
    const result = await client.callTool({
      name: "imported_latest",
      arguments: { loinc: [HR] },
    });
    expect(JSON.parse(textOf(result))).toEqual({
      code: "IMPORTED_DATA_NOT_PERMITTED",
      error: "imported data is read only in personal data mode",
      reason: "data-mode-not-personal",
    });
    expect(
      audits.map((each) => [each.tool, each.args, each.result, each.rowCount]),
    ).toEqual([
      [
        "imported_latest",
        { codes: 1, dataset_id: null },
        { code: "IMPORTED_DATA_NOT_PERMITTED" },
        0,
      ],
    ]);
  });

  test("in personal mode the MCP client's model is not known to be local", () => {
    expect(mcpImportedPermit("personal")).toEqual({
      ok: false,
      code: "IMPORTED_DATA_NOT_PERMITTED",
      reason: "chat-model-not-local",
    });
    expect(mcpImportedPermit("synthetic")).toEqual({
      ok: false,
      code: "IMPORTED_DATA_NOT_PERMITTED",
      reason: "data-mode-not-personal",
    });
  });

  test("an unknown tool is a protocol error", async () => {
    const client = await connectedClient(fakePorts().ports);
    await expect(client.callTool({ name: "drop_table", arguments: {} })).rejects.toThrow(
      "unknown tool: drop_table",
    );
  });
});

describe("assertTransportAllowedForDataMode", () => {
  test("personal mode refuses every transport but stdio", () => {
    expect(() =>
      assertTransportAllowedForDataMode("personal", "streamable-http"),
    ).toThrow(TRANSPORT_NOT_PERMITTED_ERROR);
    expect(() => assertTransportAllowedForDataMode("personal", "sse")).toThrow(
      TRANSPORT_NOT_PERMITTED_ERROR,
    );
    expect(assertTransportAllowedForDataMode("personal", "stdio")).toBeUndefined();
  });

  test("synthetic mode allows any transport", () => {
    expect(assertTransportAllowedForDataMode("synthetic", "stdio")).toBeUndefined();
    expect(
      assertTransportAllowedForDataMode("synthetic", "streamable-http"),
    ).toBeUndefined();
  });
});
