import { describe, expect, test } from "bun:test";

import { titleFor } from "./thread-title";

const published = { threadId: "f3a9c1", title: "Sleep and HRV" };

describe("titleFor", () => {
  test("the open thread's path gets its title", () => {
    expect(titleFor(published, "/t/f3a9c1")).toBe("Sleep and HRV");
  });

  test("another thread, or another page, gets nothing", () => {
    expect(titleFor(published, "/t/b7d2e0")).toBeUndefined();
    expect(titleFor(published, "/connectors")).toBeUndefined();
    expect(titleFor(published, "/t/f3a9c1/extra")).toBeUndefined();
  });

  test("nothing published gets nothing", () => {
    expect(titleFor(null, "/t/f3a9c1")).toBeUndefined();
  });
});
