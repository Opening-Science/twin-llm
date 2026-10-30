import { describe, expect, test } from "bun:test";

import { parseSimulationForm } from "./simulation-request";

describe("parseSimulationForm", () => {
  test("no subject yet: defaults in the form and nothing to run", () => {
    expect(parseSimulationForm({})).toEqual({
      values: { subject: "", date: "", seconds: "300", recording: "1" },
      errors: {},
      request: null,
    });
  });

  test("a full request, with an empty date meaning the last day", () => {
    expect(
      parseSimulationForm({ subject: "abc-123", date: "", seconds: "30", recording: "7" })
        .request,
    ).toEqual({ subjectRef: "abc-123", date: null, durationSec: 30, recording: 7 });
    expect(
      parseSimulationForm({ subject: "abc-123", date: "2025-06-01", seconds: "600" })
        .request,
    ).toEqual({
      subjectRef: "abc-123",
      date: "2025-06-01",
      durationSec: 600,
      recording: 1,
    });
  });

  test("takes the first of repeated parameters", () => {
    expect(parseSimulationForm({ subject: ["a1", "b2"] }).values.subject).toBe("a1");
  });

  test("out-of-range and malformed fields get a sentence and no request", () => {
    const form = parseSimulationForm({
      subject: "x y",
      date: "2025-02-31",
      seconds: "29",
      recording: "1001",
    });
    expect(form.request).toBeNull();
    expect(form.errors).toEqual({
      subject: "Choose a person from the list.",
      date: "Use a date such as 2025-06-01, or leave it empty.",
      seconds: "A whole number of seconds from 30 to 600.",
      recording: "A whole number from 1 to 1000.",
    });
    expect(parseSimulationForm({ subject: "a", seconds: "12.5" }).errors).toEqual({
      seconds: "A whole number of seconds from 30 to 600.",
    });
  });
});
