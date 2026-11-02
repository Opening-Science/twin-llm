import "server-only";

import { resolveActorId } from "@/infrastructure/auth-actor";
import { database } from "@/infrastructure/database";
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
import { removeUpload, saveUpload, uploadChunks } from "./gbd-upload-file";

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
  chunks: uploadChunks,
  removeUpload,
};

export const gbdImportHandlers = createGbdImportHandlers(ports);

export const loadGbdImportsForPage = () => loadGbdImports(ports);
