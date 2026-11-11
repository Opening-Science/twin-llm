import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ATLASES } from "@/packages/anatomy/manifest";

import { parseSkeletonAtlas, type SkeletonAtlas } from "@/packages/anatomy/open-skeleton";

import { AnatomyControls, loadingPercent, skeletonLines } from "./anatomy-controls";
import {
  ANATOMY_CHANGES_NOTE,
  ANATOMY_FIT_FAILED,
  ANATOMY_LOAD_ERROR,
  ANATOMY_NOT_INSTALLED,
  ANATOMY_TYPICAL_NOTE,
  anatomyFitNote,
  depthValueText,
  HIGHLIGHT_HIDDEN,
  HIGHLIGHT_SYSTEMS_ONLY,
  SKELETON_CREDIT_FALLBACK,
  SKELETON_LOAD_ERROR,
  SKELETON_LOADING,
  SKELETON_MODELLED_NOTE,
  skeletonFitNote,
} from "./anatomy-copy";
import {
  initialAnatomyState,
  type AnatomyState,
  type SkeletonLoad,
} from "./anatomy-state";
import { DEMO_FIT_NOTE, DEMO_FIT_NOTE_UNPOSED, DEMO_TYPICAL_NOTE } from "./demo-copy";
import { highlightOptions, highlightValue } from "./highlight-options";

const ALL_INSTALLED = { bodyparts3d: true, "hra-f": true, "hra-m": true } as const;

const render = (
  state: AnatomyState,
  installed: Record<"bodyparts3d" | "hra-f" | "hra-m", boolean> | null = ALL_INSTALLED,
): string =>
  renderToStaticMarkup(
    createElement(AnatomyControls, {
      state,
      installed,
      dispatch: () => undefined,
      onInteract: () => undefined,
    }),
  ).replaceAll("&#x27;", "'");

const ready = (
  overrides: Partial<Extract<AnatomyState["load"], { kind: "ready" }>> = {},
) => ({
  kind: "ready" as const,
  presentLayers: ["muscle", "skeleton", "organs"] as const,
  systems: ["cardiovascular", "nervous"] as const,
  partSystems: ["musculoskeletal", "cardiovascular", "nervous"] as const,
  groups: [] as const,
  parts: [] as const,
  anchor: "hips" as const,
  fitOk: true,
  ...overrides,
});

