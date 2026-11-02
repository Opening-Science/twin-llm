import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { sha256Of } from "@/packages/gbd-local/import-chunks";
import {
  clearGbdStore,
  liveDatabase,
  OVERLAP_FILE_A,
  OVERLAP_FILE_B,
  requireEmptyGbdStore,
  runLive,
  storedEstimates,
} from "@/packages/gbd-local/made-up-overlap.test-helpers";
import {
  deleteGbdImport,
  gbdImportStore,
  listGbdImports,
} from "@/packages/gbd-local/store";

import { GBD_FILE_NAME_HEADER, readEvents } from "./gbd-import-events";
import {
  createGbdImportHandlers,
  type GbdImportPorts,
  loadGbdImports,
} from "./gbd-import-routes";
import { GBD_FREE_SPACE_MARGIN_BYTES } from "./gbd-upload-limits";

/**
 * Customize · Data's GBD routes against a real Postgres (#428): overlapping
 * MADE-UP files uploaded, deleted in both orders and uploaded again. The
 * upload folder and the audit chain are fakes; the store is the real one.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test features/gbd/gbd-import-routes.live.test.ts
 */

const encode = (text: string) => new TextEncoder().encode(text);
const SHA_A = sha256Of(encode(OVERLAP_FILE_A));
const SHA_B = sha256Of(encode(OVERLAP_FILE_B));

describe.skipIf(!runLive)("GBD import routes with shared estimates (RUN_LIVE=1)", () => {
  const db = liveDatabase();
  const uploads = new Map<string, Uint8Array>();
  const ports: GbdImportPorts = {
    isLocalInstall: () => true,
    resolveActorId: async () => "local-synthetic",
    sessionId: () => "session-1",
    audit: async () => undefined,
    store: () => gbdImportStore(db),
    list: () => listGbdImports(db),
    remove: (sha256) => deleteGbdImport(db, sha256),
    saveUpload: async (body) => {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer());
      const path = `/state/gbd-uploads/${uploads.size}.csv`;
      uploads.set(path, bytes);
      return { ok: true, path, sha256: sha256Of(bytes), bytes: bytes.length };
    },
    chunks: (path) => [uploads.get(path) ?? new Uint8Array()],
    removeUpload: async (path) => void uploads.delete(path),
    freeBytes: async () => 100 * GBD_FREE_SPACE_MARGIN_BYTES,
  };
  const handlers = createGbdImportHandlers(ports);

  const upload = async (text: string, name: string) => {
    const response = await handlers.postImport(
      new Request("http://localhost/api/gbd/imports", {
        method: "POST",
        body: text,
        headers: { "sec-fetch-site": "same-origin", [GBD_FILE_NAME_HEADER]: name },
      }),
    );
    return readEvents(await response.text()).events.at(-1);
  };
  const remove = async (sha256: string) =>
    (
      await handlers.deleteImport(
        new Request(`http://localhost/api/gbd/imports/${sha256}`, {
          method: "DELETE",
          headers: { "sec-fetch-site": "same-origin" },
        }),
        sha256,
      )
    ).json();
  const held = async () => {
    const loaded = await loadGbdImports(ports);
    return loaded.state === "ready"
      ? loaded.imports.map((view) => [view.fileName, view.storedRows] as const).sort()
      : [];
  };

  beforeAll(() => requireEmptyGbdStore(db));
  afterEach(() => clearGbdStore(db));
  afterAll(() => db.$disconnect());

  test("deleting the first upload keeps the estimate the second also has", async () => {
    expect(await upload(OVERLAP_FILE_A, "a.csv")).toEqual({
      type: "imported",
      sha256: SHA_A,
      rowCount: 2,
      newRows: 2,
    });
    expect(await upload(OVERLAP_FILE_B, "b.csv")).toEqual({
      type: "imported",
      sha256: SHA_B,
      rowCount: 2,
      newRows: 1,
    });
    expect(await held()).toEqual([
      ["a.csv", 2],
      ["b.csv", 2],
    ]);
    expect(await remove(SHA_A)).toEqual({ ok: true, rowsDeleted: 1 });
    expect(await storedEstimates(db)).toEqual(["Germany 2023", "Switzerland 2023"]);
    expect(await held()).toEqual([["b.csv", 2]]);
  });

  test("deleting the second upload first, then uploading it again", async () => {
    await upload(OVERLAP_FILE_A, "a.csv");
    await upload(OVERLAP_FILE_B, "b.csv");
    expect(await remove(SHA_B)).toEqual({ ok: true, rowsDeleted: 1 });
    expect(await storedEstimates(db)).toEqual(["Switzerland 2021", "Switzerland 2023"]);
    expect(await upload(OVERLAP_FILE_B, "b.csv")).toEqual({
      type: "imported",
      sha256: SHA_B,
      rowCount: 2,
      newRows: 1,
    });
    expect(await remove(SHA_A)).toEqual({ ok: true, rowsDeleted: 1 });
    expect(await storedEstimates(db)).toEqual(["Germany 2023", "Switzerland 2023"]);
  });
});
