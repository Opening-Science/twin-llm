import { describe, expect, test } from "bun:test";

import {
  INCOGNITO_HREF,
  INCOGNITO_LOCAL_ONLY,
  INCOGNITO_LOCAL_ONLY_SENTENCE,
  incognitoSessionId,
  isIncognitoParam,
  permitIncognitoModel,
} from "./incognito";

describe("incognito policy", () => {
  test("other UI links to /?incognito=1", () => {
    expect(INCOGNITO_HREF).toBe("/?incognito=1");
  });

  test("only incognito=1 turns the mode on", () => {
    expect(
      [
        isIncognitoParam("1"),
        isIncognitoParam("true"),
        isIncognitoParam(undefined),
      ].concat(isIncognitoParam(["1", "1"])),
    ).toEqual([true, false, false, false]);
  });

  test("a local chat model is permitted; any other is refused with the code", () => {
    expect(permitIncognitoModel({ chatIsLocal: true })).toEqual({ ok: true });
    expect(permitIncognitoModel({ chatIsLocal: false })).toEqual({
      ok: false,
      code: INCOGNITO_LOCAL_ONLY,
      error: INCOGNITO_LOCAL_ONLY_SENTENCE,
    });
  });

  test("the audit session id is the prefix and a random id", () => {
    expect(incognitoSessionId(() => "abc")).toBe("incognito-abc");
  });
});
