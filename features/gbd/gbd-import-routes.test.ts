import { describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";
import { type GbdImportStore, sha256Of } from "@/packages/gbd-local/import-chunks";
import { MADE_UP_CAUSE_CSV } from "@/packages/gbd-local/made-up-results.test-helpers";

import {
  GBD_CITATION_HEADER,
  GBD_FILE_NAME_HEADER,
  readEvents,
} from "./gbd-import-events";
import { GBD_IMPORT_MESSAGES } from "./gbd-import-messages";
import {
  createGbdImportHandlers,
  type GbdImportPorts,
  gbdUploadCitation,
  gbdUploadName,
  loadGbdImports,
} from "./gbd-import-routes";
import { GBD_FREE_SPACE_MARGIN_BYTES, GBD_MAX_UPLOAD_BYTES } from "./gbd-upload-limits";

/** The GBD import routes with fakes; every CSV here is MADE UP. */

const SHA = sha256Of(new TextEncoder().encode(MADE_UP_CAUSE_CSV));

const world = (
  overrides: Partial<GbdImportPorts> = {},
  known: readonly string[] = [],
) => {
  const audit: AppendInput[] = [];
  const calls: string[] = [];
  const uploads = new Map<string, Uint8Array>();
  const store: GbdImportStore = {
    known: async (sha256) => known.includes(sha256),
    begin: async (file) =>
      void calls.push(`begin ${file.fileName} ${file.citation ?? "-"}`),
    addRows: async (_sha, rows) => {
      calls.push(`add ${rows.length}`);
      return rows.length;
    },
    finish: async (_sha, counts) => void calls.push(`finish ${counts.rowCount}`),
    abort: async () => void calls.push("abort"),
  };
  const ports: GbdImportPorts = {
    isLocalInstall: () => true,
    resolveActorId: async () => "local-synthetic",
    sessionId: () => "session-1",
    audit: async (input) => void audit.push(input),
    store: () => store,
    list: async () => [],
    remove: async (sha256) => {
      calls.push(`remove ${sha256.slice(0, 4)}`);
      return sha256 === SHA ? 12 : null;
    },
    saveUpload: async (body, maxBytes) => {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      if (bytes.length === 0) return { ok: false, reason: "empty" };
      if (bytes.length > maxBytes) return { ok: false, reason: "too-large" };
      const path = `/state/gbd-uploads/${uploads.size}.csv`;
      uploads.set(path, bytes);
      calls.push(`saved ${path}`);
      return { ok: true, path, sha256: sha256Of(bytes), bytes: bytes.length };
    },
    freeBytes: async () => 100 * GBD_FREE_SPACE_MARGIN_BYTES,
    chunks: (path) => {
      const bytes = uploads.get(path) ?? new Uint8Array();
      return [bytes.subarray(0, 100), bytes.subarray(100)];
    },
    removeUpload: async (path) => {
      uploads.delete(path);
      calls.push(`removed ${path}`);
    },
    ...overrides,
  };
  return { ports, handlers: createGbdImportHandlers(ports), audit, calls, uploads };
};

const upload = (
  text: string,
  name = "IHME-GBD_2023_DATA-1.csv",
  headers: Readonly<Record<string, string>> = {},
) =>
  new Request("http://localhost/api/gbd/imports", {
    method: "POST",
    body: text,
    headers: {
      "content-type": "text/csv",
      "sec-fetch-site": "same-origin",
      [GBD_FILE_NAME_HEADER]: encodeURIComponent(name),
      ...headers,
    },
  });

const lastEvent = async (response: Response) => {
  const { events } = readEvents(await response.text());
  return events.at(-1);
};

const CITATION =
  "GBD Results tool:\nUse the following to cite data included in this download:\nA made-up citation.\n";

describe("POST /api/gbd/imports (#426)", () => {
  test("streams progress and the outcome, audits counts only and removes the upload", async () => {
    const { handlers, audit, calls, uploads } = world();
    const response = await handlers.postImport(
      upload(MADE_UP_CAUSE_CSV, "IHME-GBD_2023_DATA-1.csv", {
        [GBD_CITATION_HEADER]: encodeURIComponent(CITATION),
      }),
    );
    expect(response.headers.get("content-type")).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    const { events } = readEvents(await response.text());
    expect(events.map((event) => event.type)).toEqual([
      "progress",
      "progress",
      "progress",
      "imported",
    ]);
    expect(events.at(-1)).toEqual({
      type: "imported",
      sha256: SHA,
      rowCount: 12,
      newRows: 12,
    });
    expect(calls).toEqual([
      "saved /state/gbd-uploads/0.csv",
      "begin IHME-GBD_2023_DATA-1.csv A made-up citation.",
      "add 12",
      "finish 12",
      "removed /state/gbd-uploads/0.csv",
    ]);
    expect(uploads.size).toBe(0);
    expect(audit).toEqual([
      {
        actor: "local-synthetic",
        sessionId: "session-1",
        subjectRef: null,
        tool: "gbd.import",
        args: { bytes: MADE_UP_CAUSE_CSV.length, sha256: SHA },
        result: { stored: true, rows: 12, new_rows: 12 },
        rowCount: 12,
      },
    ]);
    expect(JSON.stringify(audit)).not.toContain("Switzerland");
    expect(JSON.stringify(audit)).not.toContain("IHME-GBD");
  });

  test("a file that is not a Results Tool export is refused with the importer's code", async () => {
    const { handlers, audit, calls } = world();
    const event = await lastEvent(await handlers.postImport(upload("name,value\nx,1\n")));
    expect(event).toEqual({
      type: "refused",
      error: {
        code: "GBD_CSV_COLUMNS",
        message: "This is not a GBD Results Tool export with IDs and names.",
        missing: [
          "measure_id",
          "measure_name",
          "location_id",
          "location_name",
          "sex_id",
          "sex_name",
          "age_id",
          "age_name",
          "metric_id",
          "metric_name",
          "year",
          "val",
          "upper",
          "lower",
        ],
      },
    });
    expect(audit.map((row) => row.result)).toEqual([
      { stored: false, refused: "GBD_CSV_COLUMNS" },
    ]);
    expect(calls).toEqual([
      "saved /state/gbd-uploads/0.csv",
      "removed /state/gbd-uploads/0.csv",
    ]);
  });

  test("a file already imported is skipped and the upload removed", async () => {
    const { handlers, audit, calls } = world({}, [SHA]);
    expect(await lastEvent(await handlers.postImport(upload(MADE_UP_CAUSE_CSV)))).toEqual(
      {
        type: "already-imported",
        sha256: SHA,
      },
    );
    expect(audit.map((row) => row.result)).toEqual([
      { stored: false, skipped: "already-imported" },
    ]);
    expect(calls).toEqual([
      "saved /state/gbd-uploads/0.csv",
      "removed /state/gbd-uploads/0.csv",
    ]);
  });

  test("an import whose audit row cannot be written is undone", async () => {
    const { handlers, calls } = world({
      audit: async () => {
        throw new Error("audit down");
      },
    });
    expect(await lastEvent(await handlers.postImport(upload(MADE_UP_CAUSE_CSV)))).toEqual(
      {
        type: "failed",
        message: GBD_IMPORT_MESSAGES.failed,
      },
    );
    expect(calls.slice(-2)).toEqual([
      `remove ${SHA.slice(0, 4)}`,
      "removed /state/gbd-uploads/0.csv",
    ]);
  });

  test("a failed write shows a plain sentence, never the exception", async () => {
    const { ports, calls } = world();
    const failing = createGbdImportHandlers({
      ...ports,
      store: () => ({
        ...ports.store(),
        addRows: async () => {
          throw new Error("relation gbd_estimates does not exist");
        },
      }),
    });
    const text = await (await failing.postImport(upload(MADE_UP_CAUSE_CSV))).text();
    expect(readEvents(text).events.at(-1)).toEqual({
      type: "failed",
      message: GBD_IMPORT_MESSAGES.failed,
    });
    expect(text).not.toContain("relation");
    expect(calls.slice(-2)).toEqual(["abort", "removed /state/gbd-uploads/0.csv"]);
  });

  test("refusals before the upload is read", async () => {
    const cases: readonly [string, Partial<GbdImportPorts>, Request, number, string][] = [
      [
        "not a local install",
        { isLocalInstall: () => false },
        upload(MADE_UP_CAUSE_CSV),
        403,
        GBD_IMPORT_MESSAGES.notLocal,
      ],
      [
        "another site",
        {},
        upload(MADE_UP_CAUSE_CSV, "a.csv", { "sec-fetch-site": "cross-site" }),
        403,
        GBD_IMPORT_MESSAGES.otherSite,
      ],
      [
        "signed out",
        { resolveActorId: async () => null },
        upload("x"),
        401,
        GBD_IMPORT_MESSAGES.signIn,
      ],
      [
        "the citation alone",
        {},
        upload(CITATION, "citation.txt"),
        400,
        GBD_IMPORT_MESSAGES.citationOnly,
      ],
      ["not a CSV", {}, upload("x", "notes.pdf"), 400, GBD_IMPORT_MESSAGES.notCsv],
      ["empty", {}, upload("", "a.csv"), 400, GBD_IMPORT_MESSAGES.empty],
    ];
    for (const [name, overrides, request, status, error] of cases) {
      const { handlers, calls } = world(overrides);
      const response = await handlers.postImport(request);
      expect([name, response.status, await response.json()]).toEqual([
        name,
        status,
        { ok: false, error },
      ]);
      expect([name, calls.filter((call) => call.startsWith("begin"))]).toEqual([
        name,
        [],
      ]);
    }
  });

  test("a file declared over 1 GB is refused with its code before a byte is read (#434)", async () => {
    const { handlers, calls, audit } = world({
      freeBytes: async () => {
        calls.push("free");
        return null;
      },
    });
    const response = await handlers.postImport(
      upload("x", "a.csv", { "content-length": String(GBD_MAX_UPLOAD_BYTES + 1) }),
    );
    expect([response.status, await response.json()]).toEqual([
      413,
      { ok: false, error: GBD_IMPORT_MESSAGES.tooLarge, code: "GBD_UPLOAD_TOO_LARGE" },
    ]);
    expect(calls).toEqual([]);
    expect(audit.map((row) => [row.args, row.result])).toEqual([
      [
        { bytes: GBD_MAX_UPLOAD_BYTES + 1, sha256: null },
        { stored: false, refused: "too-large" },
      ],
    ]);
  });

  test("a body that grows past the cap is stopped and leaves no upload (#434)", async () => {
    const { handlers, calls } = world({
      saveUpload: async () => {
        calls.push("stopped past the cap");
        return { ok: false, reason: "too-large" };
      },
    });
    const response = await handlers.postImport(upload(MADE_UP_CAUSE_CSV, "a.csv"));
    expect([response.status, await response.json()]).toEqual([
      413,
      { ok: false, error: GBD_IMPORT_MESSAGES.tooLarge, code: "GBD_UPLOAD_TOO_LARGE" },
    ]);
    expect(calls).toEqual(["stopped past the cap"]);
  });

  test("too little free disk refuses before the upload is written (#434)", async () => {
    const declared = MADE_UP_CAUSE_CSV.length;
    const { handlers, calls, audit } = world({
      freeBytes: async () => GBD_FREE_SPACE_MARGIN_BYTES + declared - 1,
    });
    const response = await handlers.postImport(
      upload(MADE_UP_CAUSE_CSV, "a.csv", { "content-length": String(declared) }),
    );
    expect([response.status, await response.json()]).toEqual([
      507,
      { ok: false, error: GBD_IMPORT_MESSAGES.noSpace, code: "GBD_UPLOAD_NO_SPACE" },
    ]);
    expect(calls).toEqual([]);
    expect(audit.map((row) => row.result)).toEqual([
      { stored: false, refused: "no-space" },
    ]);
  });

  test("a disk that fills while writing is refused with the same code (#434)", async () => {
    const { handlers } = world({
      saveUpload: async () => ({ ok: false, reason: "no-space" }),
    });
    const response = await handlers.postImport(upload(MADE_UP_CAUSE_CSV, "a.csv"));
    expect([response.status, await response.json()]).toEqual([
      507,
      { ok: false, error: GBD_IMPORT_MESSAGES.noSpace, code: "GBD_UPLOAD_NO_SPACE" },
    ]);
  });

  test("free space that cannot be read does not refuse the file", async () => {
    const { handlers } = world({
      freeBytes: async () => {
        throw new Error("made up");
      },
    });
    const response = await handlers.postImport(upload(MADE_UP_CAUSE_CSV, "a.csv"));
    expect(await lastEvent(response)).toEqual(
      expect.objectContaining({ type: "imported" }),
    );
  });

  test("a body shorter than its declared length is refused and removed", async () => {
    const { handlers, calls, audit } = world();
    const response = await handlers.postImport(
      upload(MADE_UP_CAUSE_CSV, "a.csv", {
        "content-length": String(MADE_UP_CAUSE_CSV.length + 5),
      }),
    );
    expect([response.status, await response.json()]).toEqual([
      400,
      { ok: false, error: GBD_IMPORT_MESSAGES.incomplete },
    ]);
    expect(calls).toEqual([
      "saved /state/gbd-uploads/0.csv",
      "removed /state/gbd-uploads/0.csv",
    ]);
    expect(audit.map((row) => row.result)).toEqual([
      { stored: false, refused: "incomplete" },
    ]);
  });
});

describe("DELETE /api/gbd/imports/[sha256] (#426)", () => {
  const remove = (headers: Readonly<Record<string, string>> = {}) =>
    new Request("http://localhost/api/gbd/imports/x", {
      method: "DELETE",
      headers: { "sec-fetch-site": "same-origin", ...headers },
    });

  test("deletes a file's estimates and audits the count", async () => {
    const { handlers, audit } = world();
    const response = await handlers.deleteImport(remove(), SHA);
    expect(await response.json()).toEqual({ ok: true, rowsDeleted: 12 });
    expect(audit.map((row) => [row.tool, row.args, row.result])).toEqual([
      ["gbd.delete", { sha256: SHA }, { found: true, rows_deleted: 12 }],
    ]);
  });

  test("an unknown checksum is not found, and a malformed one is not looked up", async () => {
    const { handlers, audit, calls } = world();
    expect((await handlers.deleteImport(remove(), "b".repeat(64))).status).toBe(404);
    expect((await handlers.deleteImport(remove(), "../x")).status).toBe(404);
    expect(calls).toEqual(["remove bbbb"]);
    expect(audit.map((row) => row.result)).toEqual([{ found: false, rows_deleted: 0 }]);
  });

  test("not on a local install, nothing is deleted", async () => {
    const { handlers, calls } = world({ isLocalInstall: () => false });
    expect((await handlers.deleteImport(remove(), SHA)).status).toBe(403);
    expect(calls).toEqual([]);
  });
});

describe("upload headers", () => {
  test("the file name is a CSV base name", () => {
    expect(gbdUploadName(encodeURIComponent("IHME-GBD_2023_DATA-1.csv"))).toBe(
      "IHME-GBD_2023_DATA-1.csv",
    );
    expect(gbdUploadName(encodeURIComponent("../../etc/x.CSV"))).toBe("x.CSV");
    expect(gbdUploadName(encodeURIComponent("a.txt"))).toBeNull();
    expect(gbdUploadName("%E0%A4%A")).toBeNull();
    expect(gbdUploadName(null)).toBeNull();
  });

  test("the citation is read as the CLI reads citation.txt", () => {
    expect(gbdUploadCitation(encodeURIComponent(CITATION))).toBe("A made-up citation.");
    expect(gbdUploadCitation(encodeURIComponent("x".repeat(4001)))).toBeNull();
    expect(gbdUploadCitation(null)).toBeNull();
  });
});

describe("loadGbdImports", () => {
  test("lists files on a local install only", async () => {
    expect(
      await loadGbdImports({ isLocalInstall: () => false, list: async () => [] }),
    ).toEqual({ state: "not-local" });
    expect(
      await loadGbdImports({ isLocalInstall: () => true, list: async () => [] }),
    ).toEqual({
      state: "ready",
      imports: [],
    });
  });
});
