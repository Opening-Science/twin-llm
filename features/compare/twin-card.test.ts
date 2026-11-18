import { describe, expect, test } from "bun:test";

import { incognitoTooltip } from "./empty-state";
import { threadSubject } from "./twin-card";

describe("the /twin card's subject (SPEC 7.7)", () => {
  test("synthetic: the Demo, on the person the latest prompt names", () => {
    expect(
      threadSubject("synthetic", [
        "For synthetic subject 29BBF012-0000-4000-8000-000000000001, heart rate?",
        "For synthetic subject 085b5e00-0000-4000-8000-000000000002, sleep?",
      ]),
    ).toEqual({
      subjectId: "demo",
      personRef: "085b5e00-0000-4000-8000-000000000002",
    });
    expect(threadSubject("synthetic", ["How did I sleep?"])).toEqual({
      subjectId: "demo",
    });
  });

  test("personal: the viewer's own default", () => {
    expect(threadSubject("personal", ["anything"])).toEqual({});
  });
});

describe("the incognito toggle (SPEC 2.2)", () => {
  test("its tooltip says what pressing does", () => {
    expect(incognitoTooltip(false)).toBe("Start an incognito chat");
    expect(incognitoTooltip(true)).toBe("End the incognito chat");
  });
});
