import { describe, expect, test } from "bun:test";

import fixture from "./fixtures/tools-list.json";

describe("GBD tools/list fixture", () => {
  test("placeholder snapshot matches the committed fixture", () => {
    expect(fixture._note).toBe("placeholder — replace with live tools/list");
    expect(fixture).toEqual({
      _note: "placeholder — replace with live tools/list",
      tools: [
        {
          name: "gbd_query",
          description: "Query IHME GBD population estimates.",
          inputSchema: {
            type: "object",
            properties: {
              question: { type: "string" },
            },
            required: ["question"],
          },
        },
      ],
    });
  });
});
