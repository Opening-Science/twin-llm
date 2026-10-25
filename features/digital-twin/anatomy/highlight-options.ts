import { type Highlight } from "@/packages/anatomy/highlight";

import { HIGHLIGHT_NONE, SYSTEM_LABEL } from "./anatomy-copy";
import { type AnatomyLoad, type AnatomyState } from "./anatomy-state";

type ReadyLoad = Extract<AnatomyLoad, { kind: "ready" }>;
type Current = Pick<AnatomyState, "highlight" | "highlightFrom">;

export type HighlightOption = Readonly<{
  /** Namespaced so a system and a group never share a value: `system:metabolic`, `group:liver`. */
  value: string;
  label: string;
  section: "none" | "from" | "systems" | "groups";
  highlight: Highlight | null;
}>;

export const highlightValue = (highlight: Highlight | null): string =>
  highlight === null
    ? "none"
    : `${highlight.kind === "system" ? "system" : "group"}:${highlight.ids.join("+")}`;

/**
 * The select's value. A highlight set from a Biomarkers-tab row is its own
 * option ("From biomarker: GGT"), so one that spans several groups does not
 * read as "None".
 */
export const selectedHighlightValue = (current: Current): string =>
  current.highlight && current.highlightFrom
    ? `from:${current.highlightFrom.id}`
    : highlightValue(current.highlight);

const fromOption = (current: Current | undefined): readonly HighlightOption[] =>
  current?.highlight && current.highlightFrom
    ? [
        {
          value: selectedHighlightValue(current),
          label: current.highlightFrom.label,
          section: "from",
          highlight: current.highlight,
        },
      ]
    : [];

/**
 * None, the row that set the highlight, every system with a mesh, then the
 * loaded HRA atlas's organ groups. Groups with the same name are one option.
 */
export const highlightOptions = (
  ready: Pick<ReadyLoad, "partSystems" | "groups"> | null,
  current?: Current,
): readonly HighlightOption[] => {
  const none: HighlightOption = {
    value: "none",
    label: HIGHLIGHT_NONE,
    section: "none",
    highlight: null,
  };
  const from = fromOption(current);
  if (!ready) return [none, ...from];
  const systems = ready.partSystems.map((system): HighlightOption => {
    const highlight: Highlight = { kind: "system", ids: [system] };
    return {
      value: highlightValue(highlight),
      label: SYSTEM_LABEL[system],
      section: "systems",
      highlight,
    };
  });
  const labels = [...new Set(ready.groups.map((group) => group.label))].sort((a, b) =>
    a.localeCompare(b, "en"),
  );
  const groups = labels.map((label): HighlightOption => {
    const ids = ready.groups
      .filter((group) => group.label === label)
      .map((group) => group.key);
    const highlight: Highlight = { kind: "groups", ids };
    return { value: highlightValue(highlight), label, section: "groups", highlight };
  });
  return [none, ...from, ...systems, ...groups];
};
