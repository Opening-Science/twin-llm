import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { StoredMarker, StoredMeasure } from "@/packages/vitronic/geometry";

import { LAB_SOURCE_LABEL } from "./biomarkers/biomarker-copy";
import { markerRows as biomarkerRows } from "./biomarkers/biomarker-rows";
import { type BiomarkerTabModel } from "./biomarkers/use-biomarker-tab";
import {
  BODY_PANEL_LABEL,
  BodyPanel,
  type BodyPanelProps,
  clearOnEscape,
  defaultPanelTab,
  filterRows,
  formatPropertyDisplay,
  groupPanelRows,
  markerRows,
  measureRows,
  PANEL_EMPTY,
  PANEL_SEARCH_LABEL,
  PanelRowButton,
  propertyRows,
  type PanelRow,
} from "./body-panel";
import { initialPanel } from "./panel-state";

const MARKERS: readonly StoredMarker[] = [
  {
    path: "leg.knee_l",
    label: "Knee L",
    group: "leg",
    source: "auto",
    position: [0, 0, 0.5],
  },
  {
    path: "head.vertex",
    label: "Vertex",
    group: "head",
    source: "auto",
    position: [0, 0, 1.6],
  },
  {
    path: "torso.acromion_r",
    label: "Acromion R",
    group: "torso",
    source: "palpation",
    position: [0.18, 0, 1.32],
  },
  {
    path: "head.tragion_l",
    label: "Tragion L",
    group: "head",
    source: "custom",
    position: [0, 0, 1.5],
  },
];

const MEASURES: readonly StoredMeasure[] = [
  {
    kind: "distance",
    path: "arm.span",
    label: "Span",
    value: 0.425,
    unit: "m",
    markerRefs: [],
    positions: [],
  },
  {
    kind: "height",
    path: "head.vertex",
    label: "Stature",
    value: 1.57,
    unit: "m",
    markerRefs: ["head.vertex"],
    positions: [],
  },
  {
    kind: "angle",
    path: "leg.knee_angle_l",
    label: "Knee angle L",
    value: 0.0523,
    unit: "rad",
    markerRefs: [],
    positions: [],
  },
];

const noop = () => undefined;

const panel = (props: Partial<BodyPanelProps> = {}) =>
  renderToStaticMarkup(
    createElement(BodyPanel, {
      properties: [],
      markers: MARKERS,
      measures: MEASURES,
      selectedId: null,
      onSelect: noop,
      panel: initialPanel,
      onPanel: noop,
      ...props,
    }),
  );

const tags = (markup: string, tag: string) =>
  [...markup.matchAll(new RegExp(`<${tag}[^>]*>`, "g"))].map((m) => m[0]);

describe("formatPropertyDisplay", () => {
  test("metres and their powers keep two decimals; kg uses the mass precision", () => {
    expect(formatPropertyDisplay({ value: 1.7, unit: "m" })).toBe("1.70 m");
    expect(formatPropertyDisplay({ value: 1.85, unit: "m2" })).toBe("1.85 m2");
    expect(formatPropertyDisplay({ value: 0.065, unit: "m3" })).toBe("0.07 m3");
    expect(formatPropertyDisplay({ value: 68, unit: "kg" })).toBe("68.0 kg");
    expect(formatPropertyDisplay({ value: 1234.5, unit: "" })).toBe("1,234.50");
  });

  test("a value that is not a finite number shows a dash, unit dropped", () => {
    expect(formatPropertyDisplay({ value: Number.NaN, unit: "m" })).toBe("—");
    expect(formatPropertyDisplay({ value: Number.POSITIVE_INFINITY, unit: "kg" })).toBe(
      "—",
    );
  });
});

