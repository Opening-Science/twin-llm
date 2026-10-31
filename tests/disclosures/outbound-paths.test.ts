import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, test } from "bun:test";

/**
 * Every place the app can send something off this machine, and how it goes
 * through the disclosure ledger (#140, docs/privacy-design.md 2.5). Kept by
 * hand, like `tests/personal-reads`: the walk below finds every file under
 * app/, features/, infrastructure/ and packages/ that uses an outbound
 * client (a fetch to an absolute address, a model provider, a vendor SDK,
 * PostHog, Arcjet, Clerk, an MCP client, raw sockets or a child process) and
 * fails on any this table does not name.
 *
 * - `ledger`: the file sends, and `marker` (in the file itself, or in `via`
 *   when the send is started from there) is where the ledger row is written
 *   before the send. `tests` is the file that runs the path with a failing
 *   ledger and checks nothing was sent.
 * - `exempt`: why nothing about the person leaves here.
 *
 * Scripts are listed apart (`SCRIPTS`): they run by hand, outside the app.
 */

type Entry =
  | Readonly<{ ledger: Readonly<{ marker: string; via?: string; tests: string }> }>
  | Readonly<{ exempt: string }>;

const CLERK =
  "Clerk sign-in, only when sign-in is on: session checks, no health data. Not itemised in the ledger; the Lab card lists it as a channel outside the ledger when configured";
const ARCJET =
  "Arcjet request protection, only with ARCJET_KEY: request metadata (address, headers, path), no body. Not itemised; listed on the Lab card when configured";
const BROWSER_POSTHOG =
  "PostHog in the browser, only with NEXT_PUBLIC_POSTHOG_BROWSER=true: pageviews with thread ids removed and all text masked. The browser sends it, so the server cannot record it first; listed on the Lab card when configured";
const SAME_ORIGIN =
  "a browser component or hook calling this app's own /api routes (checked: client code with no absolute address)";
const MODEL_LIST =
  "a GET of a provider's model list: the operator's API key and nothing about the person";
const TYPES_ONLY = "types or pure helpers from the package; it sends nothing";
const VENDOR_SYNC = {
  marker: "await disclose();",
  via: "features/wearables/audited-sync.ts",
  tests: "features/wearables/audited-sync.test.ts",
} as const;
const HOSTED_MODEL = {
  marker: "modelCallFetch(",
  via: "features/chat/resolve-language-model.ts",
  tests: "tests/disclosures/hosted-model-ledger.test.ts",
} as const;

