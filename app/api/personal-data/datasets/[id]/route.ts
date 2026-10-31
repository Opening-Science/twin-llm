import {
  deleteDatasetResponse,
  patchDatasetResponse,
} from "@/features/personal-data/import-routes";
import { withUnlocked } from "@/infrastructure/vault-runtime";

type RouteContext = { params: Promise<{ id: string }> };

/** Renames one of the signed-in person's datasets. */
export const PATCH = withUnlocked(async (request: Request, { params }: RouteContext) =>
  patchDatasetResponse(request, (await params).id),
);

/** Deletes one dataset and every row it holds. */
export const DELETE = withUnlocked(async (_request: Request, { params }: RouteContext) =>
  deleteDatasetResponse((await params).id),
);
