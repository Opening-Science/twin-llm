import { describe, expect, test } from "bun:test";

import { providerLine, skillCardMeta, skillHref } from "./skill-card-lines";

describe("skill card lines", () => {
  test("says where the model runs", () => {
    expect(providerLine(["ollama"])).toBe("runs on local models only");
    expect(providerLine(["ollama", "exoscale"])).toBe("runs on: ollama, exoscale");
  });

  test("joins the two on the meta line", () => {
    expect(
      skillCardMeta({ tools: ["sleep_summary", "sleep_trend"], providers: ["ollama"] }),
    ).toBe("2 tools · runs on local models only");
    expect(skillCardMeta({ tools: [], providers: ["ollama", "exoscale"] })).toBe(
      "no tools · runs on: ollama, exoscale",
    );
  });

  test("a card opens the skill's page under Customize", () => {
    expect(skillHref("sleep")).toBe("/customize/skills/sleep");
    expect(skillHref("ckx1")).toBe("/customize/skills/ckx1");
  });
});