const OUTBOUND: Readonly<Record<string, Entry>> = {
  // Model providers: every request to a model not on this machine.
  "features/chat/resolve-language-model.ts": { ledger: HOSTED_MODEL },
  "features/chat/openrouter.ts": {
    ledger: { ...HOSTED_MODEL, marker: "fetch: fetchFn", via: undefined },
  },
  "features/chat/ollama-chat-model.ts": {
    ledger: { ...HOSTED_MODEL, marker: "fetch: config.fetch", via: undefined },
  },
  "infrastructure/first-byte-timeout-fetch.ts": {
    ledger: { ...HOSTED_MODEL, marker: "fetch: sendFetch" },
  },
  "infrastructure/disclosure-ledger.ts": {
    ledger: {
      marker: "await record(bodyBytes(init?.body));",
      tests: "infrastructure/disclosure-ledger.test.ts",
    },
  },
  "infrastructure/fetch-model-catalog.ts": { exempt: MODEL_LIST },
  "infrastructure/list-remote-gpu-models.ts": { exempt: MODEL_LIST },

  // Wearable vendors: syncs, token refresh, the OAuth code exchange.
  "features/oura/connection.ts": { ledger: VENDOR_SYNC },
  "features/whoop/connection.ts": { ledger: VENDOR_SYNC },
  "features/google-health/connection.ts": { ledger: VENDOR_SYNC },
  "infrastructure/open-twin-adapters/oura.ts": { ledger: VENDOR_SYNC },
  "infrastructure/open-twin-adapters/whoop.ts": { ledger: VENDOR_SYNC },
  "infrastructure/open-twin-adapters/whoop-workout.ts": { ledger: VENDOR_SYNC },
  "infrastructure/open-twin-adapters/google-health.ts": { ledger: VENDOR_SYNC },
  "infrastructure/open-twin-adapters/oura-bundle.ts": { exempt: TYPES_ONLY },
  "features/oura/summary.ts": { exempt: TYPES_ONLY },
  "features/oura/fixtures/synthetic-sync-data.ts": { exempt: TYPES_ONLY },
  "app/api/whoop/authorize/route.ts": {
    exempt:
      "builds the authorize redirect; the browser goes to Whoop, the server sends nothing",
  },

  // The remote GBD server (synthetic requests only).
  "packages/mcp-client/http-client.ts": {
    ledger: {
      marker: "gbdDisclosure(",
      via: "packages/gbd-mcp/tools.ts",
      tests: "packages/gbd-mcp/audit.test.ts",
    },
  },

  // Search embeddings: only an Ollama on another machine receives text.
  "packages/guidelines/embed.ts": {
    ledger: {
      marker: "fetch: ledgeredFetch(",
      tests: "packages/guidelines/embed-ledger.test.ts",
    },
  },

  // The Ark releases a report into this machine.
  "packages/ark-adapter/spawn.ts": {
    ledger: {
      marker: "arkReleaseDisclosure(",
      via: "features/digital-twin/genome-run.ts",
      tests: "features/digital-twin/genome-run.test.ts",
    },
  },

  // Telemetry.
  "infrastructure/posthog.ts": {
    ledger: {
      marker: "recordDisclosure(",
      via: "infrastructure/analytics-events.ts",
      tests: "infrastructure/disclosure-ledger.test.ts",
    },
  },
  "features/chat/stream-model-response.ts": {
    ledger: {
      marker: "await recordDisclosure(",
      tests: "infrastructure/disclosure-ledger.test.ts",
    },
  },
  "features/chat/generation-analytics.ts": { exempt: TYPES_ONLY },
  "features/analytics/analytics-privacy.ts": { exempt: BROWSER_POSTHOG },
  "features/analytics/posthog-provider.tsx": { exempt: BROWSER_POSTHOG },
  "features/shell/thread-bar.tsx": { exempt: BROWSER_POSTHOG },
  "infrastructure/arcjet.ts": { exempt: ARCJET },
  "infrastructure/protection-verdict.ts": { exempt: ARCJET },
  "features/chat/chat-protection.ts": { exempt: ARCJET },
  "features/threads/thread-protection.ts": { exempt: ARCJET },
  "infrastructure/auth-actor.ts": { exempt: CLERK },
  "proxy.ts": { exempt: CLERK },
  "app/layout.tsx": { exempt: CLERK },
  "app/(shell)/layout.tsx": { exempt: CLERK },
  "features/auth/app-auth.tsx": { exempt: CLERK },
  "features/shell/nav-panel.tsx": { exempt: CLERK },
  "features/arena/prompt-bar.tsx": { exempt: `${SAME_ORIGIN}; ${CLERK}` },

  // On this machine or the local network.
  "packages/carbon-x/client.ts": {
    exempt: "the DNA model sidecar, refused unless its address is loopback",
  },
  "packages/carbon-x/fake-carbon-x.ts": { exempt: "a test double on loopback" },
  "packages/vitronic/base-url.ts": {
    exempt:
      "the BodyLoop scanner on the local network: the request carries the pairing token and ids, the scan comes in. Not in the design's table (privacy-design 2.5)",
  },
  "packages/vitronic/tls.ts": {
    exempt:
      "the BodyLoop scanner's pinned TLS connection on the local network (see base-url.ts)",
  },
  "features/lab/run-lab-checks.ts": {
    exempt: "git on this machine and Ollama's model list (a GET, no data)",
  },
  "features/synthea/synthea-runner.ts": {
    exempt: "runs the Synthea jar on this machine; synthetic people only",
  },

  // The browser calling this app.
  "features/arena/suggestion-chips.tsx": { exempt: SAME_ORIGIN },
  "features/connectors/use-connector-status.ts": { exempt: SAME_ORIGIN },
  "features/personal-data/dataset-list.tsx": { exempt: SAME_ORIGIN },
  "features/personal-data/import-panel.tsx": { exempt: SAME_ORIGIN },
  "features/synthea/synthea-generator.tsx": { exempt: SAME_ORIGIN },
  "features/vault/vault-screen.tsx": { exempt: SAME_ORIGIN },
};

/** Scripts that reach the network, run by hand outside the app. */
const SCRIPTS: Readonly<Record<string, string>> = {
  "scripts/anatomy/fetch.ts": "downloads the public anatomy assets",
  "scripts/genome-synth/refresh-catalog.ts": "reads the public Ensembl catalogue",
  "scripts/literature/fetch.ts":
    "fetches open-access papers from PubMed Central with the fixed search terms in packages/literature; nothing about a person",
  "scripts/release/pinned-fetch.ts": "downloads pinned release artefacts",
  "scripts/setup/cohort-load.ts": "downloads the pinned synthetic cohort",
  "scripts/setup/detect.ts": "asks the local Ollama which models it has",
  "scripts/setup/prompt-size.ts":
    "counts tokens of a synthetic prompt on the local Ollama",
  "scripts/local-https-gateway.mjs": "a TLS gateway on loopback in front of the app",
  "scripts/oura-oauth-proxy.mjs": "a redirect proxy on localhost for the OAuth return",
  "scripts/whoop-oauth-proxy.mjs": "a redirect proxy on localhost for the OAuth return",
};

/**
 * The only callers that may pass `{ notRecorded }` to a model: they read
 * synthetic cohorts only and run against their own database.
 */
const NOT_RECORDED_CALLERS = [
  "features/chat/tool-calls.live.test.ts",
  "scripts/evaluation/run-eval.ts",
];

const ROOT = join(import.meta.dir, "../..");

