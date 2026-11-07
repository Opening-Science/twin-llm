import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { StoredMarker, StoredMeasure } from "@/packages/vitronic/geometry";

import { LAB_SOURCE_LABEL } from "./biomarkers/biomarker-copy";
import { markerRows as biomarkerRows } from "./biomarkers/biomarker-rows";
import { type BiomarkerTabModel } from "./biomarkers/use-biomarker-tab";
import { NO_LIVE_VITALS } from "./live/live-rates";
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
  PANEL_PICK_PROMPT,
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

const attr = (tag: string, name: string) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

const hasClass = (tag: string, name: string) =>
  (attr(tag, "class") ?? "").split(/\s+/).includes(name);

/** The panel's tabs (`role="tab"`), in order, with their text. */
const tabs = (markup: string) =>
  [...markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)]
    .filter(([, attrs]) => attr(attrs ?? "", "role") === "tab")
    .map(([tag, , text]) => ({ tag: tag ?? "", text: text ?? "" }));

const tabButtons = (markup: string) => tabs(markup).map((tab) => tab.tag);

const selectedTabs = (markup: string) =>
  tabs(markup).map((tab) => attr(tab.tag, "aria-selected") === "true");

/** The text of the one selected tab. */
const selectedTab = (markup: string) =>
  tabs(markup)
    .filter((tab) => attr(tab.tag, "aria-selected") === "true")
    .map((tab) => tab.text);

/** The tab panels that are shown: only the active one, never a hidden one. */
const openPanels = (markup: string) =>
  tags(markup, "div").filter(
    (tag) => attr(tag, "role") === "tabpanel" && attr(tag, "hidden") === undefined,
  );

/** What the open tab panel starts with. */
const openPanelContent = (markup: string) => {
  const [open] = openPanels(markup);
  return open === undefined ? "" : markup.slice(markup.indexOf(open) + open.length);
};

/** The row buttons: pressed for the selection; the tabs are selected instead. */
const rowButtons = (markup: string) =>
  tags(markup, "button").filter((tag) => attr(tag, "aria-pressed") !== undefined);

