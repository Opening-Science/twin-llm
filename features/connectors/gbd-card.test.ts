import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GBD_PENDING_NOTE, GbdCard, type GbdStatusPayload } from "./gbd-card";
import { emptySetup } from "./fixtures/setup-fixture";

const html = (preview: GbdStatusPayload | "failed") =>
  renderToStaticMarkup(createElement(GbdCard, { preview, setup: emptySetup("gbd") }));

describe("GbdCard", () => {
  test("not configured says IHME's connection is pending, with no portal link", () => {
    const markup = html({ configured: false });
    expect(markup).toContain("GBD");
    expect(markup).toContain("Not configured");
    expect(markup).toContain("Not a statement about a person.");
    expect(markup).toContain(GBD_PENDING_NOTE);
    expect(GBD_PENDING_NOTE).toBe(
      "IHME’s GBD 2023 server is not yet open to other clients. TwinLLM’s connection is pending IHME’s OK.",
    );
    expect(markup).not.toContain("collaborator");
    expect(markup).not.toContain("question");
  });

  test("lists the GBD env names in Setup", () => {
    const markup = html({ configured: false });
    expect(markup).toContain('<code class="setup-code">GBD_MCP_URL</code>');
    expect(markup).toContain('<code class="setup-code">GBD_MCP_TOKEN</code>');
  });

  test("renders connected tool names only", () => {
    const markup = html({ configured: true, state: "ok", tools: ["gbd_query"] });
    expect(markup).toContain("Connected");
    expect(markup).toContain("gbd_query");
    expect(markup).not.toContain(GBD_PENDING_NOTE);
  });

  test("an unreachable server is an Error with a plain sentence", () => {
    const markup = html({ configured: true, state: "error" });
    expect(markup).toContain(">Error<");
    expect(markup).toContain("The GBD server didn’t answer. Try again later.");
  });
});

describe("GbdCard status badge", () => {
  test("pairs each state's words with its tone", () => {
    expect(html({ configured: false })).toContain('data-tone="off"');
    expect(html({ configured: true, state: "ok", tools: [] })).toContain(
      'data-tone="ok"',
    );
    expect(html({ configured: true, state: "error" })).toContain('data-tone="warn"');
  });
});

describe("GbdCard status request failure", () => {
  test("shows the Error badge and a plain sentence, not a skeleton", () => {
    const markup = html("failed");
    expect(markup).toContain('data-tone="warn"');
    expect(markup).toContain(">Error<");
    expect(markup).toContain(
      "Couldn’t read the GBD status. Reload the page to try again.",
    );
    expect(markup).not.toContain("Loading GBD status");
  });
});
