import "server-only";

import { homedir } from "node:os";
import { resolve as resolvePath } from "node:path";

import { z } from "zod";

import {
  EXOSCALE_PERSONAL_DATA_SETTINGS,
  type ExoscalePersonalData,
} from "./data-mode-policy";
import { parseDirtyFlag } from "./build-stamp";
import { isLoopbackUrl } from "./loopback";
import { DEFAULT_OLLAMA_NUM_CTX, MIN_OLLAMA_NUM_CTX } from "./ollama-context";
import { defaultStateDir } from "./storage-hardening";

/**
 * Server configuration for TwinLLM, validated once and then read everywhere
 * through `serverEnv()` and the small per-integration accessors below.
 *
 * Modes, from lightest to strictest:
 *
 * - LOCAL_MVP=true or AUTH_DISABLED=true ("auth off"): Clerk and Arcjet keys
 *   become optional so a research demo boots with a database and one model
 *   path. Auth off trusts whoever reaches the server, so it is refused under
 *   NODE_ENV=production unless ALLOW_AUTH_DISABLED_IN_PRODUCTION=true, and
 *   `proxy.ts` only answers loopback, same-site requests while it is on.
 * - Default: Clerk and Arcjet are required. PostHog is always optional; when
 *   its key is set without a host, the EU host is used.
 * - LOCAL_ONLY=true: models, embeddings, analytics and auth stay on this
 *   machine. LLM_PROVIDER defaults to ollama, and any cloud model provider,
 *   remote Ollama, remote GBD server or PostHog / Arcjet / Clerk key stops
 *   the boot. Wearable syncs still download from each vendor's cloud.
 *
 * Providers: exoscale (our own vLLM servers in Switzerland) is the default
 * outside LOCAL_ONLY and needs EXOSCALE_BASE_URLS; there is no silent
 * fallback to another cloud. remote-gpu reaches a rented GPU through SSH
 * tunnels on loopback and, like openrouter, is for synthetic data only.
 * infomaniak is legacy and only used when named. DATA_MODE=personal (the
 * default) refuses openrouter, remote-gpu and infomaniak, and refuses exoscale
 * unless EXOSCALE_PERSONAL_DATA=consented-pilot (see data-mode-policy.ts).
 */

/** How long a cloud model may stay silent before the first byte of its answer. */
export const DEFAULT_FIRST_BYTE_TIMEOUT_S = 120;

/** How long the local Carbon-X sidecar may take for one answer. */
export const DEFAULT_CARBON_X_TIMEOUT_S = 120;

/** Ollama's OpenAI-compatible root on this machine when OLLAMA_BASE_URL is unset. */
export { DEFAULT_OLLAMA_BASE_URL } from "./ollama-context";

/** The Carbon-X sidecar's OpenAI-compatible root when CARBON_X_URL is unset. */
export const DEFAULT_CARBON_X_URL = "http://127.0.0.1:8090/v1";

/** The host name that serves only the Synthea generator (docs/synthea-generator.md). */
export const DEFAULT_SYNTHEA_HOST = "synthea.opening.science";

/** PostHog's EU ingestion host, used when only a key is configured. */
export const DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com";

// ---------------------------------------------------------------------------
// Field builders. Every optional string treats "" (and whitespace) as unset.
// ---------------------------------------------------------------------------

const blankAsMissing = (value: unknown): unknown =>
  typeof value === "string" && value.trim().length === 0 ? undefined : value;

const maybeText = () => z.preprocess(blankAsMissing, z.string().min(1).optional());

const maybeUrl = () => z.preprocess(blankAsMissing, z.string().url().optional());

const flag = (fallback: "true" | "false" = "false") =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((raw) => raw === "true");

const blankableFlag = () =>
  z
    .preprocess(blankAsMissing, z.enum(["true", "false"]).default("false"))
    .transform((raw) => raw === "true");

/** "a, b,,c" becomes ["a", "b", "c"]; unset becomes []. */
const splitList = (raw: string | undefined): readonly string[] =>
  Object.freeze(
    (raw ?? "")
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );

const urlList = () =>
  z.preprocess(blankAsMissing, z.string().optional()).transform(splitList);

const HEX_256 = /^[0-9a-fA-F]{64}$/;

const hexKey = (name: string) =>
  z.preprocess(
    blankAsMissing,
    z.string().regex(HEX_256, `${name} must be 64 hex characters`).optional(),
  );

/** A whole number between `min` and `max`, `fallback` when unset. */
const wholeNumberIn = (name: string, min: number, max: number, fallback: number) =>
  z.preprocess(
    blankAsMissing,
    z.coerce
      .number()
      .int(`${name} must be a whole number`)
      .min(min, `${name} must be at least ${min}`)
      .max(max, `${name} must be at most ${max}`)
      .default(fallback),
  );

/** A DNS host name, lower or upper case, no port. */
const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

