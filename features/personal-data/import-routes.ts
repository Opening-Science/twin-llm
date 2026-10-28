import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { ensureAppUser, findAppUserId } from "@/infrastructure/current-user";
import { permitImportedDataStore } from "@/infrastructure/data-mode-policy";
import { dataMode } from "@/infrastructure/data-mode";
import { database } from "@/infrastructure/database";
import {
  type DatasetView,
  personalDataStore,
  type PersonalDataStore,
} from "@/infrastructure/personal-data-store";
import { append, type AppendInput } from "@/packages/audit/append";
import { MAX_FILE_BYTES } from "@/packages/personal-data/limits";
import { parseImport } from "@/packages/personal-data/parse-import";
import {
  reviewSummary,
  type ReviewSummary,
} from "@/packages/personal-data/review-summary";
import { cleanDatasetName, savePlan } from "@/packages/personal-data/save-plan";
import { fileSha256 } from "@/packages/personal-data/text-file";
import {
  type ImportKind,
  isImportKind,
  unmappedCount,
} from "@/packages/personal-data/types";

import {
  type AuditContext,
  deleteEvent,
  listEvent,
  renameEvent,
  reviewEvent,
  saveEvent,
} from "./import-audit";
import { IMPORT_MESSAGES } from "./import-messages";

/**
 * The import routes (Customize · Data, docs/personal-data.md).
 *
 * Review parses the upload and answers with what Save would store; it writes
 * nothing but its audit row. Save receives the same file again, checks that
 * its SHA-256 is the one reviewed, parses it again and writes the dataset in
 * one transaction. Nothing is kept on the server between the two, so a
 * cancelled review leaves no trace but the audit row. Rename and delete act
 * on one dataset of the signed-in person. Every step needs DATA_MODE=personal
 * and is audited with counts only (`import-audit.ts`).
 */

export type ImportPorts = Readonly<{
  resolveActorId: () => Promise<string | null>;
  permit: () => boolean;
  /** Creates the user row; only Save calls it. */
  ensureUserId: (actor: string) => Promise<string>;
  /** Reads never write a user row. */
  findUserId: (actor: string) => Promise<string | null>;
  store: PersonalDataStore;
  audit: (input: AppendInput) => Promise<unknown>;
  sessionId: () => string;
}>;

const defaultPorts = (): ImportPorts => ({
  resolveActorId,
  permit: () => permitImportedDataStore(dataMode()).ok,
  ensureUserId: async (actor) => (await ensureAppUser(actor)).id,
  findUserId: findAppUserId,
  store: personalDataStore(),
  audit: (input) => append(database(), input),
  sessionId: () => crypto.randomUUID(),
});

const portsWith = (overrides: Partial<ImportPorts>): ImportPorts => ({
  ...defaultPorts(),
  ...overrides,
});

export type ReviewPayload =
  | Readonly<{ ok: true; review: ReviewSummary; duplicateOf: DatasetView | null }>
  | Readonly<{ ok: false; error: string }>;

export type SavePayload =
  Readonly<{ ok: true; dataset: DatasetView }> | Readonly<{ ok: false; error: string }>;

const failure = (error: string, status: number): Response =>
  Response.json({ ok: false, error }, { status });

/** Room for the multipart envelope around a 50 MB file. */
const MAX_BODY_BYTES = MAX_FILE_BYTES + 1024 * 1024;

type Upload = Readonly<{
  kind: ImportKind;
  fileName: string;
  bytes: Uint8Array;
  sha256: string;
  form: FormData;
}>;

type UploadResult =
  | Readonly<{ ok: true; upload: Upload }>
  | Readonly<{
      ok: false;
      error: string;
      status: number;
      kind: ImportKind | null;
      byteSize: number;
    }>;