describe("AnatomyControls", () => {
  test("the slider spans 0..3 and names the current stop", () => {
    const html = render({ ...initialAnatomyState, targetDepth: 2 });
    expect(html).toContain('type="range"');
    expect(html).toContain('min="0"');
    expect(html).toContain('max="3"');
    expect(html).toContain('aria-valuetext="Skeleton"');
    expect(html).toContain('aria-pressed="true">Skeleton</button>');
    expect(html).toContain('aria-pressed="false">Scan</button>');
  });

  test("aria-valuetext names the two neighbours between stops", () => {
    expect(depthValueText(1.5)).toBe("Between muscle and skeleton");
    expect(render({ ...initialAnatomyState, targetDepth: 0.4 })).toContain(
      'aria-valuetext="Between scan and muscle"',
    );
  });

  test("before anything is requested there is no credit and no fit note", () => {
    const html = render(initialAnatomyState);
    expect(html).not.toContain(ANATOMY_TYPICAL_NOTE);
    expect(html).not.toContain(ATLASES.bodyparts3d.attribution);
  });

  test("a ready atlas shows the fit note, the typical note and the credit", () => {
    const html = render({
      ...initialAnatomyState,
      requested: true,
      targetDepth: 1,
      load: ready(),
    });
    expect(html).toContain(anatomyFitNote("hips"));
    expect(html).toContain(ANATOMY_TYPICAL_NOTE);
    expect(html).toContain(ATLASES.bodyparts3d.attribution);
    expect(html).toContain(ANATOMY_CHANGES_NOTE);
    expect(html).toContain('href="https://creativecommons.org/licenses/by/4.0/"');
    expect(html).toContain('aria-pressed="true">Cardiovascular</button>');
    expect(html).toContain('aria-pressed="true">Nervous</button>');
  });

  test("a bbox fit says it centred on the outline; a failed fit says so", () => {
    expect(
      render({
        ...initialAnatomyState,
        requested: true,
        load: ready({ anchor: "bbox" }),
      }),
    ).toContain(anatomyFitNote("bbox"));
    expect(
      render({ ...initialAnatomyState, requested: true, load: ready({ fitOk: false }) }),
    ).toContain(ANATOMY_FIT_FAILED);
  });

  test("loading shows a percentage, an error offers a retry", () => {
    expect(
      render({
        ...initialAnatomyState,
        requested: true,
        load: { kind: "loading", percent: 42 },
      }),
    ).toContain('<p>Loading reference anatomy…<span aria-hidden="true"> 42%</span></p>');
    const error = render({
      ...initialAnatomyState,
      requested: true,
      load: { kind: "error" },
    });
    expect(error).toContain(ANATOMY_LOAD_ERROR);
    expect(error).toContain(">Try again</button>");
  });

  test("a missing atlas disables the slider and marks the option", () => {
    const html = render(initialAnatomyState, {
      bodyparts3d: false,
      "hra-f": true,
      "hra-m": true,
    });
    expect(html).toContain(ANATOMY_NOT_INSTALLED);
    expect(html).toMatch(/type="range"[^>]*disabled=""/);
    expect(html).toContain("BodyParts3D · male donor · 10 MB (not installed)");
    expect(html.match(/type="checkbox"[^>]*disabled=""/g)?.length).toBe(3);
  });

  test("HRA explains its coverage and the layers it does not have", () => {
    const html = render({
      ...initialAnatomyState,
      atlasId: "hra-f",
      requested: true,
      load: ready({ presentLayers: ["muscle", "organs"] }),
    });
    expect(html).toContain(
      "Almost no muscle in this atlas. Partial skeleton: no skull, ribs, arms or hands.",
    );
    expect(html).toContain("Skeleton: Not in this atlas.");
    expect(html).toContain(ATLASES["hra-f"].attribution);
  });

  test("hidden systems render unpressed", () => {
    const html = render({
      ...initialAnatomyState,
      requested: true,
      hiddenSystems: ["nervous"],
      load: ready(),
    });
    expect(html).toContain('aria-pressed="false">Nervous</button>');
  });

  const demoHtml = (posed?: boolean) =>
    renderToStaticMarkup(
      createElement(AnatomyControls, {
        state: {
          ...initialAnatomyState,
          requested: true,
          targetDepth: 2,
          load: ready({ anchor: "bbox" }),
        },
        installed: ALL_INSTALLED,
        dispatch: () => undefined,
        onInteract: () => undefined,
        envelope: "demo",
        ...(posed === undefined ? {} : { posed }),
      }),
    ).replaceAll("&#x27;", "'");

  test("inside the demo body the notes say synthetic and bbox, never 'scanned person'", () => {
    const html = demoHtml(true);
    expect(anatomyFitNote("bbox", "demo", true)).toBe(
      "Reference anatomy from a donor atlas, scaled to the demo body's height and centred on its outline. The demo body is posed to the atlas's stance, its feet over the atlas's feet. The hips are not aligned.",
    );
    expect(html).toContain(DEMO_FIT_NOTE);
    expect(html).toContain(DEMO_TYPICAL_NOTE);
    expect(html).not.toContain(ANATOMY_TYPICAL_NOTE);
    expect(html).not.toContain("scanned person");
    expect(html).toContain(ATLASES.bodyparts3d.attribution);
  });

  test("a demo body that is not posed (the static fallback) never claims the stance", () => {
    expect(anatomyFitNote("bbox", "demo")).toBe(DEMO_FIT_NOTE_UNPOSED);
    expect(DEMO_FIT_NOTE_UNPOSED).not.toContain("stance");
    for (const html of [demoHtml(), demoHtml(false)]) {
      expect(html).toContain(DEMO_FIT_NOTE_UNPOSED);
      expect(html).not.toContain("stance");
    }
  });
});

