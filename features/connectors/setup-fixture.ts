import { parseServerEnv } from "@/infrastructure/env";

import { connectorSetupView, type ConnectorId } from "./connector-setup";

/** Test-only: the setup view for an env with no connector configured. */
export const emptySetup = (id: ConnectorId) =>
  connectorSetupView(
    id,
    parseServerEnv({
      NODE_ENV: "test",
      LOCAL_MVP: "true",
      AUTH_DISABLED: "true",
      LLM_PROVIDER: "ollama",
      DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    }),
    () => false,
  );
