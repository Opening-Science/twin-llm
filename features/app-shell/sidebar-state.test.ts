import { describe, expect, test } from "bun:test";

import {
  pinnedFromCookie,
  sidebarCookie,
  type SidebarState,
  sidebarReducer,
} from "./sidebar-state";

const TUCKED: SidebarState = { pinned: false, peeking: false };
const PEEKING: SidebarState = { pinned: false, peeking: true };
const PINNED: SidebarState = { pinned: true, peeking: false };

describe("sidebarReducer", () => {
  test("reaching a tucked sidebar peeks; reaching again changes nothing", () => {
    expect(sidebarReducer(TUCKED, "reach")).toEqual(PEEKING);
    expect(sidebarReducer(PEEKING, "reach")).toBe(PEEKING);
    expect(sidebarReducer(PINNED, "reach")).toBe(PINNED);
  });

  test("leaving, Escape and following a link stop peeking", () => {
    expect(sidebarReducer(PEEKING, "leave")).toEqual(TUCKED);
    expect(sidebarReducer(PEEKING, "escape")).toEqual(TUCKED);
    expect(sidebarReducer(PEEKING, "follow")).toEqual(TUCKED);
    expect(sidebarReducer(TUCKED, "leave")).toBe(TUCKED);
    expect(sidebarReducer(PINNED, "escape")).toBe(PINNED);
  });

  test("a toggle while peeking pins; on a pinned sidebar it tucks", () => {
    expect(sidebarReducer(PEEKING, "toggle")).toEqual(PINNED);
    expect(sidebarReducer(PINNED, "toggle")).toEqual(TUCKED);
    expect(sidebarReducer(TUCKED, "toggle")).toEqual(PINNED);
  });
});

describe("the sidebar cookie", () => {
  test("only the exact value pinned pins", () => {
    expect(pinnedFromCookie("pinned")).toBe(true);
    expect(pinnedFromCookie("tucked")).toBe(false);
    expect(pinnedFromCookie("Pinned")).toBe(false);
    expect(pinnedFromCookie(undefined)).toBe(false);
  });

  test("keeps its name, holds one word and lasts a year", () => {
    expect(sidebarCookie(true)).toBe(
      "twinllm-sidebar=pinned; Path=/; Max-Age=31536000; SameSite=Lax",
    );
    expect(sidebarCookie(false)).toBe(
      "twinllm-sidebar=tucked; Path=/; Max-Age=31536000; SameSite=Lax",
    );
  });
});