const readUpload = async (request: Request): Promise<UploadResult> => {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return {
      ok: false,
      error: IMPORT_MESSAGES.tooLarge,
      status: 413,
      kind: null,
      byteSize: declared,
    };
  }
  const form = await request.formData().catch((error: unknown) => {
    console.error("[personal-data] upload did not parse:", (error as Error).name);
    return null;
  });
  if (form === null) {
    return {
      ok: false,
      error: IMPORT_MESSAGES.unreadableUpload,
      status: 400,
      kind: null,
      byteSize: 0,
    };
  }
  const kind = form.get("kind");
  const file = form.get("file");
  if (!isImportKind(kind)) {
    return {
      ok: false,
      error: IMPORT_MESSAGES.noKind,
      status: 400,
      kind: null,
      byteSize: 0,
    };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: IMPORT_MESSAGES.noFile, status: 400, kind, byteSize: 0 };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      error: IMPORT_MESSAGES.tooLarge,
      status: 413,
      kind,
      byteSize: file.size,
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    ok: true,
    upload: { kind, fileName: file.name, bytes, sha256: fileSha256(bytes), form },
  };
};

const auditContext = (actor: string, ports: ImportPorts): AuditContext => ({
  actor,
  sessionId: ports.sessionId(),
});

export const postReviewResponse = async (
  request: Request,
  overrides: Partial<ImportPorts> = {},
): Promise<Response> => {
  const ports = portsWith(overrides);
  const actor = await ports.resolveActorId();
  if (!actor) return failure(IMPORT_MESSAGES.signIn, 401);
  const context = auditContext(actor, ports);
  if (!ports.permit()) {
    await ports.audit(
      reviewEvent(
        context,
        { kind: null, byteSize: 0, sha256: null },
        { refused: "synthetic-mode" },
      ),
    );
    return failure(IMPORT_MESSAGES.syntheticMode, 403);
  }
  const read = await readUpload(request);
  if (!read.ok) {
    await ports.audit(
      reviewEvent(
        context,
        { kind: read.kind, byteSize: read.byteSize, sha256: null },
        { refused: "upload" },
      ),
    );
    return failure(read.error, read.status);
  }
  const { upload } = read;
  const file = {
    kind: upload.kind,
    byteSize: upload.bytes.byteLength,
    sha256: upload.sha256,
  };
  const parsed = parseImport(upload.kind, upload.bytes, upload.fileName);
  if (!parsed.ok) {
    await ports.audit(reviewEvent(context, file, { refused: parsed.refusal.code }));
    return failure(parsed.refusal.message, 422);
  }
  const review = reviewSummary(parsed, {
    fileName: upload.fileName,
    byteSize: upload.bytes.byteLength,
    sha256: upload.sha256,
  });
  const userId = await ports.findUserId(actor);
  const duplicateOf =
    userId === null ? null : await ports.store.findBySha(userId, upload.sha256);
  await ports.audit(
    reviewEvent(context, file, {
      rowsToStore: review.rowsToStore,
      unmapped: review.counts.unmapped,
    }),
  );
  return Response.json({ ok: true, review, duplicateOf } satisfies ReviewPayload);
};

export const postSaveResponse = async (
  request: Request,
  overrides: Partial<ImportPorts> = {},
): Promise<Response> => {
  const ports = portsWith(overrides);
  const actor = await ports.resolveActorId();
  if (!actor) return failure(IMPORT_MESSAGES.signIn, 401);
  const context = auditContext(actor, ports);
  if (!ports.permit()) {
    await ports.audit(
      saveEvent(
        context,
        { kind: null, byteSize: 0, sha256: null },
        { refused: "synthetic-mode" },
      ),
    );
    return failure(IMPORT_MESSAGES.syntheticMode, 403);
  }
  const read = await readUpload(request);
  if (!read.ok) {
    await ports.audit(
      saveEvent(
        context,
        { kind: read.kind, byteSize: read.byteSize, sha256: null },
        { refused: "upload" },
      ),
    );
    return failure(read.error, read.status);
  }
  const { upload } = read;
  const file = {
    kind: upload.kind,
    byteSize: upload.bytes.byteLength,
    sha256: upload.sha256,
  };
  const refuse = async (code: string, message: string, status: number) => {
    await ports.audit(saveEvent(context, file, { refused: code }));
    return failure(message, status);
  };

  if (upload.form.get("sha256") !== upload.sha256) {
    return refuse("changed-since-review", IMPORT_MESSAGES.changedSinceReview, 409);
  }
  const parsed = parseImport(upload.kind, upload.bytes, upload.fileName);
  if (!parsed.ok) return refuse(parsed.refusal.code, parsed.refusal.message, 422);

  const userId = await ports.ensureUserId(actor);
  if ((await ports.store.findBySha(userId, upload.sha256)) !== null) {
    return refuse("duplicate", IMPORT_MESSAGES.duplicate, 409);
  }
  const rawName = upload.form.get("name");
  const plan = savePlan(parsed, {
    userId,
    name: typeof rawName === "string" ? rawName : "",
    fileName: upload.fileName,
    sha256: upload.sha256,
    byteSize: upload.bytes.byteLength,
  });
  if (plan.dataset.rowCount === 0) {
    return refuse("nothing-to-store", IMPORT_MESSAGES.nothingToStore, 422);
  }

  const saved = await ports.store.save(plan).catch((error: unknown) => {
    console.error("[personal-data] save failed:", (error as Error).name);
    return null;
  });
  if (saved === null) return refuse("save-failed", IMPORT_MESSAGES.saveFailed, 500);
  if (!saved.ok) return refuse("duplicate", IMPORT_MESSAGES.duplicate, 409);

  const audited = await ports
    .audit(
      saveEvent(context, file, {
        datasetId: saved.dataset.id,
        rows: plan.dataset.rowCount,
        unmapped: unmappedCount(parsed.unmapped),
      }),
    )
    .then(
      () => true,
      (error: unknown) => {
        console.error("[personal-data] save audit failed:", (error as Error).name);
        return false;
      },
    );
  if (!audited) {
    // A write that cannot be audited is undone, so no unaudited data stays.
    await ports.store.remove(userId, saved.dataset.id);
    return failure(IMPORT_MESSAGES.saveFailed, 500);
  }
  return Response.json({ ok: true, dataset: saved.dataset } satisfies SavePayload);
};

