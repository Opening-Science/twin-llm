import { describe, expect, test } from "bun:test";

import {
  CEREBROVASCULAR_PATTERN,
  isOralAnticoagulant,
  ORAL_ANTICOAGULANT_PATTERN,
  topicOf,
} from "./codes";

describe("topicOf", () => {
  test("maps the planted codes to their topics", () => {
    expect(topicOf("49436004")).toBe("af");
    expect(topicOf("230690007")).toBe("stroke");
    expect(topicOf("88805009")).toBe("heartFailure");
    expect(topicOf("401314000")).toBe("vascular");
    expect(topicOf("78275009")).toBe("sleepApnea");
    expect(topicOf("26929004")).toBe("dementia");
  });

  test("an unrelated code has no topic", () => {
    expect(topicOf("714628002")).toBeNull();
  });
});

describe("anticoagulants", () => {
  test("warfarin is an oral anticoagulant, clopidogrel is not", () => {
    expect(isOralAnticoagulant("855332")).toBe(true);
    expect(isOralAnticoagulant("309362")).toBe(false);
  });

  test("the name pattern finds direct oral anticoagulants", () => {
    expect(ORAL_ANTICOAGULANT_PATTERN.test("apixaban 5 MG Oral Tablet")).toBe(true);
    expect(ORAL_ANTICOAGULANT_PATTERN.test("Clopidogrel 75 MG Oral Tablet")).toBe(false);
  });
});

describe("CEREBROVASCULAR_PATTERN", () => {
  test("matches stroke displays and not cerebral palsy", () => {
    expect(CEREBROVASCULAR_PATTERN.test("Cerebrovascular accident (disorder)")).toBe(
      true,
    );
    expect(CEREBROVASCULAR_PATTERN.test("Transient ischemic attack (disorder)")).toBe(
      true,
    );
    expect(CEREBROVASCULAR_PATTERN.test("Cerebral palsy (disorder)")).toBe(false);
  });
});
