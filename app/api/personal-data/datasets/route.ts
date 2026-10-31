import { postSaveResponse } from "@/features/personal-data/import-routes";
import { withUnlocked } from "@/infrastructure/vault-runtime";

/** Saves a reviewed upload as one dataset (docs/personal-data.md). */
export const maxDuration = 300;

export const POST = withUnlocked((request: Request): Promise<Response> =>
  postSaveResponse(request),
);
