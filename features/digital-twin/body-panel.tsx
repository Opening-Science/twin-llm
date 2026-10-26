"use client";

import { useEffect, useRef, type ReactNode, type Ref } from "react";

import type { VitronicPropertyRow } from "@/features/vitronic/vitronic-status-view";
import {
  formatMetricValue,
  formatNumber,
  measureKindFor,
  propertyLabel,
  withUnit,
} from "@/infrastructure/format-measure";
import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/infrastructure/ui-kit/tabs";
import type { StoredMarker, StoredMeasure } from "@/packages/vitronic/geometry";
import { BIOMARKERS_TAB, NO_VALUE_SECTION } from "./biomarkers/biomarker-copy";
import { BiomarkerDetail, BiomarkerSource } from "./biomarkers/biomarker-detail";
import { noValueOpen, splitByValue, valueCountLine } from "./biomarkers/biomarker-rows";
import { type BiomarkerTabModel } from "./biomarkers/use-biomarker-tab";
import { type PanelAction, type PanelState } from "./panel-state";
import { groupedMarkerRows, groupedMeasureRows, measureValueText } from "./scan-overlays";

export const BODY_PANEL_LABEL = "Scan details";
export const PANEL_SEARCH_LABEL = "Search";
export const PANEL_EMPTY = "None shown.";
export const PANEL_NO_MATCH = "Nothing matches.";
/** What an open panel says when it has nothing to list yet. */
export const PANEL_PICK_PROMPT = "Click a part of the body to see its details.";

const PANEL_TABS = [
  { value: "properties", label: "Properties" },
  { value: "markers", label: "Markers" },
  { value: "measures", label: "Measurements" },
  { value: "biomarkers", label: BIOMARKERS_TAB },
] as const;

export type PanelTab = (typeof PANEL_TABS)[number]["value"];

/**
 * Inline, the same height as the canvas in bodyloop-avatar.tsx. In the
 * environment globals.css drops the cap: the list fills what is left of the
 * rail under the panel's fixed title, tabs and search.
 */
const SCROLL_AREA =
  "twin-body-panel-list max-h-[min(70vh,640px)] overflow-y-auto overscroll-contain";

/**
 * UI-only rounding; stored SI values stay as received. A unit with a known kind
 * (kg) uses that kind's precision; m, m² and m³ keep two decimals, so a volume
 * of 0.065 m³ does not collapse to 0.1.
 */
export const formatPropertyDisplay = (
  row: Pick<VitronicPropertyRow, "value" | "unit">,
): string => {
  if (measureKindFor("", row.unit) !== null)
    return formatMetricValue({ key: "", value: row.value, unit: row.unit });
  return withUnit(formatNumber(row.value, 2), row.unit);
};

export type PanelRow = Readonly<{
  id: string;
  label: string;
  value: string | null;
  group: string | null;
  /** More words the search matches, beyond label, id and group. */
  search?: string;
}>;

export type PanelGroup<R extends PanelRow = PanelRow> = Readonly<{
  group: string | null;
  rows: readonly R[];
}>;

export const propertyRows = (
  properties: readonly VitronicPropertyRow[],
): readonly PanelRow[] =>
  properties.map((row) => ({
    id: row.path,
    label: propertyLabel(row.path),
    value: formatPropertyDisplay(row),
    group: null,
  }));

export const markerRows = (markers: readonly StoredMarker[]): readonly PanelRow[] =>
  groupedMarkerRows(markers).flatMap((entry) =>
    entry.rows.map((row) => ({
      id: row.path,
      label: row.label,
      value: null,
      group: entry.group,
    })),
  );

export const measureRows = (measures: readonly StoredMeasure[]): readonly PanelRow[] =>
  groupedMeasureRows(measures).flatMap((entry) =>
    entry.rows.map((row) => ({
      id: row.path,
      label: row.label,
      value: measureValueText(row),
      group: entry.group,
    })),
  );

/** Every word of the query must appear in the label, the path, the group or the search words. */
export const filterRows = <R extends PanelRow>(
  rows: readonly R[],
  query: string,
): readonly R[] => {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;
  return rows.filter((row) => {
    const text = [row.label, row.id, row.group ?? "", row.search ?? ""]
      .join(" ")
      .toLowerCase();
    return terms.every((term) => text.includes(term));
  });
};

/** Consecutive rows of one group under one heading. */
export const groupPanelRows = <R extends PanelRow>(
  rows: readonly R[],
): readonly PanelGroup<R>[] =>
  rows.reduce<readonly PanelGroup<R>[]>((groups, row) => {
    const last = groups.at(-1);
    return last && last.group === row.group
      ? [...groups.slice(0, -1), { group: last.group, rows: [...last.rows, row] }]
      : [...groups, { group: row.group, rows: [row] }];
  }, []);

/** Escape clears a selection. Returns whether it did, so the caller can stop the key. */
export const clearOnEscape = (
  key: string,
  selectedId: string | null,
  onSelect: (id: string | null) => void,
): boolean => {
  if (key !== "Escape" || selectedId === null) return false;
  onSelect(null);
  return true;
};