describe("highlight picker", () => {
  const HRA_GROUPS = [
    { key: "liver", label: "Liver" },
    { key: "heart", label: "Heart" },
    { key: "smallintestine", label: "Small intestine" },
  ] as const;

  test("options: none, systems in atlas order, then HRA groups by name", () => {
    expect(
      highlightOptions({
        partSystems: ["metabolic", "musculoskeletal"],
        groups: HRA_GROUPS,
      }).map((option) => [option.value, option.label, option.section]),
    ).toEqual([
      ["none", "None", "none"],
      ["system:metabolic", "Metabolic", "systems"],
      ["system:musculoskeletal", "Musculoskeletal", "systems"],
      ["group:heart", "Heart", "groups"],
      ["group:liver", "Liver", "groups"],
      ["group:smallintestine", "Small intestine", "groups"],
    ]);
  });

  test("each option carries the highlight its value names", () => {
    const options = highlightOptions({ partSystems: ["metabolic"], groups: HRA_GROUPS });
    for (const option of options) {
      expect(highlightValue(option.highlight)).toBe(option.value);
    }
    expect(options.find((option) => option.value === "group:liver")?.highlight).toEqual({
      kind: "groups",
      ids: ["liver"],
    });
    expect(highlightOptions(null).map((option) => option.value)).toEqual(["none"]);
  });

  test("renders only once the atlas is ready, with the current choice selected", () => {
    expect(render({ ...initialAnatomyState, requested: true })).not.toContain(
      ">Highlight<",
    );
    const html = render({
      ...initialAnatomyState,
      requested: true,
      load: ready({ groups: HRA_GROUPS }),
      highlight: { kind: "groups", ids: ["liver"] },
    });
    expect(html).toContain(">Highlight</label>");
    expect(html).toContain('<optgroup label="Body systems">');
    expect(html).toContain('<optgroup label="Organs">');
    expect(html).toContain('<option value="group:liver" selected="">Liver</option>');
    expect(html).not.toContain(HIGHLIGHT_HIDDEN);
    expect(html).not.toContain(HIGHLIGHT_SYSTEMS_ONLY);
  });

  test("groups with the same name are one option lighting every key", () => {
    const options = highlightOptions({
      partSystems: ["metabolic"],
      groups: [
        { key: "liverducts", label: "Liver ducts" },
        { key: "liver", label: "Liver" },
        { key: "ductsliver", label: "Liver ducts" },
      ],
    }).filter((option) => option.section === "groups");
    expect(options).toEqual([
      {
        value: "group:liver",
        label: "Liver",
        section: "groups",
        highlight: { kind: "groups", ids: ["liver"] },
      },
      {
        value: "group:liverducts+ductsliver",
        label: "Liver ducts",
        section: "groups",
        highlight: { kind: "groups", ids: ["liverducts", "ductsliver"] },
      },
    ]);
  });

  test("a highlight from a biomarker row shows as its own option, not None", () => {
    const html = render({
      ...initialAnatomyState,
      requested: true,
      load: ready({ groups: HRA_GROUPS }),
      highlight: { kind: "groups", ids: ["liver", "gallbladder"] },
      highlightFrom: {
        id: "bm:BM-123",
        label: "From biomarker: Gamma-GT (GGT)",
        highlights: {
          hra: { kind: "groups", ids: ["liver", "gallbladder"] },
          bodyparts3d: { kind: "system", ids: ["metabolic"] },
        },
      },
    });
    expect(html).toContain(
      '<option value="from:bm:BM-123" selected="">From biomarker: Gamma-GT (GGT)</option>',
    );
    expect(html).toContain('<option value="none">None</option>');
    // A row that lights nothing has no option of its own.
    const unlit = render({
      ...initialAnatomyState,
      requested: true,
      load: ready({ groups: HRA_GROUPS }),
      highlightFrom: {
        id: "bm:BM-107",
        label: "From biomarker: Ferritin",
        highlights: { hra: null, bodyparts3d: null },
      },
    });
    expect(unlit).not.toContain("From biomarker");
    expect(unlit).toContain('<option value="none" selected="">None</option>');
  });

  test("says the highlight is hidden only when a toggle hides every lit part", () => {
    const lit = {
      ...initialAnatomyState,
      requested: true,
      load: ready({
        groups: HRA_GROUPS,
        parts: [
          { layer: "organs", system: "metabolic", group: "liver" },
          { layer: "organs", system: "cardiovascular", group: "heart" },
        ],
      }),
      highlight: { kind: "groups", ids: ["liver"] },
    } as const;
    expect(render(lit)).not.toContain(HIGHLIGHT_HIDDEN);
    expect(render({ ...lit, hiddenSystems: ["metabolic"] })).toContain(HIGHLIGHT_HIDDEN);
    expect(render({ ...lit, hiddenSystems: ["cardiovascular"] })).not.toContain(
      HIGHLIGHT_HIDDEN,
    );
    expect(
      render({ ...lit, layers: { muscle: true, skeleton: true, organs: false } }),
    ).toContain(HIGHLIGHT_HIDDEN);
  });

  test("BodyParts3D: systems only, and the copy says why", () => {
    const html = render({ ...initialAnatomyState, requested: true, load: ready() });
    expect(html).not.toContain('<optgroup label="Organs">');
    expect(html).toContain(
      '<option value="system:musculoskeletal">Musculoskeletal</option>',
    );
    expect(html).toContain(HIGHLIGHT_SYSTEMS_ONLY);
  });
});