// ---------------------------------------------------------------------------
// Cross-field policies. Each one adds named issues; none of them echoes a
// configured value, because URLs and keys can carry credentials.
// ---------------------------------------------------------------------------

type Issue = Readonly<{ path: string; message: string }>;

type Report = (issue: Issue) => void;

/** Keys whose presence would send data off this machine in LOCAL_ONLY mode. */
const LOCAL_ONLY_FORBIDDEN_KEYS = [
  "NEXT_PUBLIC_POSTHOG_KEY",
  "ARCJET_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
] as const;

const LOCAL_ONLY_PROVIDER_MESSAGES: Readonly<Record<string, string>> = {
  "remote-gpu":
    "LOCAL_ONLY=true needs LLM_PROVIDER=ollama; remote-gpu runs the model on another machine even though its tunnel is on 127.0.0.1. Set LOCAL_ONLY=false",
  exoscale:
    "LOCAL_ONLY=true needs LLM_PROVIDER=ollama; exoscale runs the model on our Exoscale instance, not on this machine. Set LOCAL_ONLY=false",
};

type LocalOnlyView = Readonly<
  {
    LLM_PROVIDER: string;
    OLLAMA_BASE_URL?: string;
    GBD_MCP_URL?: string;
  } & Partial<Record<(typeof LOCAL_ONLY_FORBIDDEN_KEYS)[number], string>>
>;

const checkLocalOnly = (env: LocalOnlyView, authOff: boolean, report: Report): void => {
  if (!authOff) {
    report({
      path: "LOCAL_ONLY",
      message: "LOCAL_ONLY=true needs LOCAL_MVP=true or AUTH_DISABLED=true",
    });
  }
  if (env.LLM_PROVIDER !== "ollama") {
    report({
      path: "LLM_PROVIDER",
      message:
        LOCAL_ONLY_PROVIDER_MESSAGES[env.LLM_PROVIDER] ??
        "LOCAL_ONLY=true needs LLM_PROVIDER=ollama; cloud model providers are off",
    });
  }
  if (env.OLLAMA_BASE_URL !== undefined && !isLoopbackUrl(env.OLLAMA_BASE_URL)) {
    report({
      path: "OLLAMA_BASE_URL",
      message:
        "LOCAL_ONLY=true needs OLLAMA_BASE_URL on this machine (localhost, 127.0.0.1 or [::1])",
    });
  }
  if (env.GBD_MCP_URL !== undefined) {
    report({
      path: "GBD_MCP_URL",
      message: "LOCAL_ONLY=true turns off the remote GBD server; unset GBD_MCP_URL",
    });
  }
  LOCAL_ONLY_FORBIDDEN_KEYS.filter((key) => env[key] !== undefined).forEach((key) =>
    report({
      path: key,
      message: `LOCAL_ONLY=true turns off cloud analytics and auth; unset ${key}`,
    }),
  );
};

/**
 * Shape rules shared by both vLLM URL lists: no credentials, no query or
 * hash, and a path ending in /v1. Returns the first problem, named by list and
 * position only.
 */
const baseUrlShapeProblem = (list: string, position: number, url: URL): string | null => {
  const entry = `${list} entry ${position}`;
  if (url.username.length > 0 || url.password.length > 0) {
    return `${entry} must not contain a username or password`;
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return `${entry} must not contain a query or hash`;
  }
  return /\/v1\/?$/.test(url.pathname) ? null : `${entry} must end in /v1`;
};

const remoteGpuUrlProblem = (raw: string, position: number): string | null => {
  const entry = `REMOTE_GPU_BASE_URLS entry ${position}`;
  if (!isLoopbackUrl(raw)) {
    return `${entry} must be an SSH tunnel on this machine (localhost, 127.0.0.1 or [::1])`;
  }
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `${entry} must start with http:// or https://`;
  }
  return baseUrlShapeProblem("REMOTE_GPU_BASE_URLS", position, url);
};

type RemoteGpuView = Readonly<{
  LLM_PROVIDER: string;
  DATA_MODE: string;
  REMOTE_GPU_BASE_URLS: readonly string[];
}>;

const checkRemoteGpu = (env: RemoteGpuView, report: Report): void => {
  env.REMOTE_GPU_BASE_URLS.map((raw, index) => remoteGpuUrlProblem(raw, index + 1))
    .filter((problem): problem is string => problem !== null)
    .forEach((message) => report({ path: "REMOTE_GPU_BASE_URLS", message }));

  if (env.LLM_PROVIDER !== "remote-gpu") return;
  if (env.REMOTE_GPU_BASE_URLS.length === 0) {
    report({
      path: "REMOTE_GPU_BASE_URLS",
      message:
        "REMOTE_GPU_BASE_URLS is required when LLM_PROVIDER=remote-gpu (comma list such as http://127.0.0.1:8000/v1)",
    });
  }
  if (env.DATA_MODE === "personal") {
    report({
      path: "LLM_PROVIDER",
      message:
        "DATA_MODE=personal forbids LLM_PROVIDER=remote-gpu; the remote GPU is for synthetic data only",
    });
  }
};