export type YourDataState =
  | Readonly<{ state: "synthetic" }>
  | Readonly<{ state: "signed-out" }>
  | Readonly<{ state: "ready"; datasets: readonly DatasetView[] }>;

/** The signed-in person's datasets for the page, audited as a read. */
export const loadYourData = async (
  overrides: Partial<ImportPorts> = {},
): Promise<YourDataState> => {
  const ports = portsWith(overrides);
  if (!ports.permit()) return { state: "synthetic" };
  const actor = await ports.resolveActorId();
  if (!actor) return { state: "signed-out" };
  const userId = await ports.findUserId(actor);
  const datasets = userId === null ? [] : await ports.store.list(userId);
  await ports.audit(listEvent(auditContext(actor, ports), datasets));
  return { state: "ready", datasets };
};

export const patchDatasetResponse = async (
  request: Request,
  id: string,
  overrides: Partial<ImportPorts> = {},
): Promise<Response> => {
  const ports = portsWith(overrides);
  const actor = await ports.resolveActorId();
  if (!actor) return failure(IMPORT_MESSAGES.signIn, 401);
  if (!ports.permit()) return failure(IMPORT_MESSAGES.syntheticMode, 403);
  const body: unknown = await request.json().catch(() => null);
  const raw =
    typeof body === "object" && body !== null && "name" in body ? body.name : undefined;
  const name = typeof raw === "string" ? cleanDatasetName(raw) : "";
  if (name === "") return failure(IMPORT_MESSAGES.badName, 400);
  const userId = await ports.findUserId(actor);
  const dataset = userId === null ? null : await ports.store.rename(userId, id, name);
  await ports.audit(renameEvent(auditContext(actor, ports), id, dataset !== null));
  return dataset === null
    ? failure(IMPORT_MESSAGES.notFound, 404)
    : Response.json({ ok: true, dataset } satisfies SavePayload);
};

export const deleteDatasetResponse = async (
  id: string,
  overrides: Partial<ImportPorts> = {},
): Promise<Response> => {
  const ports = portsWith(overrides);
  const actor = await ports.resolveActorId();
  if (!actor) return failure(IMPORT_MESSAGES.signIn, 401);
  if (!ports.permit()) return failure(IMPORT_MESSAGES.syntheticMode, 403);
  const userId = await ports.findUserId(actor);
  const rowsDeleted = userId === null ? null : await ports.store.remove(userId, id);
  await ports.audit(deleteEvent(auditContext(actor, ports), id, rowsDeleted));
  return rowsDeleted === null
    ? failure(IMPORT_MESSAGES.notFound, 404)
    : Response.json({ ok: true, rowsDeleted });
};
