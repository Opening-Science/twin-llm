import { describe, expect, test } from "bun:test";

import {
  decideLicence,
  LICENCE_TERMS,
  normaliseLicenceCode,
  trainingLicences,
} from "./licence";

describe("normaliseLicenceCode", () => {
  test.each([
    ["CC BY", "cc-by"],
    ["CC0", "cc0"],
    ["cc by 4.0", "cc-by"],
    ["CC BY-NC-ND", "cc-by-nc-nd"],
    ["CC-BY-NC-SA 3.0", "cc-by-nc-sa"],
    ["CC BY-SA", "cc-by-sa"],
    ["CC BY-ND", "cc-by-nd"],
    ["CC BY-NC", "cc-by-nc"],
  ])("%s -> %s", (code, expected) => {
    expect(normaliseLicenceCode(code)).toBe(expected);
  });

  test.each([["TDM"], ["public domain"], [""], ["CC"], ["CC BY-XX"]])(
    "%s is not a known licence",
    (code) => {
      expect(normaliseLicenceCode(code)).toBeNull();
    },
  );

  test("null and undefined are not licences", () => {
    expect(normaliseLicenceCode(null)).toBeNull();
    expect(normaliseLicenceCode(undefined)).toBeNull();
  });
});

describe("decideLicence", () => {
  test("allows a CC licence by default", () => {
    expect(decideLicence("CC BY-NC-ND")).toEqual({ ok: true, licence: "cc-by-nc-nd" });
  });

  test("skips author manuscripts (TDM) and missing codes", () => {
    expect(decideLicence("TDM")).toEqual({
      ok: false,
      reason: "unknown-licence",
      code: "TDM",
    });
    expect(decideLicence(null)).toEqual({
      ok: false,
      reason: "unknown-licence",
      code: "none",
    });
  });

  test("skips a licence outside the allowed list", () => {
    expect(decideLicence("CC BY-NC", ["cc0", "cc-by"])).toEqual({
      ok: false,
      reason: "not-allowed",
      code: "CC BY-NC",
    });
    expect(decideLicence("CC0", ["cc0", "cc-by"])).toEqual({ ok: true, licence: "cc0" });
  });
});

describe("licence terms", () => {
  test("only CC0 and CC BY are training data without review", () => {
    expect(trainingLicences()).toEqual(["cc0", "cc-by"]);
    expect(LICENCE_TERMS["cc-by-sa"].training).toBe("review");
  });

  test("NC licences are not commercial and never training data", () => {
    expect(LICENCE_TERMS["cc-by-nc"]).toEqual({
      label: "CC BY-NC",
      commercial: false,
      training: "no",
    });
    expect(LICENCE_TERMS["cc-by-nc-nd"].training).toBe("no");
    expect(LICENCE_TERMS["cc-by-nd"].training).toBe("no");
  });
});
