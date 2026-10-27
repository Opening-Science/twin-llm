import { describe, expect, test } from "bun:test";

import {
  createPanelStore,
  panelKey,
  readPanelOpen,
  savePanelOpen,
  type PanelStorage,
} from "./panel-memory";

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  const storage: PanelStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
  };
  return { storage, data };
};

const throwing: PanelStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("panel memory", () => {
  test("keys are namespaced", () => {
    expect(panelKey("twin-toolbar")).toBe("twinllm.panel.twin-toolbar");
  });

  test("reads open, closed, or the fallback", () => {
    const { storage } = memoryStorage({ a: "open", b: "closed", c: "odd" });
    expect(readPanelOpen(storage, "a", false)).toBe(true);
    expect(readPanelOpen(storage, "b", true)).toBe(false);
    expect(readPanelOpen(storage, "c", true)).toBe(true);
    expect(readPanelOpen(storage, "missing", false)).toBe(false);
    expect(readPanelOpen(null, "a", true)).toBe(true);
    expect(readPanelOpen(throwing, "a", false)).toBe(false);
  });

  test("saves and reports whether it could", () => {
    const { storage, data } = memoryStorage();
    expect(savePanelOpen(storage, "a", false)).toBe(true);
    expect(data.get("a")).toBe("closed");
    expect(savePanelOpen(throwing, "a", false)).toBe(false);
    expect(savePanelOpen(null, "a", false)).toBe(false);
  });

  test("a store writes through to storage and tells its listeners", () => {
    const { storage, data } = memoryStorage();
    const store = createPanelStore(() => storage);
    const heard: string[] = [];
    const off = store.subscribe(() => heard.push("change"));
    expect(store.get("k", true)).toBe(true);
    store.set("k", false);
    expect(data.get("k")).toBe("closed");
    expect(store.get("k", true)).toBe(false);
    off();
    store.set("k", true);
    expect(heard).toEqual(["change"]);
  });

  test("with storage blocked a toggle still works, from memory", () => {
    const store = createPanelStore(() => throwing);
    expect(store.get("k", true)).toBe(true);
    store.set("k", false);
    expect(store.get("k", true)).toBe(false);
    store.forget("k");
    expect(store.get("k", true)).toBe(true);
  });
});
