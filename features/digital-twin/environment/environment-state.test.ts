import { describe, expect, test } from "bun:test";

import {
  closeEnvironment,
  enterFullscreen,
  environmentReducer,
  escapeExits,
  initialEnvironment,
  openEnvironment,
  panelLayout,
  type PanelLayout,
  wrapFocus,
  type FullscreenDocument,
} from "./environment-state";

const fakeDocument = (
  enabled: boolean,
  element: object | null = null,
): {
  fullscreenEnabled: boolean;
  fullscreenElement: object | null;
  exits: number;
  exitFullscreen: () => Promise<void>;
  /** A container whose grant makes it this document's full-screen element. */
  granting: () => { requestFullscreen: () => Promise<void> };
} => {
  const doc = {
    fullscreenEnabled: enabled,
    fullscreenElement: element,
    exits: 0,
    exitFullscreen: async () => {
      doc.exits += 1;
    },
    granting: () => {
      const target = {
        requestFullscreen: async () => {
          doc.fullscreenElement = target;
        },
      };
      return target;
    },
  };
  return doc;
};

describe("openEnvironment", () => {
  test("asks for real full screen without the navigation UI", async () => {
    const calls: unknown[] = [];
    const mode = await openEnvironment(fakeDocument(true), {
      requestFullscreen: async (options) => {
        calls.push(options);
      },
    });
    expect(mode).toBe("fullscreen");
    expect(calls).toEqual([{ navigationUI: "hide" }]);
  });

  test("falls back to the overlay when full screen is off, missing or refused", async () => {
    const calls: string[] = [];
    expect(
      await openEnvironment(fakeDocument(false), {
        requestFullscreen: async () => {
          calls.push("asked");
        },
      }),
    ).toBe("overlay");
    expect(calls).toEqual([]);
    expect(await openEnvironment(fakeDocument(true), {})).toBe("overlay");
    expect(
      await openEnvironment(fakeDocument(true), {
        requestFullscreen: () => Promise.reject(new TypeError("denied")),
      }),
    ).toBe("overlay");
  });
});

describe("closeEnvironment", () => {
  test("leaves full screen only when our container holds it", async () => {
    const container = {};
    const holding = fakeDocument(true, container);
    await closeEnvironment(holding, "fullscreen", container);
    expect(holding.exits).toBe(1);

    const released = fakeDocument(true, null);
    await closeEnvironment(released, "fullscreen", container);
    expect(released.exits).toBe(0);

    const someoneElse = fakeDocument(true, {});
    await closeEnvironment(someoneElse, "fullscreen", container);
    expect(someoneElse.exits).toBe(0);

    const overlay = fakeDocument(true, container);
    await closeEnvironment(overlay, "overlay", container);
    expect(overlay.exits).toBe(0);

    await closeEnvironment(holding, "fullscreen", null);
    expect(holding.exits).toBe(1);
  });

  test("a failing exit does not throw", async () => {
    const container = {};
    const doc: FullscreenDocument = {
      fullscreenEnabled: true,
      fullscreenElement: container,
      exitFullscreen: () => Promise.reject(new TypeError("not active")),
    };
    expect(await closeEnvironment(doc, "fullscreen", container)).toBeUndefined();
  });
});

describe("enterFullscreen", () => {
  test("a grant that arrives after exit leaves full screen once", async () => {
    const doc = fakeDocument(true);
    const outcome = await enterFullscreen(doc, doc.granting(), () => false);
    expect(outcome).toBe("dropped");
    expect(doc.exits).toBe(1);
  });

  test("a grant while still open moves into full screen", async () => {
    const doc = fakeDocument(true);
    const outcome = await enterFullscreen(doc, doc.granting(), () => true);
    expect(outcome).toBe("fullscreen");
    expect(doc.exits).toBe(0);
  });

  test("a refused request stays in the overlay", async () => {
    const doc = fakeDocument(true);
    const asked: string[] = [];
    const outcome = await enterFullscreen(
      doc,
      {
        requestFullscreen: () =>
          Promise.reject(new TypeError("Permissions check failed")),
      },
      () => {
        asked.push("isCurrent");
        return true;
      },
    );
    expect(outcome).toBe("overlay");
    expect(asked).toEqual([]);
    expect(doc.exits).toBe(0);
  });
});

describe("escapeExits", () => {
  const key = (overrides: Partial<Parameters<typeof escapeExits>[0]>) =>
    escapeExits({
      key: "Escape",
      defaultPrevented: false,
      targetTag: "BODY",
      ...overrides,
    });

  test("Escape on the canvas or a button closes the overlay", () => {
    expect(key({})).toBe(true);
    expect(key({ targetTag: "CANVAS" })).toBe(true);
    expect(key({ targetTag: "BUTTON" })).toBe(true);
    expect(key({ targetTag: "" })).toBe(true);
  });

  test("text fields, handled keys and other keys do not", () => {
    expect(key({ targetTag: "INPUT" })).toBe(false);
    expect(key({ targetTag: "TEXTAREA" })).toBe(false);
    expect(key({ defaultPrevented: true })).toBe(false);
    expect(key({ key: "Tab" })).toBe(false);
  });
});

