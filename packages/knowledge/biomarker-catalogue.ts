/**
 * Renders knowledge/opentwin/biomarker-catalogue.md from the pinned Anchor
 * catalogue (packages/biomarkers). Pure: the generator script writes the
 * result, and a test fails when the committed file drifts from the pin.
 */
import {
  type AnchorLayer,
  type Biomarker,
  anchorLayer,
} from "@/packages/biomarkers/anchor-layer";
import { listBiomarkers, referenceIntervalsOf } from "@/packages/biomarkers/catalogue";
import { UNRENDERABLE_IDS } from "@/packages/biomarkers/unrenderable";

/** Markers per section, so each section stays one retrieval chunk. */
const MAX_PER_SECTION = 12;

const words = (id: string): string => id.replace(/_/g, " ");

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const markerLine = (marker: Biomarker, layer: AnchorLayer): string => {
  const parts = [
    `- ${marker.nameDe} (${marker.id}): ${marker.loincDisplay}.`,
    `LOINC ${marker.loincCode}, unit ${marker.unitUcum}, system ${marker.systemId},`,
    `region ${marker.regionIds.map(words).join(", ")}.`,
  ];
  if (UNRENDERABLE_IDS.has(marker.id)) parts.push("No single body location.");
  if (marker.blocked) parts.push("Unit flagged in Anchor, so no position is shown.");
  if (referenceIntervalsOf(marker.id, layer).length === 0)
    parts.push("No published reference interval.");
  return parts.join(" ");
};

const sectionGroups = (
  markers: readonly Biomarker[],
): ReadonlyArray<readonly [string, readonly Biomarker[]]> => {
  const groups = new Map<string, Biomarker[]>();
  for (const marker of markers) {
    // Metabolic holds over half the catalogue, so it is split by first region.
    const heading =
      marker.systemId === "metabolic"
        ? `Metabolic system markers: ${words(marker.regionIds[0] ?? "other")}`
        : `${capitalise(marker.systemId)} system markers`;
    groups.set(heading, [...(groups.get(heading) ?? []), marker]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([heading, group]) => {
      if (group.length <= MAX_PER_SECTION) return [[heading, group] as const];
      const parts = Math.ceil(group.length / MAX_PER_SECTION);
      return Array.from(
        { length: parts },
        (_, index) =>
          [
            `${heading} (part ${index + 1} of ${parts})`,
            group.slice(index * MAX_PER_SECTION, (index + 1) * MAX_PER_SECTION),
          ] as const,
      );
    });
};

export const renderBiomarkerCatalogue = (layer: AnchorLayer = anchorLayer): string => {
  const markers = listBiomarkers(layer);
  const withInterval = markers.filter(
    (marker) => referenceIntervalsOf(marker.id, layer).length > 0,
  ).length;
  const unrenderable = markers.filter((marker) => UNRENDERABLE_IDS.has(marker.id));
  const lines = [
    "# Title: Biomarker catalogue",
    "",
    "Generated from the pinned Anchor catalogue (@open-twin/anchor-layer, MIT) by",
    "`bun run knowledge:biomarkers`. Do not edit by hand. CC BY 4.0, Open Science",
    "Foundation. LOINC codes and names are © Regenstrief Institute, Inc., used under",
    "the LOINC licence (https://loinc.org/license/). See LICENSE.md.",
    "",
    "# Section: About the Anchor biomarker catalogue",
    "",
    `TwinLLM knows ${markers.length} Anchor biomarkers, the blood markers of the OpenTwin`,
    "Anchor layer. Each has a German name, a LOINC code, a UCUM unit, one body system",
    "and one or more regions, all taken from Anchor unchanged. TwinLLM does not score,",
    "rename or reassign them.",
    `${withInterval} markers have a published reference interval. A value is placed in an`,
    "interval only when exactly one interval fits the person's age and sex and Anchor",
    "has not flagged the unit; otherwise it is shown without a position. Reference",
    "intervals describe a population, not what is right for one person, and TwinLLM",
    "never reads a value as good or bad.",
    "",
    "# Section: Markers with no single body location",
    "",
    `${unrenderable.length} markers describe the whole body rather than one organ (open-twin`,
    "decision D12). The body twin lights no region for them, even when Anchor lists one:",
    "",
    ...unrenderable.map(
      (marker) => `- ${marker.nameDe} (${marker.id}), LOINC ${marker.loincCode}`,
    ),
    "",
  ];
  for (const [heading, group] of sectionGroups(markers)) {
    lines.push(`# Section: ${heading}`, "");
    lines.push(...group.map((marker) => markerLine(marker, layer)));
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
};
