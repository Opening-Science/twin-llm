import { gbdImportHandlers } from "@/features/gbd/gbd-import-runtime";
import { withUnlocked } from "@/infrastructure/vault-runtime";

type RouteContext = { params: Promise<{ sha256: string }> };

/** Deletes one imported GBD file and the estimates it brought (#426). */
export const DELETE = withUnlocked(async (request: Request, { params }: RouteContext) =>
  gbdImportHandlers.deleteImport(request, (await params).sha256),
);
