import { parseGbdCitation } from "@/packages/gbd-local/citation";
import { type GbdImportStore, importGbdChunks } from "@/packages/gbd-local/import-chunks";
import type { GbdImportView } from "@/packages/gbd-local/store-types";
import type { AppendInput } from "@/packages/audit/append";

import { type GbdAuditContext, gbdDeleteEvent, gbdImportEvent } from "./gbd-import-audit";
import {
  eventLine,
  GBD_CITATION_HEADER,
  GBD_FILE_NAME_HEADER,
  type GbdImportEvent,
} from "./gbd-import-events";
import { GBD_IMPORT_MESSAGES } from "./gbd-import-messages";
import {
  GBD_MAX_UPLOAD_BYTES,
  GBD_UPLOAD_CODES,
  gbdUploadHasRoom,
} from "./gbd-upload-limits";

/**
 * The GBD import on Customize · Data (#426), as a handler factory so tests
 * pass fakes for the store, the upload folder and the audit chain.
 *
 * `POST /api/gbd/imports` takes one Results Tool CSV as the raw request body,
 * its name in `x-gbd-file-name` and, when the person chose the download's
 * citation.txt too, its text in `x-gbd-citation` (both URI-encoded). The body
 * is written to a temporary file in the state folder as it arrives and hashed
 * on the way; the import then reads that file a megabyte at a time
 * (`importGbdChunks`) and answers with newline-delimited progress events and
 * the outcome (`gbd-import-events.ts`). The file is removed when the import
 * ends, whatever the outcome.
 *
 * The file may be up to 1 GB (#434). `proxy.ts` does not run on this route,
 * so Next does not buffer the body; the route makes the proxy's checks itself
 * (`gbd-upload-gate.ts`). A file declared larger than the cap is refused
 * before a byte is read, one that grows past it is stopped and its partial
 * file removed, and a file that would leave less than 1 GB free in the state
 * folder is refused before it is read.
 *
 * GBD results are population data, not personal data, but the GBD store is
 * shared by everyone using the server, so every route here works on a local
 * install only (LOCAL_MVP or AUTH_DISABLED), answers same-site requests only,
 * and sits behind the unlock gate like the rest of the page (#142). Each
 * import and delete writes one audit row with sizes, the checksum and counts.
 */

export type SavedUpload =
  | Readonly<{ ok: true; path: string; sha256: string; bytes: number }>
  | Readonly<{ ok: false; reason: "too-large" | "empty" | "no-space" }>;

export type GbdImportPorts = Readonly<{
  isLocalInstall: () => boolean;
  resolveActorId: () => Promise<string | null>;
  sessionId: () => string;
  audit: (input: AppendInput) => Promise<unknown>;
  store: () => GbdImportStore;
  list: () => Promise<readonly GbdImportView[]>;
  remove: (sha256: string) => Promise<number | null>;
  saveUpload: (
    body: ReadableStream<Uint8Array>,
    maxBytes: number,
  ) => Promise<SavedUpload>;
  /** Free bytes where uploads are written, or null when it cannot be told. */
  freeBytes: () => Promise<number | null>;
  chunks: (path: string) => AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  removeUpload: (path: string) => Promise<void>;
}>;

const MAX_CITATION_CHARS = 4000;
const MAX_NAME_CHARS = 255;
const SHA256 = /^[0-9a-f]{64}$/;

const failure = (error: string, status: number, code?: string): Response =>
  Response.json(code === undefined ? { ok: false, error } : { ok: false, error, code }, {
    status,
    headers: { "cache-control": "no-store" },
  });

/** Only this app's own pages may import or delete. */
const fromOtherSite = (request: Request): boolean => {
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
};

const decoded = (value: string | null): string | null => {
  if (value === null) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
};

/** The base name of a chosen CSV file, or null when it is not one. */
export const gbdUploadName = (raw: string | null): string | null => {
  const name = (decoded(raw) ?? "").split(/[\\/]/).pop()?.trim() ?? "";
  return name.length > 0 && name.length <= MAX_NAME_CHARS && /\.csv$/i.test(name)
    ? name
    : null;
};

