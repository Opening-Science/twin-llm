import { describe, expect, test } from "bun:test";

import { keyPress } from "./kiosk-trigger";

describe("keyPress", () => {
  test("Space, Enter and the forward arrows press; the back arrows go back", () => {
    expect(
      [" ", "Enter", "ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].map(keyPress),
    ).toEqual(["press", "press", "press", "press", "back", "back"]);
  });

  test("Escape sends the kiosk back to the start", () => {
    expect(keyPress("Escape")).toBe("reset");
  });

  test("any other key does nothing", () => {
    expect(["a", "Tab", "Home", "Shift"].map(keyPress)).toEqual([null, null, null, null]);
  });
});
