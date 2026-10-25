import { describe, expect, test } from "bun:test";

import { parseServerEnv } from "@/infrastructure/env";

import { connectorSetupView, connectorSetupViews, setupGap } from "./connector-setup";

// Synthetic values only. Each is unique so a leak into the view is easy to spot.
const BASE = {
  LOCAL_MVP: "true",
  AUTH_DISABLED: "true",
  LLM_PROVIDER: "ollama",
  DATABASE_URL: "postgresql://synthetic@localhost:1/none",
} as const;

const SECRET_VALUES = {
  OURA_CLIENT_ID: "synthetic-oura-client",
  OURA_CLIENT_SECRET: "synthetic-oura-secret",
  OURA_REDIRECT_URI: "http://localhost:8787/callback",
  OURA_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  WHOOP_CLIENT_ID: "synthetic-whoop-client",
  WHOOP_REDIRECT_URI: "https://localhost:9999/elsewhere",
  GBD_MCP_URL: "https://gbd.example.invalid/mcp",
  GBD_MCP_TOKEN: "synthetic-gbd-token",
} as const;

const env = parseServerEnv({ ...BASE, ...SECRET_VALUES });
const nothingEmpty = () => false;

describe("connectorSetupView", () => {
  test("Oura lists its exact env names, all set, and a matching redirect", () => {
    expect(connectorSetupView("oura", env, nothingEmpty)).toEqual({
      checks: [
        { name: "OURA_CLIENT_ID", optional: false, set: true, looksEmpty: false },
        { name: "OURA_CLIENT_SECRET", optional: false, set: true, looksEmpty: false },
        { name: "OURA_REDIRECT_URI", optional: false, set: true, looksEmpty: false },
        {
          name: "OURA_TOKEN_ENCRYPTION_KEY",
          optional: false,
          set: true,
          looksEmpty: false,
        },
      ],
      redirectUri: "http://localhost:8787/callback",
      redirectMatches: true,
      steps: [
        {
          text: "Make the token encryption key (64 hex characters) with",
          command: "openssl rand -hex 32",
        },
        {
          text: "Keep the local redirect proxy running while you link",
          command: "bun run oura:proxy",
        },
        {
          text: "Open TwinLLM at http://localhost:3000 (not 127.0.0.1) before linking, so the sign-in return finds this browser session.",
        },
      ],
      doc: "https://github.com/Opening-Science/twin-llm/blob/main/docs/connectors.md#oura",
    });
  });

  test("Whoop reports what is missing and a redirect that differs", () => {
    const view = connectorSetupView("whoop", env, nothingEmpty);
    expect(view.checks.map((check) => [check.name, check.set])).toEqual([
      ["WHOOP_CLIENT_ID", true],
      ["WHOOP_CLIENT_SECRET", false],
      ["WHOOP_REDIRECT_URI", true],
      ["WHOOP_TOKEN_ENCRYPTION_KEY", false],
    ]);
    expect(view.redirectUri).toBe("https://localhost:8788/api/whoop/callback");
    expect(view.redirectMatches).toBe(false);
    expect(view.steps.map((step) => step.command ?? null)).toEqual([
      "openssl rand -hex 32",
      "mkcert -cert-file certificates/localhost.pem -key-file certificates/localhost-key.pem localhost",
      "bun run whoop:proxy",
      null,
      null,
    ]);
  });

  test("an unset redirect has no match verdict", () => {
    const view = connectorSetupView("google-health", env, nothingEmpty);
    expect(view.redirectUri).toBe("http://localhost:3000/api/google-health/callback");
    expect(view.redirectMatches).toBeNull();
    expect(view.checks.every((check) => !check.set)).toBe(true);
  });

  test("a line that looks empty is flagged and never counts as set", () => {
    const looksEmpty = (name: string) => name === "OURA_CLIENT_SECRET";
    const view = connectorSetupView("oura", env, looksEmpty);
    expect(view.checks[1]).toEqual({
      name: "OURA_CLIENT_SECRET",
      optional: false,
      set: false,
      looksEmpty: true,
    });
  });

  test("BodyLoop, GBD, guidelines and Ark list their exact names", () => {
    const names = (id: Parameters<typeof connectorSetupView>[0]) =>
      connectorSetupView(id, env, nothingEmpty).checks.map((check) => [
        check.name,
        check.optional,
        check.set,
      ]);
    expect(names("bodyloop")).toEqual([
      ["VITRONIC_TOKEN_ENCRYPTION_KEY", false, false],
      ["VITRONIC_DATA_DIR", true, false],
    ]);
    expect(names("gbd")).toEqual([
      ["GBD_MCP_URL", false, true],
      ["GBD_MCP_TOKEN", false, true],
    ]);
    expect(names("guidelines")).toEqual([]);
    expect(names("ark")).toEqual([
      ["GENOME_SOURCE", false, false],
      ["ARK_DEVICE", true, false],
    ]);
  });

  test("GENOME_SOURCE counts as set only when it is ark", () => {
    const ark = parseServerEnv({ ...BASE, GENOME_SOURCE: "ark" });
    expect(connectorSetupView("ark", ark, nothingEmpty).checks[0]?.set).toBe(true);
  });
});

describe("connectorSetupViews", () => {
  test("never carries a value, only names, booleans and fixed defaults", () => {
    const serialized = JSON.stringify(connectorSetupViews(env, nothingEmpty));
    for (const [name, value] of Object.entries(SECRET_VALUES)) {
      if (name === "OURA_REDIRECT_URI") continue; // equals the public default
      expect(serialized).not.toContain(value);
    }
  });
});

describe("setupGap", () => {
  test("says how many required names are missing or look empty", () => {
    expect(setupGap(connectorSetupView("google-health", env, nothingEmpty))).toBe(
      "4 env values missing. See Setup.",
    );
    expect(
      setupGap(
        connectorSetupView("whoop", env, (name) => name === "WHOOP_CLIENT_SECRET"),
      ),
    ).toBe("1 env value missing, 1 env value looks empty. See Setup.");
    expect(setupGap(connectorSetupView("oura", env, nothingEmpty))).toBeNull();
    expect(setupGap(connectorSetupView("guidelines", env, nothingEmpty))).toBeNull();
  });
});