/** The citation from a citation.txt sent along, as one line, or null. */
export const gbdUploadCitation = (raw: string | null): string | null => {
  const text = decoded(raw);
  if (text === null || text.length > MAX_CITATION_CHARS) return null;
  return parseGbdCitation(text);
};

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

export const createGbdImportHandlers = (ports: GbdImportPorts) => {
  /** Who is asking, or the refusal; the same three checks for every route. */
  const admit = async (
    request: Request,
  ): Promise<
    | Readonly<{ ok: true; context: GbdAuditContext }>
    | Readonly<{ ok: false; response: Response }>
  > => {
    if (fromOtherSite(request)) {
      return { ok: false, response: failure(GBD_IMPORT_MESSAGES.otherSite, 403) };
    }
    if (!ports.isLocalInstall()) {
      return { ok: false, response: failure(GBD_IMPORT_MESSAGES.notLocal, 403) };
    }
    const actor = await ports.resolveActorId();
    if (!actor) return { ok: false, response: failure(GBD_IMPORT_MESSAGES.signIn, 401) };
    return { ok: true, context: { actor, sessionId: ports.sessionId() } };
  };

  const postImport = async (request: Request): Promise<Response> => {
    const admitted = await admit(request);
    if (!admitted.ok) return admitted.response;
    const { context } = admitted;
    const refuse = async (
      code: string,
      message: string,
      status: number,
      bytes = 0,
      shownCode?: string,
    ) => {
      await ports.audit(
        gbdImportEvent(context, { bytes, sha256: null }, { kind: "refused", code }),
      );
      return failure(message, status, shownCode);
    };
    const tooLarge = (bytes = 0) =>
      refuse(
        "too-large",
        GBD_IMPORT_MESSAGES.tooLarge,
        413,
        bytes,
        GBD_UPLOAD_CODES.tooLarge,
      );
    const noSpace = (bytes = 0) =>
      refuse(
        "no-space",
        GBD_IMPORT_MESSAGES.noSpace,
        507,
        bytes,
        GBD_UPLOAD_CODES.noSpace,
      );

    const rawName = request.headers.get(GBD_FILE_NAME_HEADER);
    if (decoded(rawName)?.trim().toLowerCase() === "citation.txt") {
      return refuse("citation-only", GBD_IMPORT_MESSAGES.citationOnly, 400);
    }
    const fileName = gbdUploadName(rawName);
    if (fileName === null) return refuse("not-csv", GBD_IMPORT_MESSAGES.notCsv, 400);
    const declaredText = request.headers.get("content-length");
    const declared = declaredText === null ? null : Number(declaredText);
    if (declared !== null && declared > GBD_MAX_UPLOAD_BYTES) return tooLarge(declared);
    if (request.body === null) return refuse("empty", GBD_IMPORT_MESSAGES.empty, 400);
    const free = await ports.freeBytes().catch((error: unknown) => {
      console.error("[gbd] free space not read:", errorName(error));
      return null;
    });
    const declaredBytes =
      declared !== null && Number.isFinite(declared) ? declared : null;
    if (!gbdUploadHasRoom(free, declaredBytes)) return noSpace(declaredBytes ?? 0);

    const saved = await ports
      .saveUpload(request.body, GBD_MAX_UPLOAD_BYTES)
      .catch((error: unknown) => {
        console.error("[gbd] upload not saved:", errorName(error));
        return null;
      });
    if (saved === null) return refuse("upload-failed", GBD_IMPORT_MESSAGES.failed, 500);
    if (!saved.ok) {
      if (saved.reason === "too-large") return tooLarge();
      if (saved.reason === "no-space") return noSpace();
      return refuse("empty", GBD_IMPORT_MESSAGES.empty, 400);
    }
    if (declaredBytes !== null && saved.bytes !== declaredBytes) {
      await ports.removeUpload(saved.path);
      return refuse("incomplete", GBD_IMPORT_MESSAGES.incomplete, 400, saved.bytes);
    }

    const citation = gbdUploadCitation(request.headers.get(GBD_CITATION_HEADER));
    const file = { bytes: saved.bytes, sha256: saved.sha256 };

    const run = async (send: (event: GbdImportEvent) => void): Promise<void> => {
      try {
        const outcome = await importGbdChunks(
          { sha256: saved.sha256, fileName, citation },
          ports.chunks(saved.path),
          ports.store(),
          (progress) => send({ type: "progress", ...progress }),
        );
        if (outcome.kind === "refused") {
          await ports.audit(
            gbdImportEvent(context, file, { kind: "refused", code: outcome.error.code }),
          );
          send({ type: "refused", error: outcome.error });
          return;
        }
        if (outcome.kind === "already-imported") {
          await ports.audit(gbdImportEvent(context, file, { kind: "already-imported" }));
          send({ type: "already-imported", sha256: outcome.sha256 });
          return;
        }
        const audited = await ports
          .audit(
            gbdImportEvent(context, file, {
              kind: "imported",
              rows: outcome.rowCount,
              newRows: outcome.newRows,
            }),
          )
          .then(
            () => true,
            (error: unknown) => {
              console.error("[gbd] import audit failed:", errorName(error));
              return false;
            },
          );
        if (!audited) {
          // An import that cannot be audited is undone.
          await ports.remove(outcome.sha256);
          send({ type: "failed", message: GBD_IMPORT_MESSAGES.failed });
          return;
        }
        send({
          type: "imported",
          sha256: outcome.sha256,
          rowCount: outcome.rowCount,
          newRows: outcome.newRows,
        });
      } catch (error: unknown) {
        console.error("[gbd] import failed:", errorName(error));
        send({ type: "failed", message: GBD_IMPORT_MESSAGES.failed });
      } finally {
        await ports.removeUpload(saved.path).catch((error: unknown) => {
          console.error("[gbd] upload not removed:", errorName(error));
        });
      }
    };

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        // Mutable on purpose: whether the page stopped listening.
        const listening = { open: true };
        await run((event) => {
          if (!listening.open) return;
          try {
            controller.enqueue(encoder.encode(eventLine(event)));
          } catch {
            listening.open = false;
          }
        });
        if (listening.open) controller.close();
      },
    });
    return new Response(body, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  };

  const deleteImport = async (request: Request, sha256: string): Promise<Response> => {
    const admitted = await admit(request);
    if (!admitted.ok) return admitted.response;
    if (!SHA256.test(sha256)) return failure(GBD_IMPORT_MESSAGES.notFound, 404);
    const removed = await ports.remove(sha256).then(
      (rows) => ({ ok: true as const, rows }),
      (error: unknown) => {
        console.error("[gbd] delete failed:", errorName(error));
        return { ok: false as const };
      },
    );
    if (!removed.ok) return failure(GBD_IMPORT_MESSAGES.deleteFailed, 500);
    await ports.audit(gbdDeleteEvent(admitted.context, sha256, removed.rows));
    return removed.rows === null
      ? failure(GBD_IMPORT_MESSAGES.notFound, 404)
      : Response.json(
          { ok: true, rowsDeleted: removed.rows },
          { headers: { "cache-control": "no-store" } },
        );
  };

  return { postImport, deleteImport };
};

export type GbdImportsState =
  | Readonly<{ state: "not-local" }>
  | Readonly<{ state: "ready"; imports: readonly GbdImportView[] }>;

/** The imported GBD files for the page; population data, so the list is not audited. */
export const loadGbdImports = async (
  ports: Pick<GbdImportPorts, "isLocalInstall" | "list">,
): Promise<GbdImportsState> =>
  ports.isLocalInstall()
    ? { state: "ready", imports: await ports.list() }
    : { state: "not-local" };
