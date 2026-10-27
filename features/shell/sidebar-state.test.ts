import { describe, expect, test } from "bun:test";

import {
  isSidebarShortcut,
  pinnedFromCookie,
  sidebarCookie,
  sidebarReducer,
  type SidebarState,
} from "./sidebar-state";

const tucked: SidebarState = { pinned: false, peeking: false };
const peeking: SidebarState = { pinned: false, peeking: true };
const pinned: SidebarState = { pinned: true, peeking: false };

describe("sidebarReducer", () => {
  test("pointing at a tucked sidebar shows it; leaving hides it again", () => {
    expect(sidebarReducer(tucked, "point")).toEqual(peeking);
    expect(sidebarReducer(peeking, "leave")).toEqual(tucked);
  });

  test("a click while peeking pins it, and a second click tucks it away", () => {
    expect(sidebarReducer(peeking, "toggle")).toEqual(pinned);
    expect(sidebarReducer(pinned, "toggle")).toEqual(tucked);
    expect(sidebarReducer(tucked, "toggle")).toEqual(pinned);
  });

  test("a pinned sidebar ignores pointing and leaving", () => {
    for (const event of ["point", "leave", "escape", "navigate"] as const) {
      expect(sidebarReducer(pinned, event)).toBe(pinned);
    }
  });

  test("Escape and following a link close a peek", () => {
    expect(sidebarReducer(peeking, "escape")).toEqual(tucked);
    expect(sidebarReducer(peeking, "navigate")).toEqual(tucked);
  });

  test("an event that changes nothing returns the same state", () => {
    expect(sidebarReducer(peeking, "point")).toBe(peeking);
    expect(sidebarReducer(tucked, "leave")).toBe(tucked);
  });
});

describe("the pinned cookie", () => {
  test("only 'pinned' pins; anything else is tucked", () => {
    expect(pinnedFromCookie("pinned")).toBe(true);
    for (const value of [undefined, "", "tucked", "PINNED"]) {
      expect(pinnedFromCookie(value)).toBe(false);
    }
  });

  test("the cookie holds the choice and nothing else", () => {
    expect(sidebarCookie(true)).toBe(
      "twinllm-sidebar=pinned; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(sidebarCookie(false)).toStartWith("twinllm-sidebar=tucked;");
  });
});

describe("isSidebarShortcut", () => {
  const key = (overrides: Partial<Parameters<typeof isSidebarShortcut>[0]>) => ({
    key: ".",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  });

  test("Ctrl+. and ⌘+. toggle; a bare . or extra modifiers do not", () => {
    expect(isSidebarShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSidebarShortcut(key({ metaKey: true }))).toBe(true);
    expect(isSidebarShortcut(key({}))).toBe(false);
    expect(isSidebarShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSidebarShortcut(key({ key: ",", ctrlKey: true }))).toBe(false);
  });
});