describe("formatPropertyDisplay", () => {
  test("metres and their powers keep two decimals; kg uses the mass precision", () => {
    expect(formatPropertyDisplay({ value: 1.7, unit: "m" })).toBe("1.70 m");
    expect(formatPropertyDisplay({ value: 1.85, unit: "m2" })).toBe("1.85 m²");
    expect(formatPropertyDisplay({ value: 0.065, unit: "m3" })).toBe("0.07 m³");
    expect(formatPropertyDisplay({ value: 23.46, unit: "kg/m2" })).toBe("23.5 kg/m²");
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
  test("properties keep their order and path, with plain labels, no group", () => {
    expect(
      propertyRows([
        { path: "body.height", value: 1.7, unit: "m" },
        { path: "body.mass", value: 68, unit: "kg" },
        { path: "body.bmi", value: 23.46, unit: "kg/m2" },
        { path: "body.surface", value: 1.85, unit: "m2" },
        { path: "body.volume", value: 0.065, unit: "m3" },
        { path: "body.other", value: 2, unit: "" },
      ]),
    ).toEqual([
      { id: "body.height", label: "Height", value: "1.70 m", group: null },
      { id: "body.mass", label: "Body mass", value: "68.0 kg", group: null },
      { id: "body.bmi", label: "BMI", value: "23.5 kg/m²", group: null },
      { id: "body.surface", label: "Body surface area", value: "1.85 m²", group: null },
      { id: "body.volume", label: "Body volume", value: "0.07 m³", group: null },
      { id: "body.other", label: "body.other", value: "2.00", group: null },
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
  test("a labelled tablist of three tabs; Markers is selected when there are no properties", () => {
    const html = panel();
    const [list] = tags(html, "div").filter((tag) => attr(tag, "role") === "tablist");
    expect(list).toBeDefined();
    expect(attr(list!, "aria-label")).toBe(BODY_PANEL_LABEL);
    expect(tabs(html).map((tab) => tab.text)).toEqual([
      "Properties",
      "Markers",
      "Measurements",
    ]);
    expect(selectedTabs(html)).toEqual([false, true, false]);
  });

  test("the selected tab controls the one open tab panel", () => {
    const html = panel();
    const [selected] = tabButtons(html).filter(
      (tag) => attr(tag, "aria-selected") === "true",
    );
    const open = openPanels(html);
    expect(open).toHaveLength(1);
    expect(attr(selected!, "aria-controls")).toBe(attr(open[0]!, "id"));
    expect(attr(open[0]!, "aria-labelledby")).toBe(attr(selected!, "id"));
  });

  test("Properties is selected when the scan has properties", () => {
    const html = panel({ properties: [{ path: "body.height", value: 1.7, unit: "m" }] });
    expect(selectedTabs(html)).toEqual([true, false, false]);
    expect(html).toContain('<span class="shrink-0 tabular-nums">1.70 m</span>');
  });

  test("an Anatomy tab comes first when the viewer gives its controls, selected by default, without the search", () => {
    const anatomy = createElement("p", null, "Depth slider");
    const html = panel({ anatomy });
    expect(tabButtons(html)).toHaveLength(4);
    expect(selectedTab(html)).toEqual(["Anatomy"]);
    expect(openPanelContent(html).startsWith("<p>Depth slider</p></div>")).toBe(true);
    expect(html).not.toContain('type="search"');
    expect(html).not.toContain(">Vertex<");
    const [root] = tags(html, "div");
    expect(hasClass(root!, "twin-body-panel")).toBe(true);
  });

  test("only the selected tab's content is in the tree", () => {
    const anatomy = createElement("p", null, "Depth slider");
    const html = panel({ anatomy, panel: { ...initialPanel, tab: "markers" } });
    expect(selectedTabs(html)).toEqual([false, false, true, false]);
    expect(selectedTab(html)).toEqual(["Markers"]);
    expect(html).toContain('type="search"');
    expect(html).toContain(">Vertex<");
    expect(html).not.toContain("Depth slider");
  });

  test("no Anatomy tab without the controls, even when it is asked for", () => {
    const html = panel({ tabs: ["anatomy", "markers"] });
    expect(tabButtons(html)).toHaveLength(1);
    expect(selectedTab(html)).toEqual(["Markers"]);
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

  test("rows are pressed only for the selection, under group headings, in the one list that scrolls", () => {
    const html = panel({ selectedId: "torso.acromion_r" });
    const pressed = rowButtons(html);
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
    // The open tab panel is the list that scrolls; it has no height of its
    // own: beside the view the panel's height caps it.
    const open = openPanels(html);
    expect(open).toHaveLength(1);
    expect(hasClass(open[0]!, "twin-body-panel-list")).toBe(true);
    expect(html).not.toContain("max-h-");
  });

  test("an empty list says so", () => {
    const html = panel({ markers: [], panel: { ...initialPanel, tab: "markers" } });
    expect(html).toContain(PANEL_EMPTY);
  });

  test("with no rows on any tab the panel prompts instead of showing an empty box", () => {
    const html = panel({ markers: [], measures: [] });
    expect(html).toBe(
      `<p class="text-muted-foreground px-1.5 py-1 text-xs">${PANEL_PICK_PROMPT}</p>`,
    );
  });
});

describe("default tab", () => {
  test("the first offered tab with rows; only measurements opens Measurements", () => {
    const counts = { anatomy: 0, properties: 0, markers: 0, measures: 3, biomarkers: 67 };
    expect(
      defaultPanelTab(["properties", "markers", "measures", "biomarkers"], counts),
    ).toBe("measures");
    expect(
      defaultPanelTab(["properties", "markers", "measures"], { ...counts, measures: 0 }),
    ).toBe("properties");
    expect(defaultPanelTab(["biomarkers"], counts)).toBe("biomarkers");
  });

  test("Anatomy, when offered, comes before every list", () => {
    const counts = { anatomy: 1, properties: 5, markers: 0, measures: 3, biomarkers: 67 };
    expect(defaultPanelTab(["anatomy", "properties", "measures"], counts)).toBe(
      "anatomy",
    );
    expect(defaultPanelTab(["anatomy", "biomarkers"], counts)).toBe("anatomy");
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
    organs: [],
    selectedId: null,
    notes: [],
    onSelect: noop,
    intro: "Synthetic labs.",
    people: [
      { ref: "syn-a", label: "Synthetic person 1", sex: null },
      { ref: "syn-b", label: "Synthetic person 2", sex: "female" },
    ],
    live: NO_LIVE_VITALS,
    rhythm: null,
    status: "ok",
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
    expect(tabButtons(html)).toHaveLength(4);
    expect(html).toContain(">Biomarkers</button>");
  });

  test("beside the view the Demo gets Anatomy, then Biomarkers", () => {
    const html = panel({
      anatomy: createElement("p", null, "Depth slider"),
      biomarkers: model(),
      tabs: ["anatomy", "biomarkers"],
      markers: [],
      measures: [],
    });
    expect(selectedTabs(html)).toEqual([true, false]);
    expect(html).toContain(">Biomarkers</button>");
    expect(html).toContain("Depth slider");
    expect(html).not.toContain("Synthetic labs.");
  });

  test("the Demo's Details in the environment offers only Biomarkers: lab source, intro, grouped rows with their lines", () => {
    const html = panel({
      biomarkers: model(),
      tabs: ["biomarkers"],
      markers: [],
      measures: [],
    });
    expect(tabButtons(html)).toHaveLength(1);
    expect(selectedTab(html)).toEqual(["Biomarkers"]);
    expect(html).toContain(`>${LAB_SOURCE_LABEL}</label>`);
    expect(html).toContain('<option value="syn-b">Synthetic person 2 · female</option>');
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
    const pressed = rowButtons(html).filter((tag) => tag.includes('aria-pressed="true"'));
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
    expect(selectedTabs(html)).toEqual([false, false, true]);
    expect(selectedTab(html)).toEqual(["Measurements"]);
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