/** Case and trailing slashes never make two URLs different servers. */
const sameServerKey = (raw: string): string =>
  raw.trim().toLowerCase().replace(/\/+$/, "");

/**
 * Exoscale URLs are https, except plain http on loopback when
 * EXOSCALE_ALLOW_LOOPBACK_TUNNEL=true (an SSH tunnel to our own VM). A URL
 * that is also a remote-gpu tunnel is refused, so personal data can never
 * reach a rented GPU under the exoscale label.
 */
const exoscaleUrlProblem = (
  raw: string,
  position: number,
  allowTunnel: boolean,
  remoteGpuKeys: ReadonlySet<string>,
): string | null => {
  const entry = `EXOSCALE_BASE_URLS entry ${position}`;
  const url = URL.canParse(raw) ? new URL(raw) : null;
  if (url === null) return `${entry} is not a URL`;

  const plainLoopback = url.protocol === "http:" && isLoopbackUrl(raw);
  if (url.protocol !== "https:" && !(plainLoopback && allowTunnel)) {
    return plainLoopback
      ? `${entry} is plain http on loopback; set EXOSCALE_ALLOW_LOOPBACK_TUNNEL=true only for an SSH tunnel to our own Exoscale VM`
      : `${entry} must start with https:// (plain http only on loopback with EXOSCALE_ALLOW_LOOPBACK_TUNNEL=true)`;
  }
  const shape = baseUrlShapeProblem("EXOSCALE_BASE_URLS", position, url);
  if (shape !== null) return shape;
  return remoteGpuKeys.has(sameServerKey(raw))
    ? `${entry} is also in REMOTE_GPU_BASE_URLS; a remote-gpu tunnel must never carry exoscale traffic`
    : null;
};

type ExoscaleView = Readonly<{
  LLM_PROVIDER: string;
  DATA_MODE: string;
  EXOSCALE_PERSONAL_DATA: ExoscalePersonalData;
  EXOSCALE_BASE_URLS: readonly string[];
  EXOSCALE_ALLOW_LOOPBACK_TUNNEL: boolean;
  REMOTE_GPU_BASE_URLS: readonly string[];
}>;

const checkExoscale = (env: ExoscaleView, report: Report): void => {
  const remoteGpuKeys = new Set(env.REMOTE_GPU_BASE_URLS.map(sameServerKey));
  env.EXOSCALE_BASE_URLS.map((raw, index) =>
    exoscaleUrlProblem(raw, index + 1, env.EXOSCALE_ALLOW_LOOPBACK_TUNNEL, remoteGpuKeys),
  )
    .filter((problem): problem is string => problem !== null)
    .forEach((message) => report({ path: "EXOSCALE_BASE_URLS", message }));

  if (env.LLM_PROVIDER === "exoscale" && env.EXOSCALE_BASE_URLS.length === 0) {
    report({
      path: "EXOSCALE_BASE_URLS",
      message:
        "EXOSCALE_BASE_URLS is required when LLM_PROVIDER=exoscale, the default with LOCAL_ONLY=false (comma list of vLLM URLs ending in /v1, one per GPU). For a model on this machine set LOCAL_ONLY=true",
    });
  }
  if (
    env.LLM_PROVIDER === "exoscale" &&
    env.DATA_MODE === "personal" &&
    env.EXOSCALE_PERSONAL_DATA !== "consented-pilot"
  ) {
    report({
      path: "EXOSCALE_PERSONAL_DATA",
      message:
        "DATA_MODE=personal with LLM_PROVIDER=exoscale (the default with LOCAL_ONLY=false) needs EXOSCALE_PERSONAL_DATA=consented-pilot, for a pilot whose participants consented. Otherwise use local Ollama (LOCAL_ONLY=true) or set DATA_MODE=synthetic",
    });
  }
};

/** Keys a signed-in (auth on) deployment cannot run without. */
const AUTH_ON_REQUIRED_KEYS = [
  "OPENROUTER_API_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "ARCJET_KEY",
] as const;

type AuthOnView = Readonly<
  Partial<Record<(typeof AUTH_ON_REQUIRED_KEYS)[number], string>>
>;

const checkAuthOnKeys = (env: AuthOnView, report: Report): void =>
  AUTH_ON_REQUIRED_KEYS.filter((key) => env[key] === undefined).forEach((key) =>
    report({ path: key, message: `${key} is required unless LOCAL_MVP/AUTH_DISABLED` }),
  );

type AuthOffView = Readonly<{
  NODE_ENV?: string;
  ALLOW_AUTH_DISABLED_IN_PRODUCTION: boolean;
}>;

