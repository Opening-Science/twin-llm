import type { ServerEnv } from "@/infrastructure/env";

/**
 * What each connector needs before it can work, for the "Setup" disclosure.
 *
 * The page must never show a token, secret or value, so this module turns the
 * parsed env into env *names* and booleans only. Redirect URIs, commands and
 * steps are the fixed local-development defaults from `.env.example` and
 * `docs/connectors.md`, not anything read from the environment. Pure, so the
 * exact names are tested without a server.
 */

export type ConnectorId =
  "oura" | "whoop" | "google-health" | "bodyloop" | "gbd" | "guidelines" | "ark";

type EnvName = keyof ServerEnv & string;

export type SetupStep = Readonly<{ text: string; command?: string }>;

type SetupSpec = Readonly<{
  required: readonly EnvName[];
  optional: readonly EnvName[];
  /** The URI to register with the vendor, and the env name that must equal it. */
  redirect: Readonly<{ name: EnvName; uri: string }> | null;
  steps: readonly SetupStep[];
  doc: string;
}>;

const DOCS = "https://github.com/Opening-Science/twin-llm/blob/main/docs";
const OPEN_LOCALHOST: SetupStep = {
  text: "Open TwinLLM at http://localhost:3000 (not 127.0.0.1) before linking, so the sign-in return finds this browser session.",
};
const ENCRYPTION_KEY: SetupStep = {
  text: "Make the token encryption key (64 hex characters) with",
  command: "openssl rand -hex 32",
};

export const CONNECTOR_SETUP: Readonly<Record<ConnectorId, SetupSpec>> = {
  oura: {
    required: [
      "OURA_CLIENT_ID",
      "OURA_CLIENT_SECRET",
      "OURA_REDIRECT_URI",
      "OURA_TOKEN_ENCRYPTION_KEY",
    ],
    optional: [],
    redirect: { name: "OURA_REDIRECT_URI", uri: "http://localhost:8787/callback" },
    steps: [
      ENCRYPTION_KEY,
      {
        text: "Keep the local redirect proxy running while you link",
        command: "bun run oura:proxy",
      },
      OPEN_LOCALHOST,
    ],
    doc: `${DOCS}/connectors.md#oura`,
  },
  whoop: {
    required: [
      "WHOOP_CLIENT_ID",
      "WHOOP_CLIENT_SECRET",
      "WHOOP_REDIRECT_URI",
      "WHOOP_TOKEN_ENCRYPTION_KEY",
    ],
    optional: [],
    redirect: {
      name: "WHOOP_REDIRECT_URI",
      uri: "https://localhost:8788/api/whoop/callback",
    },
    steps: [
      ENCRYPTION_KEY,
      {
        text: "Whoop only accepts https. Put a local certificate in certificates/ (localhost.pem and localhost-key.pem), for example with",
        command:
          "mkcert -cert-file certificates/localhost.pem -key-file certificates/localhost-key.pem localhost",
      },
      {
        text: "Keep the HTTPS redirect proxy running while you link",
        command: "bun run whoop:proxy",
      },
      {
        text: "Open https://localhost:8788/api/whoop/callback once and accept the certificate.",
      },
      OPEN_LOCALHOST,
    ],
    doc: `${DOCS}/connectors.md#whoop`,
  },
  "google-health": {
    required: [
      "GOOGLE_HEALTH_CLIENT_ID",
      "GOOGLE_HEALTH_CLIENT_SECRET",
      "GOOGLE_HEALTH_REDIRECT_URI",
      "GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY",
    ],
    optional: [],
    redirect: {
      name: "GOOGLE_HEALTH_REDIRECT_URI",
      uri: "http://localhost:3000/api/google-health/callback",
    },
    steps: [
      ENCRYPTION_KEY,
      {
        text: "Print the Google Cloud Console steps with",
        command: "bun run google-health:setup",
      },
      {
        text: "The Google account must be linked to Fitbit; Health Connect alone is not enough.",
      },
      OPEN_LOCALHOST,
    ],
    doc: `${DOCS}/connectors.md#google-health`,
  },
  bodyloop: {
    required: ["VITRONIC_TOKEN_ENCRYPTION_KEY"],
    optional: ["VITRONIC_DATA_DIR"],
    redirect: null,
    steps: [
      ENCRYPTION_KEY,
      {
        text: "An operator mints a per-user API token, then enters it on this card",
        command: "bun scripts/vitronic/mint-token.ts",
      },
    ],
    doc: `${DOCS}/connectors.md#bodyloop-vitronic`,
  },
  gbd: {
    required: ["GBD_MCP_URL", "GBD_MCP_TOKEN"],
    optional: [],
    redirect: null,
    steps: [],
    doc: `${DOCS}/gbd.md`,
  },
  guidelines: {
    required: [],
    optional: [],
    redirect: null,
    steps: [
      {
        text: "Extract the open guideline texts locally (see the guide), then ingest them with",
        command:
          "bun --preload ./features/chat/response/preload-server-only.mjs packages/guidelines/ingest-cli.ts",
      },
      { text: "Embeddings run on local Ollama (nomic-embed-text)." },
    ],
    doc: `${DOCS}/guidelines.md`,
  },
  ark: {
    required: ["GENOME_SOURCE"],
    optional: ["ARK_DEVICE"],
    redirect: null,
    steps: [{ text: "Set GENOME_SOURCE to ark to let TwinLLM reach the device." }],
    doc: `${DOCS}/ark.md`,
  },
};