describe("panel rows", () => {
  test("properties keep their order and path, no group", () => {
    expect(
      propertyRows([
        { path: "body.height", value: 1.7, unit: "m" },
        { path: "body.mass", value: 68, unit: "kg" },
      ]),
    ).toEqual([
      { id: "body.height", label: "body.height", value: "1.70 m", group: null },
      { id: "body.mass", label: "body.mass", value: "68.0 kg", group: null },
    ]);
  });

  test("markers follow the body's group order", () => {
    expect(markerRows(MARKERS)).toEqual([
      { id: "head.vertex", label: "Vertex", value: null, group: "head" },
      { id: "head.tragion_l", label: "Tragion L", value: null, group: "head" },
      { id: "torso.acromion_r", label: "Acromion R", value: null, group: "torso" },
      { id: "leg.knee_l", label: "Knee L", value: null, group: "leg" },
    ]);
  });

  test("measurements show cm and degrees through the formatter", () => {
    expect(measureRows(MEASURES)).toEqual([
      { id: "head.vertex", label: "Stature", value: "157.0 cm", group: "head" },
      { id: "arm.span", label: "Span", value: "42.5 cm", group: "arm" },
      { id: "leg.knee_angle_l", label: "Knee angle L", value: "3.0°", group: "leg" },
    ]);
  });

  test("consecutive rows of one group share a heading", () => {
    const rows = markerRows(MARKERS);
    expect(groupPanelRows(rows)).toEqual([
      { group: "head", rows: [rows[0]!, rows[1]!] },
      { group: "torso", rows: [rows[2]!] },
      { group: "leg", rows: [rows[3]!] },
    ]);
    expect(groupPanelRows([])).toEqual([]);
  });
});

describe("filterRows", () => {
  const rows = markerRows(MARKERS);

  test("a blank query returns the same rows", () => {
    expect(filterRows(rows, "")).toBe(rows);
    expect(filterRows(rows, "   ")).toBe(rows);
  });

  test("matches label, path or group, ignoring case", () => {
    expect(filterRows(rows, "VERTEX").map((row) => row.id)).toEqual(["head.vertex"]);
    expect(filterRows(rows, "acromion_r").map((row) => row.id)).toEqual([
      "torso.acromion_r",
    ]);
    expect(filterRows(rows, "head").map((row) => row.id)).toEqual([
      "head.vertex",
      "head.tragion_l",
    ]);
  });

  test("every word must match", () => {
    expect(filterRows(rows, " head  l ").map((row) => row.id)).toEqual([
      "head.tragion_l",
    ]);
    expect(filterRows(rows, "head knee")).toEqual([]);
  });
});