/**
 * Auth off makes every caller the data owner. That is only acceptable on a
 * developer's own machine, so a production server refuses it unless someone
 * has explicitly said otherwise.
 */
const checkAuthOffOutsideDev = (env: AuthOffView, report: Report): void => {
  if (env.NODE_ENV === "production" && !env.ALLOW_AUTH_DISABLED_IN_PRODUCTION) {
    report({
      path: "AUTH_DISABLED",
      message:
        "LOCAL_MVP/AUTH_DISABLED is refused when NODE_ENV=production; turn auth on, or set ALLOW_AUTH_DISABLED_IN_PRODUCTION=true for a machine only you can reach",
    });
  }
};

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const POSTGRES_URL = /^postgres(ql)?:\/\//;

const serverEnvSchema = z
  .object({
    NODE_ENV: z.string().optional(),
    LOCAL_MVP: flag(),
    AUTH_DISABLED: flag(),
    ALLOW_AUTH_DISABLED_IN_PRODUCTION: blankableFlag(),
    LOCAL_ONLY: flag(),
    LOCAL_USER_ID: z.string().min(1).default("local"),
    DATABASE_URL: z
      .string({ message: "DATABASE_URL is required" })
      .min(1, "DATABASE_URL is required")
      .regex(
        POSTGRES_URL,
        "DATABASE_URL must be a postgres:// or postgresql:// connection string",
      ),

    CLERK_SECRET_KEY: maybeText(),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: maybeText(),
    NEXT_PUBLIC_POSTHOG_KEY: maybeText(),
    NEXT_PUBLIC_POSTHOG_HOST: maybeUrl(),
    ARCJET_KEY: z.preprocess(
      blankAsMissing,
      z
        .string()
        .regex(/^ajkey_/, "ARCJET_KEY must start with ajkey_")
        .optional(),
    ),

    LLM_PROVIDER: z.enum([
      "exoscale",
      "ollama",
      "openrouter",
      "remote-gpu",
      "infomaniak",
    ]),
    DATA_MODE: z.preprocess(
      (raw) => blankAsMissing(raw) ?? "personal",
      z.enum(["synthetic", "personal"], {
        message: "DATA_MODE must be synthetic or personal",
      }),
    ),
    OPENROUTER_API_KEY: maybeText(),
    OLLAMA_BASE_URL: maybeUrl(),
    OLLAMA_NUM_CTX: z.preprocess(
      blankAsMissing,
      z.coerce
        .number()
        .int("OLLAMA_NUM_CTX must be a whole number of tokens")
        .min(MIN_OLLAMA_NUM_CTX, `OLLAMA_NUM_CTX must be at least ${MIN_OLLAMA_NUM_CTX}`)
        .default(DEFAULT_OLLAMA_NUM_CTX),
    ),
    REMOTE_GPU_BASE_URLS: urlList(),
    REMOTE_GPU_API_KEY: maybeText(),
    EXOSCALE_BASE_URLS: urlList(),
    EXOSCALE_API_KEY: maybeText(),
    EXOSCALE_ALLOW_LOOPBACK_TUNNEL: blankableFlag(),
    EXOSCALE_PERSONAL_DATA: z.preprocess(
      (raw) => blankAsMissing(raw) ?? EXOSCALE_PERSONAL_DATA_SETTINGS[0],
      z.enum(EXOSCALE_PERSONAL_DATA_SETTINGS, {
        message: "EXOSCALE_PERSONAL_DATA must be off or consented-pilot",
      }),
    ),
    EXOSCALE_FIRST_BYTE_TIMEOUT_S: z.preprocess(
      blankAsMissing,
      z.coerce
        .number()
        .int("EXOSCALE_FIRST_BYTE_TIMEOUT_S must be a whole number of seconds")
        .positive("EXOSCALE_FIRST_BYTE_TIMEOUT_S must be above 0")
        .default(DEFAULT_FIRST_BYTE_TIMEOUT_S),
    ),
    INFOMANIAK_API_TOKEN: maybeText(),
    INFOMANIAK_PRODUCT_ID: maybeText(),
    INFOMANIAK_BASE_URL: maybeUrl(),

    GENOME_SOURCE: z.enum(["none", "ark"]).default("none"),
    ARK_DEVICE: maybeText(),
    ARK_RSID_GENOTYPES_WASM: maybeText(),
    GENOME_REFERENCE_DIR: maybeText(),
    GENOME_ASSUME_BUILD: z.preprocess(
      blankAsMissing,
      z
        .enum(["GRCh38"], {
          message:
            "GENOME_ASSUME_BUILD may only be GRCh38; leave it unset when the Ark reports its build",
        })
        .optional(),
    ),
    CARBON_X_URL: maybeUrl(),
    CARBON_X_TIMEOUT_S: z.preprocess(
      blankAsMissing,
      z.coerce
        .number()
        .int("CARBON_X_TIMEOUT_S must be a whole number of seconds")
        .positive("CARBON_X_TIMEOUT_S must be above 0")
        .default(DEFAULT_CARBON_X_TIMEOUT_S),
    ),
    GBD_MCP_URL: maybeUrl(),
    GBD_MCP_TOKEN: maybeText(),

    SYNTHEA_HOST: z.preprocess(
      blankAsMissing,
      z
        .string()
        .regex(
          HOSTNAME,
          "SYNTHEA_HOST must be a host name such as synthea.opening.science",
        )
        .transform((host) => host.toLowerCase())
        .default(DEFAULT_SYNTHEA_HOST),
    ),
    SYNTHEA_MAX_PEOPLE: wholeNumberIn("SYNTHEA_MAX_PEOPLE", 1, 1000, 50),
    SYNTHEA_JOB_TIMEOUT_S: wholeNumberIn("SYNTHEA_JOB_TIMEOUT_S", 10, 1800, 180),
    SYNTHEA_JOBS_PER_HOUR: wholeNumberIn("SYNTHEA_JOBS_PER_HOUR", 1, 1000, 12),
    SYNTHEA_QUEUE_MAX: wholeNumberIn("SYNTHEA_QUEUE_MAX", 1, 100, 5),
    SYNTHEA_JAR: maybeText(),
    SYNTHEA_JAVA: maybeText(),

    OURA_CLIENT_ID: maybeText(),
    OURA_CLIENT_SECRET: maybeText(),
    OURA_REDIRECT_URI: maybeUrl(),
    OURA_TOKEN_ENCRYPTION_KEY: hexKey("OURA_TOKEN_ENCRYPTION_KEY"),
    WHOOP_CLIENT_ID: maybeText(),
    WHOOP_CLIENT_SECRET: maybeText(),
    WHOOP_REDIRECT_URI: maybeUrl(),
    WHOOP_TOKEN_ENCRYPTION_KEY: hexKey("WHOOP_TOKEN_ENCRYPTION_KEY"),
    GOOGLE_HEALTH_CLIENT_ID: maybeText(),
    GOOGLE_HEALTH_CLIENT_SECRET: maybeText(),
    GOOGLE_HEALTH_REDIRECT_URI: maybeUrl(),
    GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY: hexKey("GOOGLE_HEALTH_TOKEN_ENCRYPTION_KEY"),
    VITRONIC_TOKEN_ENCRYPTION_KEY: hexKey("VITRONIC_TOKEN_ENCRYPTION_KEY"),
    VITRONIC_DATA_DIR: maybeText(),
    VITRONIC_SCANNER_HOSTS: maybeText(),
    ANATOMY_DATA_DIR: maybeText(),
    TWINLLM_STATE_DIR: z.preprocess(
      blankAsMissing,
      z.string().regex(/^\//, "TWINLLM_STATE_DIR must be an absolute path").optional(),
    ),
    XDG_DATA_HOME: maybeText(),
    VAULT_IDLE_LOCK_MINUTES: wholeNumberIn("VAULT_IDLE_LOCK_MINUTES", 1, 240, 15),
  })
  .superRefine((env, ctx) => {
    const report: Report = ({ path, message }) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    const authOff = env.LOCAL_MVP || env.AUTH_DISABLED;

    if (authOff) {
      checkAuthOffOutsideDev(env, report);
    } else {
      checkAuthOnKeys(env, report);
    }
    if (env.LOCAL_ONLY) checkLocalOnly(env, authOff, report);
    checkRemoteGpu(env, report);
    checkExoscale(env, report);

    // Carbon-X reads genotypes, so it may only ever be the sidecar on this machine.
    if (env.CARBON_X_URL !== undefined && !isLoopbackUrl(env.CARBON_X_URL)) {
      report({
        path: "CARBON_X_URL",
        message:
          "CARBON_X_URL must be on this machine (localhost, 127.0.0.1 or [::1]); genotypes never leave it",
      });
    }

    if (env.LLM_PROVIDER === "openrouter") {
      if (env.DATA_MODE === "personal") {
        report({
          path: "LLM_PROVIDER",
          message:
            "DATA_MODE=personal forbids LLM_PROVIDER=openrouter; use ollama, or exoscale with EXOSCALE_PERSONAL_DATA=consented-pilot",
        });
      }
      if (env.OPENROUTER_API_KEY === undefined) {
        report({
          path: "OPENROUTER_API_KEY",
          message: "OPENROUTER_API_KEY is required when LLM_PROVIDER=openrouter",
        });
      }
    }

    if (env.LLM_PROVIDER === "infomaniak" && env.DATA_MODE === "personal") {
      report({
        path: "LLM_PROVIDER",
        message:
          "DATA_MODE=personal forbids LLM_PROVIDER=infomaniak; Infomaniak is a third-party service and gets synthetic data only. Use local Ollama (LOCAL_ONLY=true) or set DATA_MODE=synthetic",
      });
    }

    // Legacy Infomaniak: an auth-off demo may boot without its tokens and only
    // fails when a chat actually resolves the model.
    if (env.LLM_PROVIDER === "infomaniak" && !authOff) {
      (["INFOMANIAK_API_TOKEN", "INFOMANIAK_PRODUCT_ID"] as const)
        .filter((key) => env[key] === undefined)
        .forEach((key) =>
          report({
            path: key,
            message: `${key} is required when LLM_PROVIDER=infomaniak`,
          }),
        );
    }
  });

export type ServerEnv = Readonly<z.infer<typeof serverEnvSchema>>;

// ---------------------------------------------------------------------------
// Parsing and the process-wide cached value
// ---------------------------------------------------------------------------

/**
 * No LLM_PROVIDER means ollama with LOCAL_ONLY=true and exoscale otherwise.
 * There is no quiet fallback: exoscale without EXOSCALE_BASE_URLS fails startup.
 */
export const applyLocalOnlyDefaults = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  if (source.LLM_PROVIDER?.trim()) return source;
  const fallback = source.LOCAL_ONLY === "true" ? "ollama" : "exoscale";
  return { ...source, LLM_PROVIDER: fallback };
};

