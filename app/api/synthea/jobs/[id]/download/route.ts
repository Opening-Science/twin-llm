import { syntheaRoutes } from "@/features/synthea/synthea-jobs";

/** A finished run's zip, once (features/synthea/synthea-routes.ts). */
export const dynamic = "force-dynamic";

export const GET = async (
  _request: Request,
  { params }: Readonly<{ params: Promise<{ id: string }> }>,
): Promise<Response> => syntheaRoutes.downloadJob((await params).id);
