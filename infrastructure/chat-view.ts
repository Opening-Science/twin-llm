import type { z } from "zod";

import { EMPTY_VALUE, formatDate } from "./format-measure";
import {
  type biomarkerCardSpecSchema,
  chatViewSchema,
  type compareSpecSchema,
  type tableSpecSchema,
  type timeseriesSpecSchema,
} from "./view-specs";

/**
 * A view in an answer: a chart, card or table the server drew from audited
 * rows. The model asks for one with `show_view`; it never writes a number.
 * `features/chat` builds views and streams them as `data-view` parts,
 * `features/arena` reads them back from the stream or from the stored
 * `show_view` tool parts, so the shape lives here (the specs in
 * `view-specs.ts`). Pure, so the browser and the server share it.
 */

export const DATA_VIEW_PART = "data-view";
export const SHOW_VIEW_TOOL = "show_view";
/** Lists the thread's views by id and title; draws nothing. */
export const LIST_VIEWS_TOOL = "list_views";
/** Returns a stored view again, unchanged, so it is drawn without a new query. */
export const OPEN_VIEW_TOOL = "open_view";

/** Every tool that draws or reopens a view; a skill keeps them only when it allows views. */
export const VIEW_TOOLS: ReadonlySet<string> = new Set([
  SHOW_VIEW_TOOL,
  LIST_VIEWS_TOOL,
  OPEN_VIEW_TOOL,
]);

/** Tools whose output is a view (or a refusal), streamed on as a `data-view` part. */
export const VIEW_OUTPUT_TOOLS: ReadonlySet<string> = new Set([
  SHOW_VIEW_TOOL,
  OPEN_VIEW_TOOL,
]);

export type ViewPoint = Readonly<{ at: string; value: number }>;

export type TimeseriesSpec = z.infer<typeof timeseriesSpecSchema>;
export type CompareSpec = z.infer<typeof compareSpecSchema>;
export type BiomarkerCardSpec = z.infer<typeof biomarkerCardSpecSchema>;
export type TableSpec = z.infer<typeof tableSpecSchema>;

export type ChatView = z.infer<typeof chatViewSchema>;
export type ViewKind = ChatView["kind"];

/** One kind of view, narrowed: `ViewOf<"table">`. */
export type ViewOf<K extends ViewKind> = Extract<ChatView, Readonly<{ kind: K }>>;

/** Deterministic, so the streamed part and the stored tool part name the same view. */
export const viewId = (sourceAuditIds: readonly string[]): string =>
  `view-${sourceAuditIds.join("-")}`;

/** A window bound as a calendar day, `1 Oct 2026`; a datetime keeps its day. */
const titleDay = (bound: string): string => {
  const day = formatDate(bound.slice(0, 10));
  return day === EMPTY_VALUE ? bound : day;
};

type Window = Readonly<{ start: string; end: string }>;

/** `1 Oct 2026 – 31 Oct 2026`: plain dates, never a raw timestamp. */
export const windowText = (window: Window): string =>
  `${titleDay(window.start)} – ${titleDay(window.end)}`;

/** `Heart rate, 1 Jan 2016 – 31 Oct 2026`. */
export const viewTitle = (label: string, window: Window): string =>
  `${label}, ${windowText(window)}`;

type Built<S> = Readonly<{ spec: S; sourceAuditIds: readonly string[] }>;

export const timeseriesView = (input: Built<TimeseriesSpec>): ChatView => ({
  id: viewId(input.sourceAuditIds),
  kind: "chart.timeseries",
  title: viewTitle(input.spec.label, input.spec.window),
  spec: { ...input.spec, points: [...input.spec.points] },
  sourceAuditIds: [...input.sourceAuditIds],
});

/** `Sleep duration, 24 Oct 2025 – 30 Oct 2025 vs 26 Sep 2025 – 23 Oct 2025`. */
export const compareView = (input: Built<CompareSpec>): ChatView => ({
  id: viewId(input.sourceAuditIds),
  kind: "chart.compare",
  title: `${viewTitle(input.spec.label, input.spec.after)} vs ${windowText(input.spec.before)}`,
  spec: input.spec,
  sourceAuditIds: [...input.sourceAuditIds],
});

export const biomarkerCardView = (input: Built<BiomarkerCardSpec>): ChatView => ({
  id: viewId(input.sourceAuditIds),
  kind: "biomarker.card",
  title: viewTitle(input.spec.label, input.spec.window),
  spec: input.spec,
  sourceAuditIds: [...input.sourceAuditIds],
});

export const tableView = (input: Built<TableSpec>): ChatView => ({
  id: viewId(input.sourceAuditIds),
  kind: "table",
  title: viewTitle(input.spec.label, input.spec.window),
  spec: input.spec,
  sourceAuditIds: [...input.sourceAuditIds],
});

/**
 * The decimals a stored number was written with, at most three: 0.35 keeps
 * both. A card shows its value and range this way, and its trend arrow
 * rounds the fitted change to the same decimals.
 */
export const writtenDecimals = (value: number): number => {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot === -1 || text.includes("e") ? 0 : Math.min(3, text.length - dot - 1);
};

/** Rows the view was drawn from, as its audit rows count them. */
export const viewReadings = (view: ChatView): number => {
  switch (view.kind) {
    case "chart.timeseries":
      return view.spec.points.length;
    case "chart.compare":
      return view.spec.before.n + view.spec.after.n;
    case "biomarker.card":
      return view.spec.n;
    case "table":
      return view.spec.total;
  }
};

/** The synthetic subject a view shows; null for the user's own wearables. */
export const viewSubject = (view: ChatView): string | null => view.spec.subject;

/** A view only when its spec parses; a view without an audit source is not one. */
export const toChatView = (value: unknown): ChatView | null => {
  const parsed = chatViewSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

type PartLike = Readonly<{
  type: string;
  data?: unknown;
  state?: string;
  output?: unknown;
}>;

const isViewToolPart = (part: PartLike): boolean =>
  part.type.startsWith("tool-") && VIEW_OUTPUT_TOOLS.has(part.type.slice("tool-".length));

/**
 * The views of a message, in order, once each: from `data-view` parts while
 * it streams and from `show_view` and `open_view` tool outputs once it is
 * stored.
 */
export const viewsOf = (parts: readonly PartLike[]): ChatView[] => {
  const found = parts.flatMap((part) => {
    if (part.type === DATA_VIEW_PART) return [toChatView(part.data)];
    if (isViewToolPart(part) && part.state === "output-available")
      return [toChatView(part.output)];
    return [];
  });
  return [
    ...new Map(
      found.flatMap((view) => (view ? [[view.id, view] as const] : [])),
    ).values(),
  ];
};