const describeIssues = (issues: readonly z.core.$ZodIssue[]): string =>
  issues
    .map(
      ({ path, message }) =>
        `  - ${path.length > 0 ? path.join(".") : "(root)"}: ${message}`,
    )
    .join("\n");

/** Validates a raw environment; exported so tests can pass synthetic sources. */
export const parseServerEnv = (source: NodeJS.ProcessEnv): ServerEnv => {
  const parsed = serverEnvSchema.safeParse(applyLocalOnlyDefaults(source));
  if (parsed.success) return Object.freeze(parsed.data);

  const hint = "Copy .env.example to .env.local and fill in the missing values.";
  throw new Error(
    [
      "Invalid environment variables:",
      describeIssues(parsed.error.issues),
      "",
      hint,
    ].join("\n"),
  );
};

const envCache: { value: ServerEnv | null } = { value: null };

/** Parses `process.env` on first call, then returns the same frozen object. */
export const serverEnv = (): ServerEnv => {
  envCache.value ??= parseServerEnv(process.env);
  return envCache.value;
};

export const resetServerEnvCacheForTests = (): void => {
  envCache.value = null;
};

// ---------------------------------------------------------------------------
// Small accessors
// ---------------------------------------------------------------------------

/**
 * True when a key is present in the raw environment but carries nothing usable:
 * blank, or a value that starts with `#` (a pasted example comment). The parsed
 * env already treats both as unset; this tells "you wrote the line but it's
 * empty" apart from "the line is missing". Returns a boolean, never the value.
 */