type RowHandlers = Readonly<{
  onSelect: (id: string | null) => void;
  /** Scan rows light their 3D item on hover; biomarker rows light only on select. */
  onHover?: (id: string | null) => void;
}>;

/** The accent tint of the pressed toolbar buttons and anatomy chips, without their border. */
const ROW =
  "hover:bg-muted/60 aria-pressed:text-foreground aria-pressed:bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] w-full justify-between gap-2 text-left";

/** Clicking the selected row again clears it; hover and focus light the 3D item. */
export const PanelRowButton = ({
  row,
  selected,
  onSelect,
  onHover,
  detail,
}: RowHandlers & Readonly<{ row: PanelRow; selected: boolean; detail?: ReactNode }>) => {
  const line = (
    <>
      <span className="min-w-0 truncate">{row.label}</span>
      {row.value === null ? null : (
        <span className="shrink-0 tabular-nums">{row.value}</span>
      )}
    </>
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={selected}
      className={detail ? `${ROW} flex-col items-stretch` : ROW}
      onClick={() => onSelect(selected ? null : row.id)}
      onMouseEnter={onHover && (() => onHover(row.id))}
      onMouseLeave={onHover && (() => onHover(null))}
      onFocus={onHover && (() => onHover(row.id))}
      onBlur={onHover && (() => onHover(null))}
    >
      {detail ? (
        <>
          <span className="flex justify-between gap-2">{line}</span>
          {detail}
        </>
      ) : (
        line
      )}
    </Button>
  );
};

const PropertyList = ({ rows }: Readonly<{ rows: readonly PanelRow[] }>) => (
  <ul className="text-xs">
    {rows.map((row) => (
      <li key={row.id} className="flex justify-between gap-2 px-2.5 py-1">
        <span className="min-w-0 truncate">{row.label}</span>
        <span className="shrink-0 tabular-nums">{row.value}</span>
      </li>
    ))}
  </ul>
);

const GroupedList = <R extends PanelRow>({
  rows,
  selectedId,
  detailFor,
  selectedRef,
  ...handlers
}: RowHandlers &
  Readonly<{
    rows: readonly R[];
    selectedId: string | null;
    detailFor?: (row: R) => ReactNode;
    /** On the selected row's item, so it can be scrolled into view. */
    selectedRef?: Ref<HTMLLIElement>;
  }>) =>
  groupPanelRows(rows).map((entry) => (
    <div key={entry.group ?? "rows"} className="mb-2">
      <p className="text-muted-foreground px-2.5 text-xs capitalize">{entry.group}</p>
      <ul>
        {entry.rows.map((row) => (
          <li key={row.id} ref={selectedId === row.id ? selectedRef : undefined}>
            <PanelRowButton
              row={row}
              selected={selectedId === row.id}
              detail={detailFor?.(row)}
              {...handlers}
            />
          </li>
        ))}
      </ul>
    </div>
  ));

const BiomarkerList = ({
  model,
  rows,
  query,
  otherOpen,
  onOther,
}: Readonly<{
  model: BiomarkerTabModel;
  /** The rows the search left. */
  rows: BiomarkerTabModel["rows"];
  query: string;
  otherOpen: boolean;
  onOther: (open: boolean) => void;
}>) => {
  const { withValues, without } = splitByValue(rows);
  // A row picked on the organ card can sit far down, or in the closed section,
  // which `noValueOpen` opens first; then it is brought into view.
  const selectedRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [model.selectedId]);
  const open = noValueOpen({
    userOpen: otherOpen,
    query,
    matches: without.length,
    selectedInside: without.some((row) => row.id === model.selectedId),
  });
  const list = (shown: BiomarkerTabModel["rows"]) => (
    <GroupedList
      rows={shown}
      selectedId={model.selectedId}
      selectedRef={selectedRef}
      onSelect={model.onSelect}
      detailFor={(row) => (
        <BiomarkerDetail
          row={row}
          notes={row.id === model.selectedId ? model.notes : []}
        />
      )}
    />
  );
  return (
    <>
      <BiomarkerSource model={model} />
      <p className="text-muted-foreground mb-2 px-2.5 text-xs">
        {valueCountLine(model.rows)}
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground px-2.5 py-1 text-xs">{PANEL_NO_MATCH}</p>
      ) : null}
      {list(withValues)}
      {without.length > 0 ? (
        <details
          open={open}
          // React only writes `open` when the prop changes. A click that closes the
          // section while a search or the selected row holds it open leaves the
          // element closed with the prop still true; the key remounts it for the
          // next search or selection, so that one opens it again.
          key={open ? `open:${query}:${model.selectedId ?? ""}` : "closed"}
          // The browser fires this for the initial `open` too; only a change from
          // what is shown is the person's choice.
          onToggle={(event) => {
            if (event.currentTarget.open !== open) onOther(event.currentTarget.open);
          }}
        >
          <summary className="cursor-pointer px-2.5 py-1 text-xs font-medium">
            {NO_VALUE_SECTION}
          </summary>
          {list(without)}
        </details>
      ) : null}
    </>
  );
};

