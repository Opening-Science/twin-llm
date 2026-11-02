import {
  type AuthOffRefusal,
  checkAuthOffRequest,
} from "@/infrastructure/auth-off-request-guard";

/**
 * The checks `proxy.ts` would make, for `POST /api/gbd/imports` (#434).
 *
 * The proxy's matcher leaves that one route out: Next buffers in memory every
 * request body the proxy sees, and cuts it at `proxyClientMaxBodySize`
 * (52 MB, next.config.ts). Without the proxy the body streams straight to the
 * route, which writes it to a file as it arrives. So the route asks the same
 * questions first: a request for the Synthea generator's host (the route
 * tells, with `syntheaHostRoute`) is not found,
 * a signed-in server refuses (GBD files are imported on a local install
 * only), and with auth off the request must come from this machine and this
 * app (`checkAuthOffRequest`). Pure, so it is tested with plain requests.
 */

export type GbdUploadGateRefusal =
  | Readonly<{ kind: "synthea-host" }>
  | Readonly<{ kind: "signed-in" }>
  | Readonly<{ kind: "auth-off"; refusal: AuthOffRefusal }>;

export const checkGbdUploadRequest = (
  request: Request,
  setup: Readonly<{ authDisabled: boolean; onSyntheaHost: boolean }>,
): GbdUploadGateRefusal | null => {
  if (setup.onSyntheaHost) return { kind: "synthea-host" };
  if (!setup.authDisabled) return { kind: "signed-in" };
  const refusal = checkAuthOffRequest(request);
  return refusal === null ? null : { kind: "auth-off", refusal };
};