export const envValueLooksEmpty = (source: NodeJS.ProcessEnv, name: string): boolean => {
  const trimmed = source[name]?.trim();
  return trimmed !== undefined && (trimmed.length === 0 || trimmed.startsWith("#"));
};

/** Dev-only hint for the Connectors setup list; always false in production. */
export const envLooksEmpty = (name: string): boolean =>
  process.env.NODE_ENV !== "production" && envValueLooksEmpty(process.env, name);

export const isLocalOnly = (): boolean => serverEnv().LOCAL_ONLY;

export const isAuthDisabled = (): boolean => {
  const { AUTH_DISABLED, LOCAL_MVP } = serverEnv();
  return AUTH_DISABLED || LOCAL_MVP;
};

export const infomaniakOpenAiBaseUrl = (env: ServerEnv): string | null =>
  env.INFOMANIAK_BASE_URL ??
  (env.INFOMANIAK_PRODUCT_ID === undefined
    ? null
    : `https://api.infomaniak.com/2/ai/${env.INFOMANIAK_PRODUCT_ID}/openai/v1`);

export type AnalyticsEnv = Readonly<{
  key: string;
  /** Ingestion host; the EU region unless NEXT_PUBLIC_POSTHOG_HOST says otherwise. */
  host: string;
}>;

/** PostHog settings, or null when no key is configured (the usual case). */
export const analyticsEnv = (env: ServerEnv = serverEnv()): AnalyticsEnv | null =>
  env.NEXT_PUBLIC_POSTHOG_KEY === undefined
    ? null
    : Object.freeze({
        key: env.NEXT_PUBLIC_POSTHOG_KEY,
        host: env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
      });

export type RemoteGpuEnv = Readonly<{
  /** Loopback `.../v1` URLs, one per tunnelled vLLM port, in the order given. */
  baseUrls: readonly string[];
  /** vLLM `--api-key`, when the server was started with one. Never logged. */
  apiKey: string | null;
}>;

