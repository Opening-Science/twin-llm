import { syntheaRoutes } from "@/features/synthea/synthea-jobs";

/** Starts a Synthea run (features/synthea/synthea-routes.ts). */
export const dynamic = "force-dynamic";

export const POST = (request: Request): Promise<Response> =>
  syntheaRoutes.createJob(request);
