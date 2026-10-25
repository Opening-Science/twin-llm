import { describe, expect, test } from "bun:test";

import { parseInfomaniakModels } from "./model-catalog";

describe("parseInfomaniakModels", () => {
  test("keeps server order and marks the 128K window as a placeholder", () => {
    const models = parseInfomaniakModels({
      object: "list",
      data: [{ id: "synthetic-zeta" }, { id: "synthetic-alpha" }],
    });
    expect(
      models?.map((model) => [model.id, model.contextTokens, model.contextUnknown]),
    ).toEqual([
      ["synthetic-zeta", 128_000, true],
      ["synthetic-alpha", 128_000, true],
    ]);
  });
});
