import { gbdImportHandlers } from "@/features/gbd/gbd-import-runtime";
import { withUnlocked } from "@/infrastructure/vault-runtime";

/** Imports one GBD Results Tool CSV (features/gbd/gbd-import-routes.ts, #426). */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = withUnlocked((request: Request): Promise<Response> =>
  gbdImportHandlers.postImport(request),
);
