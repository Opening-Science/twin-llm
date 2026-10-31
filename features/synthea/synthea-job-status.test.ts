import { describe, expect, test } from "bun:test";

import { latticeStateOf } from "./synthea-job-status";

describe("latticeStateOf", () => {
  test("waiting and running work; finished runs tick; failures cross", () => {
    expect(latticeStateOf("queued")).toBe("working");
    expect(latticeStateOf("running")).toBe("working");
    expect(latticeStateOf("done")).toBe("done");
    expect(latticeStateOf("downloaded")).toBe("done");
    expect(latticeStateOf("expired")).toBe("done");
    expect(latticeStateOf("failed")).toBe("error");
    expect(latticeStateOf("timed-out")).toBe("error");
  });
});
