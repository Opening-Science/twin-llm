import { describe, expect, test } from "bun:test";

import {
  HELP_KEY,
  readHelpOpen,
  rememberFirstVisit,
  saveHelpOpen,
  type HelpStorage,
} from "./help-disclosure";

const memory = (): HelpStorage & { values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
};

const broken: HelpStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("How to move disclosure", () => {
  test("open on the first visit, collapsed on the next", () => {
    const storage = memory();
    expect(readHelpOpen(storage)).toBe(true);
    rememberFirstVisit(storage);
    expect(storage.values.get(HELP_KEY)).toBe("closed");
    expect(readHelpOpen(storage)).toBe(false);
  });

  test("the person's last choice wins, and a later visit keeps it", () => {
    const storage = memory();
    saveHelpOpen(storage, true);
    rememberFirstVisit(storage);
    expect(storage.values.get(HELP_KEY)).toBe("open");
    expect(readHelpOpen(storage)).toBe(true);
    saveHelpOpen(storage, false);
    expect(readHelpOpen(storage)).toBe(false);
  });

  test("without storage, or when it throws, the help opens and nothing breaks", () => {
    expect(readHelpOpen(null)).toBe(true);
    expect(readHelpOpen(broken)).toBe(true);
    expect(() => saveHelpOpen(broken, true)).not.toThrow();
    expect(() => rememberFirstVisit(broken)).not.toThrow();
  });
});
