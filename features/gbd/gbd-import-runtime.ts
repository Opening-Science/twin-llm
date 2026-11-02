import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";
import { authOffRefusalResponse } from "@/infrastructure/auth-off-request-guard";
import { isAuthDisabled } from "@/infrastructure/env";
import { append } from "@/packages/audit/append";
import {
  deleteGbdImport,
  gbdImportStore,
  listGbdImports,
} from "@/packages/gbd-local/store";

import {
  createGbdImportHandlers,
  type GbdImportPorts,
  loadGbdImports,
} from "./gbd-import-routes";
import { GBD_IMPORT_MESSAGES } from "./gbd-import-messages";
import { checkGbdUploadRequest } from "./gbd-upload-gate";
import {
  removeUpload,
  saveUpload,
  uploadChunks,
  uploadFreeBytes,
} from "./gbd-upload-file";

/** The GBD import handlers wired to this server's database, state folder and audit chain. */
const ports: GbdImportPorts = {
  isLocalInstall: isAuthDisabled,
  resolveActorId,
  sessionId: () => crypto.randomUUID(),
  audit: (input) => append(database(), input),
  store: () => gbdImportStore(database()),
  list: () => listGbdImports(database()),
  remove: (sha256) => deleteGbdImport(database(), sha256),
  saveUpload: (body, maxBytes) => saveUpload(body, maxBytes),
  freeBytes: () => uploadFreeBytes(),
  chunks: uploadChunks,
  removeUpload,
};

export const gbdImportHandlers = createGbdImportHandlers(ports);

export const loadGbdImportsForPage = () => loadGbdImports(ports);

/**
 * The proxy's checks for the upload route, which the proxy leaves out (#434):
 * the refusal to send, or null to go on.
 */
export const gbdUploadGate = (
  request: Request,
  onSyntheaHost: boolean,
): Response | null => {
  const refusal = checkGbdUploadRequest(request, {
    authDisabled: isAuthDisabled(),
    onSyntheaHost,
  });
  if (refusal === null) return null;
  if (refusal.kind === "auth-off") {
    console.warn(`[gbd] upload request refused (${refusal.refusal.reason})`);
    return authOffRefusalResponse(refusal.refusal);
  }
  if (refusal.kind === "signed-in") {
    return Response.json(
      { ok: false, error: GBD_IMPORT_MESSAGES.notLocal },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  return new Response("Not found.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
