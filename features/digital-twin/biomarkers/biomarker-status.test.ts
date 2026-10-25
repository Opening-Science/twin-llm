import { describe, expect, test } from "bun:test";

import { biomarkerStatus } from "./use-biomarker-tab";

const READY = {
  enabled: true,
  peopleLoaded: true,
  failed: false,
  valuesLoaded: true,
  metricsLoaded: true,
} as const;

describe("biomarkerStatus", () => {
  test("Demo waits for the people list, then the chosen person's values", () => {
    expect(biomarkerStatus({ ...READY, subject: "demo", peopleLoaded: false })).toBe(
      "loading",
    );
    expect(biomarkerStatus({ ...READY, subject: "demo", valuesLoaded: false })).toBe(
      "loading",
    );
    expect(biomarkerStatus({ ...READY, subject: "demo" })).toBe("ok");
  });

  test("a failed Demo read is failed, even while something else loads", () => {
    expect(
      biomarkerStatus({ ...READY, subject: "demo", failed: true, valuesLoaded: false }),
    ).toBe("failed");
  });

  test("Self waits for its metrics only", () => {
    expect(biomarkerStatus({ ...READY, subject: "self", metricsLoaded: false })).toBe(
      "loading",
    );
    expect(biomarkerStatus({ ...READY, subject: "self", peopleLoaded: false })).toBe(
      "ok",
    );
  });

  test("another subject and previews read nothing, so they are ok", () => {
    expect(biomarkerStatus({ ...READY, subject: "other", metricsLoaded: false })).toBe(
      "ok",
    );
    expect(
      biomarkerStatus({ ...READY, subject: "demo", enabled: false, peopleLoaded: false }),
    ).toBe("ok");
  });
});
