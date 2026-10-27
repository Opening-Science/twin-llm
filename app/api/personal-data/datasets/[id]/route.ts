import {
  deleteDatasetResponse,
  patchDatasetResponse,
} from "@/features/personal-data/import-routes";

type RouteContext = { params: Promise<{ id: string }> };

/** Renames one of the signed-in person's datasets. */
export const PATCH = async (request: Request, { params }: RouteContext) =>
  patchDatasetResponse(request, (await params).id);

/** Deletes one dataset and every row it holds. */
export const DELETE = async (_request: Request, { params }: RouteContext) =>
  deleteDatasetResponse((await params).id);