export const remoteGpuEnv = (): RemoteGpuEnv => {
  const { REMOTE_GPU_BASE_URLS, REMOTE_GPU_API_KEY } = serverEnv();
  return Object.freeze({
    baseUrls: REMOTE_GPU_BASE_URLS,
    apiKey: REMOTE_GPU_API_KEY ?? null,
  });
};

export type ExoscaleEnv = Readonly<{
  /** `.../v1` URLs, one per vLLM server (one per GPU), in the order given. */
  baseUrls: readonly string[];
  /** vLLM `--api-key`, when the servers were started with one. Never logged. */
  apiKey: string | null;
  /** Abort a call whose answer has not started after this long; never retried. */
  firstByteTimeoutMs: number;
}>;

export const exoscaleEnv = (): ExoscaleEnv => {
  const env = serverEnv();
  return Object.freeze({
    baseUrls: env.EXOSCALE_BASE_URLS,
    apiKey: env.EXOSCALE_API_KEY ?? null,
    firstByteTimeoutMs: env.EXOSCALE_FIRST_BYTE_TIMEOUT_S * 1000,
  });
};

/**
 * Whether personal requests may go to Exoscale: `consented-pilot` only for a
 * pilot whose participants consented, `off` (the default) otherwise.
 */
export const exoscalePersonalData = (
  env: ServerEnv = serverEnv(),
): ExoscalePersonalData => env.EXOSCALE_PERSONAL_DATA;

/** The four settings every OAuth wearable needs before it can be offered. */
type OAuthAppEnv = Readonly<{
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
}>;

export type OuraEnv = OAuthAppEnv;
export type WhoopEnv = OAuthAppEnv;
export type GoogleHealthEnv = OAuthAppEnv;

type OAuthPrefix = "OURA" | "WHOOP" | "GOOGLE_HEALTH";

/** All four values for one vendor, or null when any is missing. */
const oauthAppEnv = (prefix: OAuthPrefix): OAuthAppEnv | null => {
  const env = serverEnv();
  const clientId = env[`${prefix}_CLIENT_ID`];
  const clientSecret = env[`${prefix}_CLIENT_SECRET`];
  const redirectUri = env[`${prefix}_REDIRECT_URI`];
  const encryptionKey = env[`${prefix}_TOKEN_ENCRYPTION_KEY`];
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) return null;
  return Object.freeze({ clientId, clientSecret, redirectUri, encryptionKey });
};

export const ouraEnv = (): OuraEnv | null => oauthAppEnv("OURA");

export const whoopEnv = (): WhoopEnv | null => oauthAppEnv("WHOOP");

export const googleHealthEnv = (): GoogleHealthEnv | null => oauthAppEnv("GOOGLE_HEALTH");

export type GbdEnv = Readonly<{
  url: string;
  token: string;
}>;

export const gbdEnv = (): GbdEnv | null => {
  const { GBD_MCP_URL: url, GBD_MCP_TOKEN: token } = serverEnv();
  return url && token ? Object.freeze({ url, token }) : null;
};

export type VitronicEnv = Readonly<{
  encryptionKey: string;
  dataDir: string | null;
}>;

export const vitronicEnv = (): VitronicEnv | null => {
  const { VITRONIC_TOKEN_ENCRYPTION_KEY: encryptionKey, VITRONIC_DATA_DIR } = serverEnv();
  return encryptionKey
    ? Object.freeze({ encryptionKey, dataDir: VITRONIC_DATA_DIR ?? null })
    : null;
};

/** Raw comma-separated BodyLoop scanner host allowlist; parsed in packages/vitronic/base-url.ts. */
export const vitronicScannerHosts = (): string | null =>
  serverEnv().VITRONIC_SCANNER_HOSTS ?? null;

export type StorageEnv = Readonly<{
  dataMode: ServerEnv["DATA_MODE"];
  /** TWINLLM_STATE_DIR, or the platform default (docs/privacy-design.md, "State directory"). */
  stateDir: string;
  /** Where BodyLoop mesh files go: VITRONIC_DATA_DIR, else `data/vitronic` in the repository. */
  vitronicDir: string;
  databaseUrl: string;
}>;

/** What the owner-only storage check (#144) looks at; `cwd` is the repository root. */
export const storageEnv = (
  env: ServerEnv = serverEnv(),
  cwd: string = process.cwd(),
): StorageEnv =>
  Object.freeze({
    dataMode: env.DATA_MODE,
    stateDir:
      env.TWINLLM_STATE_DIR ??
      defaultStateDir({
        platform: process.platform === "darwin" ? "darwin" : "linux",
        home: homedir(),
        xdgDataHome: env.XDG_DATA_HOME,
      }),
    vitronicDir: resolvePath(
      /* turbopackIgnore: true */ cwd,
      env.VITRONIC_DATA_DIR ?? "data/vitronic",
    ),
    databaseUrl: env.DATABASE_URL,
  });

