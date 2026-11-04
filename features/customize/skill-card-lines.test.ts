import { describe, expect, test } from "bun:test";

import {
  OWN_SKILL_META,
  providerLine,
  skillCardMeta,
  skillHref,
  toolsText,
} from "./skill-card-lines";

describe("skill card lines", () => {
  test("counts the tools in words", () => {
    expect(toolsText(0)).toBe("no tools");
    expect(toolsText(1)).toBe("1 tool");
    expect(toolsText(3)).toBe("3 tools");
  });

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

  test("own skills carry the palette's words", () => {
    expect(OWN_SKILL_META).toBe("Yours · not evaluated");
  });

  test("a card opens the skill's page under Customize", () => {
    expect(skillHref("sleep")).toBe("/customize/skills/sleep");
    expect(skillHref("ckx1")).toBe("/customize/skills/ckx1");
  });
});