describe("wrapFocus", () => {
  test("cycles at the ends and leaves the middle to the browser", () => {
    expect(wrapFocus(2, 3, false)).toBe(0);
    expect(wrapFocus(1, 3, false)).toBeNull();
    expect(wrapFocus(0, 3, true)).toBe(2);
    expect(wrapFocus(1, 3, true)).toBeNull();
  });

  test("focus outside the environment is pulled back in", () => {
    expect(wrapFocus(-1, 3, false)).toBe(0);
    expect(wrapFocus(-1, 3, true)).toBe(2);
    expect(wrapFocus(-1, 0, false)).toBeNull();
  });
});

describe("environmentReducer", () => {
  const closed = { scene: false, anatomy: false, details: false };

  test("starts off, in the studio, following the clock, panels closed", () => {
    expect(initialEnvironment).toEqual({
      mode: "off",
      preset: "studio",
      followTime: true,
      open: closed,
    });
  });

  test("the layout follows the window width", () => {
    expect([375, 639, 640, 1000, 1023, 1024, 1440].map(panelLayout)).toEqual([
      "phone",
      "phone",
      "laptop",
      "laptop",
      "laptop",
      "wide",
      "wide",
    ]);
  });

  test("entry opens the scene panel on a laptop and all panels when wide", () => {
    const enter = (layout: PanelLayout) =>
      environmentReducer(initialEnvironment, { type: "enter", layout });
    expect(enter("phone")).toEqual({ ...initialEnvironment, mode: "overlay" });
    expect(enter("laptop").open).toEqual({ ...closed, scene: true });
    expect(enter("wide").open).toEqual({ scene: true, anatomy: true, details: true });
    const opened = { ...initialEnvironment, open: { ...closed, details: true } };
    expect(environmentReducer(opened, { type: "enter", layout: "phone" }).open).toEqual(
      closed,
    );
  });

  test("a full-screen grant moves only an open overlay into full screen", () => {
    const overlay = environmentReducer(initialEnvironment, {
      type: "enter",
      layout: "phone",
    });
    expect(environmentReducer(overlay, { type: "fullscreen" }).mode).toBe("fullscreen");
    expect(environmentReducer(initialEnvironment, { type: "fullscreen" })).toBe(
      initialEnvironment,
    );
  });

  test("preset and clock survive an exit", () => {
    const outdoors = environmentReducer(
      environmentReducer(initialEnvironment, { type: "preset", preset: "outdoors" }),
      { type: "followTime" },
    );
    expect(outdoors).toEqual({
      ...initialEnvironment,
      preset: "outdoors",
      followTime: false,
    });
    const inside = environmentReducer(outdoors, { type: "enter", layout: "wide" });
    expect(environmentReducer(inside, { type: "exit" })).toEqual({
      ...inside,
      mode: "off",
    });
  });

  test("beside the body panels toggle on their own", () => {
    const inside = environmentReducer(initialEnvironment, {
      type: "enter",
      layout: "laptop",
    });
    const both = environmentReducer(inside, {
      type: "toggle",
      panel: "details",
      single: false,
    });
    expect(both.open).toEqual({ scene: true, anatomy: false, details: true });
    expect(
      environmentReducer(both, { type: "toggle", panel: "scene", single: false }).open,
    ).toEqual({ scene: false, anatomy: false, details: true });
  });

  test("on a phone opening a panel closes the others; closing touches nothing else", () => {
    const sceneOpen = {
      ...initialEnvironment,
      mode: "overlay" as const,
      open: { ...closed, scene: true },
    };
    const details = environmentReducer(sceneOpen, {
      type: "toggle",
      panel: "details",
      single: true,
    });
    expect(details.open).toEqual({ ...closed, details: true });
    expect(
      environmentReducer(details, { type: "toggle", panel: "details", single: true })
        .open,
    ).toEqual(closed);
  });

  test("exit when already off keeps the same state", () => {
    expect(environmentReducer(initialEnvironment, { type: "exit" })).toBe(
      initialEnvironment,
    );
  });

  test("open shows a panel, closes the others on a phone, and keeps an open one", () => {
    const anatomy = { ...initialEnvironment, open: { ...closed, anatomy: true } };
    const wide = environmentReducer(anatomy, {
      type: "open",
      panel: "details",
      single: false,
    });
    expect(wide.open).toEqual({ ...closed, anatomy: true, details: true });
    expect(
      environmentReducer(anatomy, { type: "open", panel: "details", single: true }).open,
    ).toEqual({ ...closed, details: true });
    expect(
      environmentReducer(wide, { type: "open", panel: "details", single: true }),
    ).toBe(wide);
  });
});
