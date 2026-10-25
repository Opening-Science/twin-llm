import { describe, expect, test } from "bun:test";

import { installTabTrap, type TabEvent, type TrapDocument } from "./focus-trap";

type Listener = (event: TabEvent) => void;

/** A document that records its keydown listeners and who has focus. */
const fakeDocument = () => {
  const listeners: { listener: Listener; capture: boolean }[] = [];
  const body = { name: "body" };
  const doc = {
    activeElement: body as unknown,
    addEventListener: (_type: "keydown", listener: Listener, capture: boolean) => {
      listeners.push({ listener, capture });
    },
    removeEventListener: (_type: "keydown", listener: Listener) => {
      const index = listeners.findIndex((entry) => entry.listener === listener);
      if (index >= 0) listeners.splice(index, 1);
    },
  } satisfies TrapDocument;
  /** Presses a key at the document, the way a Tab with focus on <body> arrives. */
  const press = (key: string, shiftKey = false): boolean => {
    let prevented = false;
    const event = {
      key,
      shiftKey,
      preventDefault: () => {
        prevented = true;
      },
    };
    for (const entry of [...listeners]) entry.listener(event);
    return prevented;
  };
  /** Controls inside the environment; focusing one makes it the active element. */
  const container = (names: readonly string[]) => {
    const inside = names.map((name) => {
      const control = {
        name,
        focus: () => {
          doc.activeElement = control;
        },
      };
      return control;
    });
    const self = {
      name: "container",
      focusables: () => inside,
      focus: () => {
        doc.activeElement = self;
      },
    };
    return { self, inside };
  };
  return { doc, body, listeners, press, container };
};

describe("installTabTrap", () => {
  test("Tab with focus on <body> after a canvas drag lands inside", () => {
    const { doc, body, press, container } = fakeDocument();
    const { self, inside } = container(["Reset view", "Pause", "Details"]);
    installTabTrap(doc, self);
    expect(doc.activeElement).toBe(body);
    expect(press("Tab")).toBe(true);
    expect(doc.activeElement).toBe(inside[0]);
  });

  test("Shift+Tab from outside lands on the last control", () => {
    const { doc, press, container } = fakeDocument();
    const { self, inside } = container(["Reset view", "Pause", "Details"]);
    installTabTrap(doc, self);
    expect(press("Tab", true)).toBe(true);
    expect(doc.activeElement).toBe(inside[2]);
  });

  test("focus on the container itself counts as outside the controls", () => {
    const { doc, press, container } = fakeDocument();
    const { self, inside } = container(["Reset view", "Pause"]);
    installTabTrap(doc, self);
    self.focus();
    expect(press("Tab")).toBe(true);
    expect(doc.activeElement).toBe(inside[0]);
  });

  test("wraps at the ends and leaves the middle to the browser", () => {
    const { doc, press, container } = fakeDocument();
    const { self, inside } = container(["Reset view", "Pause", "Details"]);
    installTabTrap(doc, self);
    inside[2]!.focus();
    expect(press("Tab")).toBe(true);
    expect(doc.activeElement).toBe(inside[0]);
    inside[1]!.focus();
    expect(press("Tab")).toBe(false);
    expect(doc.activeElement).toBe(inside[1]);
  });

  test("with nothing focusable, Tab stays on the container", () => {
    const { doc, press, container } = fakeDocument();
    const { self } = container([]);
    installTabTrap(doc, self);
    expect(press("Tab")).toBe(true);
    expect(doc.activeElement).toBe(self);
  });

  test("other keys pass, the listener captures, and stopping removes it", () => {
    const { doc, body, listeners, press, container } = fakeDocument();
    const { self } = container(["Reset view"]);
    const stop = installTabTrap(doc, self);
    expect(listeners.map((entry) => entry.capture)).toEqual([true]);
    expect(press("Escape")).toBe(false);
    expect(doc.activeElement).toBe(body);
    stop();
    expect(listeners).toEqual([]);
    expect(press("Tab")).toBe(false);
    expect(doc.activeElement).toBe(body);
  });
});
