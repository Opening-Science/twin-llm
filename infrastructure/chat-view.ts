/**
 * A view in an answer: a chart the server drew from audited rows. The model
 * asks for one with `show_view`; it never writes a point. `features/chat`
 * builds views and streams them as `data-view` parts, `features/arena` reads
 * them back from the stream or from the stored `show_view` tool parts, so the
 * shape lives here. Pure, so the browser and the server share it.
 */

export const DATA_VIEW_PART = "data-view";
export const SHOW_VIEW_TOOL = "show_view";

export type ViewPoint = Readonly<{ at: string; value: number }>;

export type TimeseriesSpec = Readonly<{
  /** A LOINC code or a wearable key stem such as `sleep.score`. */
  measure: string;
  label: string;
  unit: string | null;
  window: Readonly<{ start: string; end: string }>;
  /** The synthetic subject_ref for a cohort measure; null for the user's wearables. */
  subject: string | null;
  /** In time order, exactly as the audited query returned them. Empty means no readings. */
  points: readonly ViewPoint[];
}>;

export type ChatView = Readonly<{
  id: string;
  kind: "chart.timeseries";
  title: string;
  spec: TimeseriesSpec;
  /** Audit `seq` of every query the points came from. */
  sourceAuditIds: readonly string[];
}>;

/** Deterministic, so the streamed part and the stored tool part name the same view. */
export const viewId = (sourceAuditIds: readonly string[]): string =>
  `view-${sourceAuditIds.join("-")}`;

export const timeseriesView = (
  input: Readonly<{
    spec: TimeseriesSpec;
    sourceAuditIds: readonly string[];
  }>,
): ChatView => ({
  id: viewId(input.sourceAuditIds),
  kind: "chart.timeseries",
  title: `${input.spec.label}, ${input.spec.window.start} to ${input.spec.window.end}`,
  spec: { ...input.spec, points: [...input.spec.points] },
  sourceAuditIds: [...input.sourceAuditIds],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPoint = (value: unknown): value is ViewPoint =>
  isRecord(value) &&
  typeof value.at === "string" &&
  typeof value.value === "number" &&
  Number.isFinite(value.value);

const isSpec = (value: unknown): value is TimeseriesSpec =>
  isRecord(value) &&
  typeof value.measure === "string" &&
  typeof value.label === "string" &&
  (value.unit === null || typeof value.unit === "string") &&
  isRecord(value.window) &&
  typeof value.window.start === "string" &&
  typeof value.window.end === "string" &&
  (value.subject === null || typeof value.subject === "string") &&
  Array.isArray(value.points) &&
  value.points.every(isPoint);

/** A view only when every field is there; a view without an audit source is not one. */
export const toChatView = (value: unknown): ChatView | null =>
  isRecord(value) &&
  typeof value.id === "string" &&
  value.kind === "chart.timeseries" &&
  typeof value.title === "string" &&
  isSpec(value.spec) &&
  Array.isArray(value.sourceAuditIds) &&
  value.sourceAuditIds.length > 0 &&
  value.sourceAuditIds.every((id) => typeof id === "string")
    ? (value as ChatView)
    : null;

type PartLike = Readonly<{
  type: string;
  data?: unknown;
  state?: string;
  output?: unknown;
}>;

/**
 * The views of a message, in order, once each: from `data-view` parts while
 * it streams and from `show_view` tool outputs once it is stored.
 */
export const viewsOf = (parts: readonly PartLike[]): ChatView[] => {
  const found = parts.flatMap((part) => {
    if (part.type === DATA_VIEW_PART) return [toChatView(part.data)];
    if (part.type === `tool-${SHOW_VIEW_TOOL}` && part.state === "output-available")
      return [toChatView(part.output)];
    return [];
  });
  return [
    ...new Map(
      found.flatMap((view) => (view ? [[view.id, view] as const] : [])),
    ).values(),
  ];
};