const CLIENT_IMPORT =
  /from\s+["'](@ai-sdk\/openai|@openrouter\/ai-sdk-provider|ollama-ai-provider-v2|posthog-node|posthog-js|@posthog\/ai|@arcjet\/next|@clerk\/nextjs(?:\/[a-z]+)?|@googleapis\/health|googleapis|@modelcontextprotocol\/sdk\/client[^"']*|@open-twin\/provider-[a-z-]+|node:https?|node:net|node:tls|node:dgram|node:child_process|undici|ws)["']/;
const SCRIPT_CLIENT_IMPORT =
  /from\s+["'](@ai-sdk\/openai|@openrouter\/ai-sdk-provider|ollama-ai-provider-v2|posthog-node|@open-twin\/provider-[a-z-]+|node:https?|node:net|node:tls|undici)["']/;
/** A fetch to anything but a path on this app, or a fetch held in a port. */
const OUTBOUND_CALL =
  /(?<![\w.])fetch\(\s*(?!["'`]\/)|\.fetch\(|\b(?:doFetch|fetchFn)\(|new WebSocket\(|new EventSource\(/;

const sourceFiles = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((item) => {
    const path = join(ROOT, dir, item.name);
    if (item.isDirectory()) {
      return ["node_modules", "generated", ".next"].includes(item.name)
        ? []
        : sourceFiles(relative(ROOT, path));
    }
    return /\.(ts|tsx|mjs)$/.test(item.name) && !/\.test\.tsx?$/.test(item.name)
      ? [relative(ROOT, path).split(sep).join("/")]
      : [];
  });

const read = (file: string): string => readFileSync(join(ROOT, file), "utf8");

const reachesOut = (file: string, imports: RegExp): boolean => {
  const source = read(file);
  return imports.test(source) || OUTBOUND_CALL.test(source);
};

describe("every outbound path goes through the disclosure ledger (#140)", () => {
  test("every file of the app that can send off this machine is listed", () => {
    const found = [
      ...["app", "features", "infrastructure", "packages"].flatMap(sourceFiles),
      "proxy.ts",
      "instrumentation.ts",
    ]
      .filter((file) => reachesOut(file, CLIENT_IMPORT))
      .sort();
    expect(found).toEqual(Object.keys(OUTBOUND).sort());
  });

  test("every ledgered path writes its row where the table says, and is tested failing", () => {
    for (const [file, entry] of Object.entries(OUTBOUND)) {
      if (!("ledger" in entry)) continue;
      const { marker, via, tests } = entry.ledger;
      const where = via ?? file;
      expect([file, where, read(where).includes(marker)]).toEqual([file, where, true]);
      expect([file, tests, existsSync(join(ROOT, tests))]).toEqual([file, tests, true]);
    }
  });

  test("a same-origin entry is browser code with no absolute address", () => {
    for (const [file, entry] of Object.entries(OUTBOUND)) {
      if (!("exempt" in entry) || !entry.exempt.startsWith(SAME_ORIGIN)) continue;
      const source = read(file);
      const browser =
        /^["']use client["'];/m.test(source) || /from "react";/.test(source);
      expect([file, browser, /^import "server-only";/m.test(source)]).toEqual([
        file,
        true,
        false,
      ]);
      expect([file, /["'`]https?:\/\//.test(source)]).toEqual([file, false]);
    }
  });

  test("every script that reaches the network is listed with its reason", () => {
    const found = [...sourceFiles("scripts"), ...sourceFiles("evaluation")]
      .filter((file) => reachesOut(file, SCRIPT_CLIENT_IMPORT))
      .sort();
    expect(found).toEqual(Object.keys(SCRIPTS).sort());
  });

  test("only the listed callers skip the ledger for a model call", () => {
    const all = [
      ...[
        "app",
        "features",
        "infrastructure",
        "packages",
        "scripts",
        "evaluation",
      ].flatMap((dir) =>
        readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
          .filter((item) => item.isFile() && /\.(ts|tsx)$/.test(item.name))
          .map((item) =>
            relative(ROOT, join(item.parentPath, item.name)).split(sep).join("/"),
          )
          .filter((file) => !file.includes("node_modules"))
          // Unit tests build fake calls; a live test reaches real providers.
          .filter((file) => !file.endsWith(".test.ts") || file.endsWith(".live.test.ts")),
      ),
    ];
    const skipping = all
      .filter((file) => /disclosure: \{ notRecorded: /.test(read(file)))
      .sort();
    expect(skipping).toEqual(NOT_RECORDED_CALLERS);
  });

  test("every model call site passes what its requests carry", () => {
    const callers = [...["app", "features", "scripts"].flatMap(sourceFiles)]
      .filter((file) => file !== "features/chat/resolve-language-model.ts")
      .filter((file) => read(file).includes("resolveLanguageModel"))
      .sort();
    expect(callers).toEqual([
      "app/api/chat/incognito/route.ts",
      "app/api/memory/compact/route.ts",
      "app/api/onboarding/starters/route.ts",
      "features/chat/stream-model-response.ts",
      "features/onboarding/starter-generate.ts",
      "scripts/evaluation/run-eval.ts",
    ]);
    // The pipeline every chat answer goes through hands the model its disclosure.
    expect(read("features/chat/create-stream-model-response.ts")).toContain(
      "disclosure: chatDisclosure({",
    );
  });
});