export type BodyPanelProps = Partial<Pick<RowHandlers, "onSelect">> &
  Readonly<{
    properties: readonly VitronicPropertyRow[];
    markers: readonly StoredMarker[];
    measures: readonly StoredMeasure[];
    selectedId: string | null;
    /** The Biomarkers tab shows only when given. */
    biomarkers?: BiomarkerTabModel;
    /** Which tabs to offer; the Demo has no scan, so it shows Biomarkers only. */
    tabs?: readonly PanelTab[];
    /** Search, tab and hover, kept by the viewer (panel-state.ts). */
    panel: PanelState;
    onPanel: (action: PanelAction) => void;
  }>;

/** Scan rows need a handler only where there is a scan; the Demo passes none. */
const keepSelection = (): void => undefined;

/** The first offered tab with rows, so a scan with only measurements opens there. */
export const defaultPanelTab = (
  offered: readonly PanelTab[],
  counts: Readonly<Record<PanelTab, number>>,
): PanelTab | undefined => offered.find((tab) => counts[tab] > 0) ?? offered[0];

/** The person's tab while it is offered; otherwise the default for the rows there are now. */
export const activePanelTab = (
  chosen: PanelTab | null,
  offered: readonly PanelTab[],
  counts: Readonly<Record<PanelTab, number>>,
): PanelTab | undefined =>
  chosen !== null && offered.includes(chosen) ? chosen : defaultPanelTab(offered, counts);

/** Properties, markers and measurements of one scan, and biomarkers: tabbed, searchable, each list capped. */
export const BodyPanel = ({
  properties,
  markers,
  measures,
  selectedId,
  onSelect = keepSelection,
  biomarkers,
  tabs,
  panel,
  onPanel,
}: BodyPanelProps) => {
  const { query } = panel;
  const onHover = (id: string | null) => onPanel({ type: "hover", id });
  const lists: Readonly<Record<Exclude<PanelTab, "biomarkers">, readonly PanelRow[]>> = {
    properties: propertyRows(properties),
    markers: markerRows(markers),
    measures: measureRows(measures),
  };
  const offered = PANEL_TABS.filter(
    (tab) =>
      (tabs === undefined || tabs.includes(tab.value)) &&
      (tab.value !== "biomarkers" || biomarkers !== undefined),
  );
  const offeredTabs = offered.map((tab) => tab.value);
  const counts = {
    properties: lists.properties.length,
    markers: lists.markers.length,
    measures: lists.measures.length,
    biomarkers: biomarkers?.rows.length ?? 0,
  };
  const activeTab = activePanelTab(panel.tab, offeredTabs, counts);
  // An open panel is never an empty box: with no rows anywhere it says what to do.
  if (offeredTabs.every((tab) => counts[tab] === 0)) {
    return (
      <p className="text-muted-foreground px-1.5 py-1 text-xs">{PANEL_PICK_PROMPT}</p>
    );
  }
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        const tab = offeredTabs.find((offeredTab) => offeredTab === value);
        if (tab) onPanel({ type: "tab", tab });
      }}
      className="twin-body-panel border-input gap-2 rounded-md border p-2"
      // Keys from the tabs, the search field and the rows all pass through here.
      onKeyDown={(event) => {
        const cleared =
          clearOnEscape(event.key, selectedId, onSelect) ||
          (biomarkers !== undefined &&
            clearOnEscape(event.key, biomarkers.selectedId, biomarkers.onSelect));
        if (cleared) event.stopPropagation();
      }}
    >
      <TabsList aria-label={BODY_PANEL_LABEL}>
        {offered.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="px-2 text-xs">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <Field
        type="search"
        label={PANEL_SEARCH_LABEL}
        value={query}
        onChange={(event) => onPanel({ type: "query", query: event.target.value })}
      />
      {offered.map((tab) => {
        if (tab.value === "biomarkers") {
          return biomarkers ? (
            <TabsContent key={tab.value} value={tab.value} className={SCROLL_AREA}>
              <BiomarkerList
                model={biomarkers}
                rows={filterRows(biomarkers.rows, query)}
                query={query}
                otherOpen={panel.otherOpen}
                onOther={(open) => onPanel({ type: "other", open })}
              />
            </TabsContent>
          ) : null;
        }
        const all = lists[tab.value];
        const shown = filterRows(all, query);
        return (
          <TabsContent
            key={tab.value}
            value={tab.value}
            className={SCROLL_AREA}
            onMouseLeave={() => onHover(null)}
          >
            {shown.length === 0 ? (
              <p className="text-muted-foreground px-2.5 py-1 text-xs">
                {all.length === 0 ? PANEL_EMPTY : PANEL_NO_MATCH}
              </p>
            ) : tab.value === "properties" ? (
              <PropertyList rows={shown} />
            ) : (
              <GroupedList
                rows={shown}
                selectedId={selectedId}
                onSelect={onSelect}
                onHover={onHover}
              />
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
};