export type EnvCheck = Readonly<{
  name: EnvName;
  optional: boolean;
  set: boolean;
  /** Dev hint: the line exists but is blank or starts with `#`. */
  looksEmpty: boolean;
}>;

export type ConnectorSetupView = Readonly<{
  checks: readonly EnvCheck[];
  redirectUri: string | null;
  /** null when the redirect env is unset; false when it differs from `redirectUri`. */
  redirectMatches: boolean | null;
  steps: readonly SetupStep[];
  doc: string;
}>;

/** GENOME_SOURCE always has a value ("none" by default); it counts as set only when it is "ark". */
const isSet = (env: ServerEnv, name: EnvName): boolean =>
  name === "GENOME_SOURCE" ? env.GENOME_SOURCE === "ark" : Boolean(env[name]);

const checkFor = (
  env: ServerEnv,
  looksEmpty: (name: string) => boolean,
  name: EnvName,
  optional: boolean,
): EnvCheck => {
  const empty = looksEmpty(name);
  return { name, optional, set: isSet(env, name) && !empty, looksEmpty: empty };
};

export const connectorSetupView = (
  id: ConnectorId,
  env: ServerEnv,
  looksEmpty: (name: string) => boolean,
): ConnectorSetupView => {
  const spec = CONNECTOR_SETUP[id];
  const redirectValue = spec.redirect ? env[spec.redirect.name] : undefined;
  return {
    checks: [
      ...spec.required.map((name) => checkFor(env, looksEmpty, name, false)),
      ...spec.optional.map((name) => checkFor(env, looksEmpty, name, true)),
    ],
    redirectUri: spec.redirect?.uri ?? null,
    redirectMatches:
      spec.redirect && typeof redirectValue === "string"
        ? redirectValue === spec.redirect.uri
        : null,
    steps: spec.steps,
    doc: spec.doc,
  };
};

export const CONNECTOR_IDS = Object.keys(CONNECTOR_SETUP) as readonly ConnectorId[];

/** Every connector's setup view, built once on the server and passed to the cards. */
export const connectorSetupViews = (
  env: ServerEnv,
  looksEmpty: (name: string) => boolean,
): Readonly<Record<ConnectorId, ConnectorSetupView>> =>
  Object.fromEntries(
    CONNECTOR_IDS.map((id) => [id, connectorSetupView(id, env, looksEmpty)]),
  ) as Record<ConnectorId, ConnectorSetupView>;

/**
 * Why a card is "Not configured", in one line: "3 env values missing",
 * "1 env value looks empty". Null when every required name is set.
 */
export const setupGap = (setup: ConnectorSetupView): string | null => {
  const required = setup.checks.filter((check) => !check.optional);
  const empty = required.filter((check) => check.looksEmpty).length;
  const missing = required.filter((check) => !check.set && !check.looksEmpty).length;
  const plural = (count: number) => (count === 1 ? "env value" : "env values");
  const parts = [
    missing > 0 ? `${missing} ${plural(missing)} missing` : null,
    empty > 0
      ? `${empty} ${plural(empty)} ${empty === 1 ? "looks" : "look"} empty`
      : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? `${parts.join(", ")}. See Setup.` : null;
};
