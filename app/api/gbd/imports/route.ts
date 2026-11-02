import { gbdImportHandlers, gbdUploadGate } from "@/features/gbd/gbd-import-runtime";
import { syntheaHostRoute } from "@/features/synthea/synthea-host-route";
import { syntheaEnv } from "@/infrastructure/env";
import { withUnlocked } from "@/infrastructure/vault-runtime";

/**
 * Imports one GBD Results Tool CSV (features/gbd/gbd-import-routes.ts, #426).
 * `proxy.ts` does not run here, so the body streams in unbuffered (#434);
 * `gbdUploadGate` makes the proxy's checks before the unlock gate.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const unlockedImport = withUnlocked((request: Request): Promise<Response> =>
  gbdImportHandlers.postImport(request),
);

/** Whether the request names the Synthea generator's host, as proxy.ts tells. */
const onSyntheaHost = (request: Request): boolean =>
  syntheaHostRoute(
    request.headers.get("host"),
    new URL(request.url).pathname,
    syntheaEnv().host,
  ).kind !== "other-host";

export const POST = async (request: Request): Promise<Response> =>
  gbdUploadGate(request, onSyntheaHost(request)) ?? unlockedImport(request);
