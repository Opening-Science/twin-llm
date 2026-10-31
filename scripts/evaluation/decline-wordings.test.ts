import { describe, expect, test } from "bun:test";

import { DECLINE_RULE } from "../../features/chat/twin-system-prompt";
import { sha256Hex } from "../../packages/audit/hash";

import {
  DECLINE_WORDING_IDS,
  DECLINE_WORDINGS,
  declineWordingMeta,
  isDeclineWordingId,
} from "./decline-wordings";

describe("decline wordings (#274)", () => {
  test("w1 is the chat route's line and the three texts differ", () => {
    expect(DECLINE_WORDINGS.w1).toBe(DECLINE_RULE);
    expect(new Set(DECLINE_WORDING_IDS.map((id) => DECLINE_WORDINGS[id])).size).toBe(3);
  });

  test("every wording asks for REFUSE: and says what is still answered", () => {
    DECLINE_WORDING_IDS.forEach((id) => {
      expect(DECLINE_WORDINGS[id]).toContain("REFUSE:");
      expect(DECLINE_WORDINGS[id]).toMatch(/record/);
      expect(DECLINE_WORDINGS[id]).not.toContain("—");
    });
    expect(DECLINE_WORDINGS.w3).toContain("what a metric's value is");
  });

  test("ids are checked and meta names the exact text", () => {
    expect(isDeclineWordingId("w3")).toBe(true);
    expect(isDeclineWordingId("w4")).toBe(false);
    expect(declineWordingMeta("w2")).toEqual({
      id: "w2",
      sha256: sha256Hex(DECLINE_WORDINGS.w2),
    });
  });
});
