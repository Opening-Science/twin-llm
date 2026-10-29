import { syntheaRoutes } from "@/features/synthea/synthea-jobs";

/** A run's state and preview (features/synthea/synthea-routes.ts). */
export const dynamic = "force-dynamic";

export const GET = async (
  _request: Request,
  { params }: Readonly<{ params: Promise<{ id: string }> }>,
): Promise<Response> => syntheaRoutes.jobStatus((await params).id);
