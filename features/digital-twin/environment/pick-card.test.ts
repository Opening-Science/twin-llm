import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { markerRows } from "../biomarkers/biomarker-rows";
import { cardPlacement, createAnchorStore, CARD_WIDTH_PX } from "./card-anchor";
import {
  BODY_CARD_NOTE,
  BODY_CARD_TITLE,
  CARD_ATLAS_NOTE,
  NO_LINKED_BIOMARKERS,
  pickedLabel,
} from "./environment-copy";
import { cardFacts, PickCard, type PickCardProps } from "./pick-card";
import { linkedRows, type Picked } from "./pick-part";

const LIVER: Picked = {
  target: {
    kind: "part",
    label: "Liver",
    layer: "organs",
    system: "digestive",
    group: "liver",
    ontologyId: "UBERON:0002107",
  },
  point: [0.05, -0.02, 1.1],
};
const BODY: Picked = { target: { kind: "body" }, point: [0, -0.1, 1.2] };

const render = (props: Partial<PickCardProps> & Pick<PickCardProps, "picked">) =>
  renderToStaticMarkup(
    createElement(PickCard, {
      linked: [],
      selectedId: null,
      store: createAnchorStore(),
      onSelectRow: () => undefined,
      onClose: () => undefined,
      ...props,
    }),
  );

const texts = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>(.*?)</${tag}>`, "g"))].map(([, inner]) =>
    inner!.replace(/<[^>]+>/g, ""),
  );

describe("PickCard", () => {
  test("a part: name, facts, donor-atlas note and its linked biomarkers", () => {
    const linked = linkedRows(LIVER.target, markerRows(null), "hra");
    const html = render({ picked: LIVER, linked, selectedId: "bm:BM-140" });
    expect(texts(html, "h3")).toEqual(["Liver"]);
    expect(texts(html, "p")).toEqual([
      "Digestive · Organs · UBERON:0002107",
      CARD_ATLAS_NOTE,
    ]);
    expect(texts(html, "h4")).toEqual(["Linked biomarkers"]);
    expect(html.match(/<li>/g)?.length).toBe(10);
    expect(html.match(/aria-pressed="true"/g)?.length).toBe(1);
    expect(html).toContain('aria-label="Close"');
  });

  test("a part with no linked marker says so", () => {
    const html = render({ picked: LIVER });
    expect(texts(html, "p").at(-1)).toBe(NO_LINKED_BIOMARKERS);
    expect(html).not.toContain("<ul");
  });

  test("the body outline points to the depth slider and lists nothing", () => {
    const html = render({ picked: BODY });
    expect(texts(html, "h3")).toEqual([BODY_CARD_TITLE]);
    expect(texts(html, "p")).toEqual([BODY_CARD_NOTE]);
    expect(html).not.toContain("<h4");
  });

  test("facts and the Highlight select label", () => {
    expect(cardFacts(BODY)).toEqual([]);
    expect(pickedLabel("Liver")).toBe("Picked: Liver");
  });
});

describe("card anchor", () => {
  const at = (x: number, y: number, width = 1280, height = 800, behind = false) => ({
    x,
    y,
    width,
    height,
    behind,
  });

  test("the store skips sub-pixel moves and tells listeners otherwise", () => {
    const store = createAnchorStore();
    const calls: string[] = [];
    const stop = store.subscribe(() => {
      const now = store.get();
      calls.push(now ? `${now.x}${now.behind ? " behind" : ""}` : "null");
    });
    store.set(at(100, 50, 800, 600));
    store.set(at(100.3, 50.2, 800, 600));
    store.set(at(101, 50, 800, 600));
    store.set(at(101, 50, 800, 600, true));
    store.set(null);
    stop();
    store.set(at(5, 5, 800, 600));
    expect(calls).toEqual(["100", "101", "101 behind", "null"]);
  });

  test("right of the point, flipped left at the edge, hanging down in the upper half", () => {
    expect(CARD_WIDTH_PX).toBe(288);
    expect(cardPlacement(at(300, 200), 300)).toEqual({ left: 320, top: 160 });
    expect(cardPlacement(at(1100, 200), 300)).toEqual({ left: 792, top: 160 });
    expect(cardPlacement(at(200, 10, 400), 300)).toEqual({ left: 12, top: 12 });
  });

  test("in the lower half a tall card rises above the point and is never cut off", () => {
    // A 300 px card for a point 10 px above the bottom: its bottom edge is 788 of 800.
    expect(cardPlacement(at(300, 790), 300)).toEqual({ left: 320, top: 488 });
    expect(cardPlacement(at(300, 600), 300)).toEqual({ left: 320, top: 340 });
    // Taller than the canvas: pinned to the top edge, and the card scrolls (globals.css).
    expect(cardPlacement(at(300, 600), 900)).toEqual({ left: 320, top: 12 });
  });

  test("behind the camera at the bottom left; before the first frame at the top left", () => {
    expect(cardPlacement(at(0, 0, 1280, 800, true), 300)).toEqual({ left: 12, top: 488 });
    expect(cardPlacement(null, 300)).toEqual({ left: 12, top: 12 });
  });
});
