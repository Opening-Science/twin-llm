import { expect, test } from "bun:test";

test("bunfig preload stubs server-only, so importing it does not throw", async () => {
  const stub = await import("server-only");
  expect(Object.keys(stub)).toEqual([]);
});