describe("clearOnEscape", () => {
  test("Escape clears a selection and reports it", () => {
    const calls: (string | null)[] = [];
    expect(clearOnEscape("Escape", "head.vertex", (id) => calls.push(id))).toBe(true);
    expect(calls).toEqual([null]);
  });

  test("no selection or another key: nothing happens", () => {
    const calls: (string | null)[] = [];
    expect(clearOnEscape("Escape", null, (id) => calls.push(id))).toBe(false);
    expect(clearOnEscape("Enter", "head.vertex", (id) => calls.push(id))).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("PanelRowButton", () => {
  const row: PanelRow = { id: "arm.span", label: "Span", value: "42.5 cm", group: "arm" };
  type Handlers = Readonly<{
    onClick: () => void;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  }>;
  const props = (selected: boolean, calls: string[]) =>
    (
      PanelRowButton({
        row,
        selected,
        onSelect: (id) => calls.push(`select:${id}`),
        onHover: (id) => calls.push(`hover:${id}`),
      }) as ReactElement<Handlers>
    ).props;

  test("click selects; clicking the selected row clears it", () => {
    const calls: string[] = [];
    props(false, calls).onClick();
    props(true, calls).onClick();
    expect(calls).toEqual(["select:arm.span", "select:null"]);
  });

  test("hover and focus light the 3D item; leaving clears it", () => {
    const calls: string[] = [];
    const handlers = props(false, calls);
    handlers.onMouseEnter();
    handlers.onMouseLeave();
    handlers.onFocus();
    handlers.onBlur();
    expect(calls).toEqual([
      "hover:arm.span",
      "hover:null",
      "hover:arm.span",
      "hover:null",
    ]);
  });

  test("a ghost button that reports its state and tints when pressed", () => {
    const render = (selected: boolean) =>
      renderToStaticMarkup(
        createElement(PanelRowButton, { row, selected, onSelect: noop, onHover: noop }),
      );
    expect(render(false)).toContain('aria-pressed="false"');
    const html = render(true);
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("text-muted-foreground hover:text-foreground");
    expect(html).toContain(
      "aria-pressed:text-foreground aria-pressed:bg-[color-mix(in_oklab,var(--primary)_12%,transparent)]",
    );
    expect(html).toContain('<span class="min-w-0 truncate">Span</span>');
    expect(html).toContain('<span class="shrink-0 tabular-nums">42.5 cm</span>');
  });
});

describe("BodyPanel markup", () => {
  test("a labelled tablist with three tabs; Markers is selected when there are no properties", () => {
    const html = panel();
    const tablist = tags(html, "div").find((tag) => tag.includes('role="tablist"'));
    expect(tablist).toContain(`aria-label="${BODY_PANEL_LABEL}"`);
    const tabs = tags(html, "button").filter((tag) => tag.includes('role="tab"'));
    expect(tabs).toHaveLength(3);
    expect(tabs.map((tag) => tag.includes('aria-selected="true"'))).toEqual([
      false,
      true,
      false,
    ]);
    expect(html).toContain(">Properties</button>");
    expect(html).toContain(">Markers</button>");
    expect(html).toContain(">Measurements</button>");
  });

  test("Properties is selected when the scan has properties", () => {
    const html = panel({ properties: [{ path: "body.height", value: 1.7, unit: "m" }] });
    const tabs = tags(html, "button").filter((tag) => tag.includes('role="tab"'));
    expect(tabs.map((tag) => tag.includes('aria-selected="true"'))).toEqual([
      true,
      false,
      false,
    ]);
    expect(html).toContain('<span class="shrink-0 tabular-nums">1.70 m</span>');
  });

  test("the search field has a visible label tied to the input", () => {
    const html = panel();
    const labelFor = /<label for="([^"]+)"[^>]*>Search<\/label>/.exec(html)?.[1];
    expect(PANEL_SEARCH_LABEL).toBe("Search");
    expect(labelFor).toBeDefined();
    const input = tags(html, "input")[0]!;
    expect(input).toContain('type="search"');
    expect(input).toContain(`id="${labelFor}"`);
  });

  test("rows are pressed only for the selection, under group headings, in a capped scroll area", () => {
    const html = panel({ selectedId: "torso.acromion_r" });
    const pressed = tags(html, "button").filter((tag) => tag.includes("aria-pressed"));
    expect(pressed).toHaveLength(4);
    expect(pressed.filter((tag) => tag.includes('aria-pressed="true"'))).toHaveLength(1);
    const buttonFor = (label: string) =>
      new RegExp(`<button([^>]*)><span class="min-w-0 truncate">${label}</span>`).exec(
        html,
      )?.[1];
    expect(buttonFor("Acromion R")).toContain('aria-pressed="true"');
    expect(buttonFor("Vertex")).toContain('aria-pressed="false"');
    expect(html.indexOf(">Acromion R<")).toBeLessThan(html.indexOf(">Knee L<"));
    expect(html).toContain(
      '<p class="text-muted-foreground px-2.5 text-xs capitalize">torso</p>',
    );
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("max-h-[min(70vh,640px)] overflow-y-auto overscroll-contain");
  });

  test("an empty list says so", () => {
    const html = panel({ markers: [], measures: [] });
    expect(html).toContain(PANEL_EMPTY);
  });
});

describe("default tab", () => {
  test("the first offered tab with rows; only measurements opens Measurements", () => {
    const counts = { properties: 0, markers: 0, measures: 3, biomarkers: 67 };
    expect(
      defaultPanelTab(["properties", "markers", "measures", "biomarkers"], counts),
    ).toBe("measures");
    expect(
      defaultPanelTab(["properties", "markers", "measures"], { ...counts, measures: 0 }),
    ).toBe("properties");
    expect(defaultPanelTab(["biomarkers"], counts)).toBe("biomarkers");
  });
});

describe("Biomarkers tab", () => {
  const rows = biomarkerRows([
    {
      loinc: "2571-8",
      value: 150,
      unitUcum: "mg/dL",
      effectiveAt: "2024-11-20T12:00:00Z",
    },
  ]).filter((row) => ["bm:BM-383", "bm:BM-107"].includes(row.id));
  const model = (overrides: Partial<BiomarkerTabModel> = {}): BiomarkerTabModel => ({
    rows,
    selectedId: null,
    notes: [],
    onSelect: noop,
    intro: "Synthetic labs.",
    people: [
      { ref: "syn-a", label: "Synthetic person 1" },
      { ref: "syn-b", label: "Synthetic person 2" },
    ],
    personRef: "syn-a",
    onPerson: noop,
    ...overrides,
  });

  test("search reaches the extra words: LOINC code and Anchor id", () => {
    expect(filterRows(rows, "2571-8").map((row) => row.id)).toEqual(["bm:BM-383"]);
    expect(filterRows(rows, "bm-107").map((row) => row.id)).toEqual(["bm:BM-107"]);
  });

  test("a fourth tab when the panel has a biomarker model", () => {
    const html = panel({ biomarkers: model() });
    expect(tags(html, "button").filter((tag) => tag.includes('role="tab"'))).toHaveLength(
      4,
    );
    expect(html).toContain(">Biomarkers</button>");
  });

  test("the Demo offers only Biomarkers: lab source, intro, grouped rows with their lines", () => {
    const html = panel({
      biomarkers: model(),
      tabs: ["biomarkers"],
      markers: [],
      measures: [],
    });
    const tabs = tags(html, "button").filter((tag) => tag.includes('role="tab"'));
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toContain('aria-selected="true"');
    expect(html).toContain(`>${LAB_SOURCE_LABEL}</label>`);
    expect(html).toContain('<option value="syn-b">Synthetic person 2</option>');
    expect(html).toContain("Synthetic labs.");
    expect(html).toContain(
      '<p class="text-muted-foreground px-2.5 text-xs capitalize">Cardiovascular</p>',
    );
    expect(html).toContain('<span class="shrink-0 tabular-nums">150 mg/dL</span>');
    expect(html).toContain("<span>Within the published range · 20 Nov 2024</span>");
  });

  test("only the selected row shows its notes", () => {
    const html = panel({
      biomarkers: model({ selectedId: "bm:BM-107", notes: ["No single body location"] }),
      tabs: ["biomarkers"],
    });
    const pressed = tags(html, "button").filter((tag) =>
      tag.includes('aria-pressed="true"'),
    );
    expect(pressed).toHaveLength(1);
    expect(html.match(/No single body location/g)).toHaveLength(1);
    expect(html.indexOf("No single body location")).toBeGreaterThan(
      html.indexOf(">Ferritin<"),
    );
  });

  test("valued rows first; the rest wait in a closed section a search opens", () => {
    const html = panel({ biomarkers: model(), tabs: ["biomarkers"] });
    expect(html).toContain(">1 with values · 2 in Anchor v3</p>");
    expect(html).toContain(
      '<details><summary class="cursor-pointer px-2.5 py-1 text-xs font-medium">Other Anchor biomarkers (no value)</summary>',
    );
    expect(html.indexOf("150 mg/dL")).toBeLessThan(html.indexOf("Other Anchor"));
    expect(html.indexOf(">Ferritin<")).toBeGreaterThan(html.indexOf("Other Anchor"));
    const searched = panel({
      biomarkers: model(),
      tabs: ["biomarkers"],
      panel: { ...initialPanel, query: "ferritin" },
    });
    expect(searched).toContain('<details open="">');
    expect(searched).not.toContain("150 mg/dL");
  });

  test("the panel shows the tab the viewer keeps", () => {
    const html = panel({ panel: { ...initialPanel, tab: "measures" } });
    const selected = tags(html, "button").filter((tag) =>
      tag.includes('aria-selected="true"'),
    );
    expect(selected).toHaveLength(1);
    expect(html).toMatch(/aria-selected="true"[^>]*>Measurements</);
  });

  test("biomarker rows light on select only, not on hover", () => {
    const element = PanelRowButton({
      row: rows[0]!,
      selected: false,
      onSelect: noop,
    }) as ReactElement<{ onMouseEnter?: unknown; onFocus?: unknown }>;
    expect(element.props.onMouseEnter).toBeUndefined();
    expect(element.props.onFocus).toBeUndefined();
  });
});
