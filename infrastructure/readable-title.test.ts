import { describe, expect, test } from "bun:test";

import { readableTitle } from "./readable-title";

const REF = "29bbf012-3e7f-d6ab-a986-b5d9915f1900";

describe("readableTitle", () => {
  test("a leading subject_ref moves to a short tag at the end", () => {
    expect(readableTitle(`For subject_ref ${REF}: what is the latest systolic`)).toBe(
      "What is the latest systolic · subject 29bbf0",
    );
  });

  test("a chip prompt loses its LOINC and keeps the question", () => {
    expect(
      readableTitle(
        `For synthetic subject ${REF}, using LOINC 8480-6, 8462-4, how has their blood pressure changed?`,
      ),
    ).toBe("How has their blood pressure changed? · subject 29bbf0");
  });

  test("a subject in the middle and a LOINC aside", () => {
    expect(
      readableTitle(
        `Show me a chart of heart rate (LOINC 8867-4) for subject_ref ${REF} from 2020`,
      ),
    ).toBe("Show me a chart of heart rate from 2020 · subject 29bbf0");
  });

  test("a title with no subject is left alone, codes and all", () => {
    expect(readableTitle("What does LOINC 8867-4 measure?")).toBe(
      "What does LOINC 8867-4 measure?",
    );
    expect(readableTitle("/trainer how was my week")).toBe("/trainer how was my week");
  });

  test("a stored title cut off in the middle of the ref", () => {
    expect(
      readableTitle(
        "Show me a chart of heart rate (LOINC 8867-4) for subject_ref 29bbf012-3e7f-d6ab-",
      ),
    ).toBe("Show me a chart of heart rate · subject 29bbf0");
    expect(
      readableTitle(
        "What is the latest systolic blood pressure (LOINC 8480-6) for subject_ref 29bbf0",
      ),
    ).toBe("What is the latest systolic blood pressure · subject 29bbf0");
  });

  test("only a subject_ref is still a title", () => {
    expect(readableTitle(REF)).toBe("Subject 29bbf0");
  });
});