export type VaultEnv = Readonly<{
  dataMode: ServerEnv["DATA_MODE"];
  /** Where the wrapped data keys live (`<stateDir>/vault`), owner-only (#144). */
  stateDir: string;
  /** VAULT_IDLE_LOCK_MINUTES in milliseconds (default 15 minutes, #142). */
  idleLockMs: number;
}>;

/** The settings of the local unlock (#142, docs/privacy-design.md section 2.2). */
export const vaultEnv = (env: ServerEnv = serverEnv()): VaultEnv =>
  Object.freeze({
    dataMode: env.DATA_MODE,
    stateDir: storageEnv(env).stateDir,
    idleLockMs: env.VAULT_IDLE_LOCK_MINUTES * 60_000,
  });

export type AnatomyEnv = Readonly<{
  /** Where `bun run anatomy:fetch` put the atlas GLBs; null means data/anatomy. */
  dataDir: string | null;
}>;

export const anatomyEnv = (): AnatomyEnv =>
  Object.freeze({ dataDir: serverEnv().ANATOMY_DATA_DIR ?? null });

export type GenomeEnv = Readonly<{
  source: "none" | "ark";
  /** Where the rsid-genotypes WASI module was built; null means the repo default. */
  rsidGenotypesWasm: string | null;
  /** Local GRCh38 FASTA folder (per-chromosome .fa or .fa.gz); null when not set up. */
  referenceDir: string | null;
  /** The owner's statement that the calls are GRCh38, used when the Ark names no build. */
  assumeBuild: "GRCh38" | null;
  /** Carbon-X's OpenAI-compatible `/v1` root; always loopback (checked at startup). */
  carbonXUrl: string;
  carbonXTimeoutMs: number;
}>;

export const genomeEnv = (env: ServerEnv = serverEnv()): GenomeEnv =>
  Object.freeze({
    source: env.GENOME_SOURCE,
    rsidGenotypesWasm: env.ARK_RSID_GENOTYPES_WASM ?? null,
    referenceDir: env.GENOME_REFERENCE_DIR ?? null,
    assumeBuild: env.GENOME_ASSUME_BUILD ?? null,
    carbonXUrl: env.CARBON_X_URL ?? DEFAULT_CARBON_X_URL,
    carbonXTimeoutMs: env.CARBON_X_TIMEOUT_S * 1000,
  });

export type SyntheaEnv = Readonly<{
  /** Requests for this host see only the generator (`proxy.ts`). */
  host: string;
  maxPeople: number;
  jobTimeoutMs: number;
  jobsPerHour: number;
  queueMax: number;
  /** The pinned Synthea JAR; null means `.synthea/cache/` in the working directory. */
  jarPath: string | null;
  /** The Java binary; `java` from PATH when unset. */
  javaBin: string;
  /** PATH for the Java process, which gets no other server variable. */
  childPath: string;
}>;

export const syntheaEnv = (env: ServerEnv = serverEnv()): SyntheaEnv =>
  Object.freeze({
    host: env.SYNTHEA_HOST,
    maxPeople: env.SYNTHEA_MAX_PEOPLE,
    jobTimeoutMs: env.SYNTHEA_JOB_TIMEOUT_S * 1000,
    jobsPerHour: env.SYNTHEA_JOBS_PER_HOUR,
    queueMax: env.SYNTHEA_QUEUE_MAX,
    jarPath: env.SYNTHEA_JAR ?? null,
    javaBin: env.SYNTHEA_JAVA ?? "java",
    childPath: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  });

export type BuildInfo = Readonly<{
  /** `version` from package.json when the app was built. */
  appVersion: string | null;
  /** `git rev-parse HEAD` when the app was built; null outside a git checkout. */
  commit: string | null;
  /** True when the build's working tree had changes not in that commit; null when git could not say. */
  dirty: boolean | null;
  /** The open-twin pin in PROVENANCE.md when the app was built. */
  openTwinPinned: string | null;
  /** `.open-twin/OPEN_TWIN_SHA` when the app was built. */
  openTwinFound: string | null;
  /**
   * "dev" under `next dev`, which serves edits as they are saved, so nothing
   * recorded at startup describes the code it runs.
   */
  mode: "build" | "dev";
}>;

/**
 * What `next.config.ts` wrote in at build time (its `env` block). Next
 * replaces these names with the values while it compiles, so they hold in
 * `next start` without being set on the server.
 */
export const buildInfo = (): BuildInfo =>
  Object.freeze({
    appVersion: process.env.TWINLLM_APP_VERSION || null,
    commit: process.env.TWINLLM_BUILD_COMMIT || null,
    dirty: parseDirtyFlag(process.env.TWINLLM_BUILD_DIRTY),
    openTwinPinned: process.env.TWINLLM_BUILD_OPEN_TWIN_PIN || null,
    openTwinFound: process.env.TWINLLM_BUILD_OPEN_TWIN_CHECKOUT || null,
    mode: process.env.NODE_ENV === "development" ? "dev" : "build",
  });
