import {
  type DataMode,
  PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
} from "@/infrastructure/data-mode-policy";

import type { McpServerEntry } from "./registry";

export const MCP_SERVER_NOT_PERMITTED_ERROR =
  "PROVIDER_NOT_PERMITTED_FOR_DATA_MODE: A remote MCP server may not be used with personal data. Use a local server, or DATA_MODE=synthetic.";

export type McpServerPermitDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof PROVIDER_NOT_PERMITTED_FOR_DATA_MODE;
      readonly error: typeof MCP_SERVER_NOT_PERMITTED_ERROR;
    };

export const permitServerForDataMode = (
  server: McpServerEntry,
  mode: DataMode,
): McpServerPermitDecision =>
  mode === "personal" && server.locality === "remote"
    ? {
        ok: false,
        code: PROVIDER_NOT_PERMITTED_FOR_DATA_MODE,
        error: MCP_SERVER_NOT_PERMITTED_ERROR,
      }
    : { ok: true };