describe("Skeleton layer controls", () => {
  const S0086: SkeletonAtlas = parseSkeletonAtlas({
    case: "s0086",
    girdleLeftOut: [
      { label: "clavicula_left" },
      { label: "clavicula_right" },
      { label: "scapula_left" },
      { label: "scapula_right" },
      { label: "humerus_left" },
      { label: "humerus_right" },
    ],
  });
  const READY: SkeletonLoad = {
    kind: "ready",
    anchor: "hips",
    fitOk: true,
    bones: 46,
    modelled: 1,
    box: { min: [-0.15, -0.12, 0.85], max: [0.15, 0.11, 1.46] },
  };
  const renderSkeleton = (
    state: AnatomyState,
    skeleton: SkeletonAtlas | null,
    skeletonLoad: SkeletonLoad = { kind: "idle" },
  ): string =>
    renderToStaticMarkup(
      createElement(AnatomyControls, {
        state,
        installed: ALL_INSTALLED,
        dispatch: () => undefined,
        onInteract: () => undefined,
        skeleton,
        skeletonLoad,
        envelope: "demo",
      }),
    ).replaceAll("&#x27;", "'");
  const notes = (html: string): readonly string[] => {
    const live = html.match(/<div aria-live="polite"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
    return [...live.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map(([, text]) =>
      text!.replace(/<[^>]+>/g, ""),
    );
  };

  test("without a configured skeleton: no CT option and no spread control", () => {
    const html = renderSkeleton(initialAnatomyState, null);
    expect(html).not.toContain("CT skeleton");
    expect(html).not.toContain('aria-label="Spread bones"');
    // Isolate works on the atlas's own bones too, and sits beside the stops.
    expect(html).toContain('aria-pressed="false">Only the skeleton</button>');
  });

  test("a configured skeleton names its case; the spread control waits for the bones", () => {
    const html = renderSkeleton(initialAnatomyState, S0086, { kind: "loading" });
    expect(html).toContain("CT skeleton · open-anatomy s0086");
    expect(html).not.toContain('aria-label="Spread bones"');
  });

  test("once placed: Spread bones is a labelled control right after Only the skeleton", () => {
    const html = renderSkeleton(
      { ...initialAnatomyState, requested: true, isolate: "skeleton", explode: 0.25 },
      S0086,
      READY,
    );
    const isolate = html.indexOf(">Only the skeleton</button>");
    const spread = html.indexOf('aria-label="Spread bones"');
    expect(isolate).toBeGreaterThan(0);
    expect(spread).toBeGreaterThan(isolate);
    expect(html.indexOf("<details")).toBeGreaterThan(spread);
    expect(html).toContain(">Spread bones</span>");
    expect(html).toContain('aria-valuetext="25% apart"');
  });

  test("with the CT skeleton in view the panel says two short sentences, CT only", () => {
    const html = renderSkeleton(
      {
        ...initialAnatomyState,
        requested: true,
        targetDepth: 2,
        load: { kind: "loading", percent: 100 },
      },
      S0086,
      READY,
    );
    expect(notes(html)).toEqual([
      skeletonFitNote("hips"),
      "Left out: clavicles, scapulae and humeri.",
    ]);
    expect(skeletonFitNote("hips")).toContain("not this body's skeleton");
    // The atlas's glass muscle still shows at the Skeleton stop, so its credit stays.
    expect(html).toContain(SKELETON_CREDIT_FALLBACK);
    expect(html).toContain(ANATOMY_CHANGES_NOTE);
  });

  test("isolated, only the CT credit is left", () => {
    const html = renderSkeleton(
      { ...initialAnatomyState, requested: true, isolate: "skeleton", load: ready() },
      S0086,
      READY,
    );
    expect(notes(html)).toHaveLength(2);
    expect(html).not.toContain(DEMO_FIT_NOTE_UNPOSED);
    expect(html).toContain(SKELETON_CREDIT_FALLBACK);
    expect(html).not.toContain(ANATOMY_CHANGES_NOTE);
  });

  test("at the Organs stop the atlas notes come back beside the CT sentence", () => {
    const html = renderSkeleton(
      { ...initialAnatomyState, requested: true, targetDepth: 3, load: ready() },
      S0086,
      READY,
    );
    expect(notes(html)).toContain(DEMO_FIT_NOTE_UNPOSED);
    expect(notes(html)).toContain(skeletonFitNote("hips"));
  });

  test("switched off, the CT skeleton says nothing and the atlas credit stays", () => {
    const html = renderSkeleton(
      { ...initialAnatomyState, requested: true, ctSkeleton: false },
      S0086,
      READY,
    );
    expect(html).not.toContain("Left out:");
    expect(html).not.toContain(SKELETON_CREDIT_FALLBACK);
    expect(html).toContain(ANATOMY_CHANGES_NOTE);
  });

  test("an atlas.json attribution replaces the fallback credit", () => {
    const credited = {
      ...S0086,
      attribution: "Derived from case s0086 of TotalSegmentator.",
    };
    const html = renderSkeleton(
      { ...initialAnatomyState, requested: true },
      credited,
      READY,
    );
    expect(html).toContain("Derived from case s0086 of TotalSegmentator.");
    expect(html).not.toContain(SKELETON_CREDIT_FALLBACK);
  });

  test("skeletonLines: at most two sentences, following the load", () => {
    expect(skeletonLines(S0086, { kind: "idle" })).toEqual([]);
    expect(skeletonLines(S0086, { kind: "loading" })).toEqual([SKELETON_LOADING]);
    expect(skeletonLines(S0086, { kind: "error" })).toEqual([SKELETON_LOAD_ERROR]);
    expect(skeletonLines(S0086, { ...READY, fitOk: false })).toEqual([
      "The CT skeleton could not be placed in this body.",
    ]);
    // Nothing left out: the second sentence says some parts are modelled.
    expect(skeletonLines(parseSkeletonAtlas({ case: "s0086" }), READY)).toEqual([
      skeletonFitNote("hips"),
      SKELETON_MODELLED_NOTE,
    ]);
    expect(
      skeletonLines(parseSkeletonAtlas({ case: "s0086" }), { ...READY, modelled: 0 }),
    ).toEqual([skeletonFitNote("hips")]);
  });
});

describe("loading line", () => {
  test("the percentage shows while bytes arrive and goes at 100", () => {
    expect(loadingPercent(null)).toBeNull();
    expect(loadingPercent(42.4)).toBe(42);
    expect(loadingPercent(100)).toBeNull();
    const html = render({
      ...initialAnatomyState,
      requested: true,
      load: { kind: "loading", percent: 100 },
    });
    expect(html).not.toContain("100%");
  });
});
