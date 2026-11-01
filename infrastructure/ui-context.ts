import { z } from "zod";

import type { AppendInput } from "@/packages/audit/append";
import { TWIN_FOCUS_IDS, type TwinFocusId } from "@/packages/anatomy/twin-focus";
import { VIEW_KINDS } from "@/packages/query-tools/view-schema";

import type { ChatView } from "./chat-view";

/**
 * The UI context of a turn (#47): what the person had on screen as they asked,
 * so "why is this high?" with a card open needs no restating. It is a short,
 * closed structure: which panels are open, the organ picked on the twin, the
 * chart shown large with its date range, and the views the thread already
 * has, by kind and measure. It never carries a value, a title or any text the
 * person wrote; measures are codes and keys, dates are calendar days.
 *
 * The browser builds it (`buildUiContext`), the server checks it with the
 * schema, writes it to the audit chain as `ui.context` (hashed, as every row
 * is), puts it in the system prompt only as `uiContextBlock`, and stores it on
 * the response document so the explainability panel shows it. Pure, so the
 * browser and the server share it.
 */

export const UI_PANELS = ["outputs", "twin"] as const;

export type UiPanel = (typeof UI_PANELS)[number];

/** Views listed by kind and measure, newest first; older ones only count. */
export const UI_CONTEXT_MAX_VIEWS = 4;

/** The block in the system prompt is never longer than this. */
export const UI_CONTEXT_MAX_CHARS = 600;

/** The audit row's tool name. It records the block; it reads nothing. */
export const UI_CONTEXT_AUDIT_TOOL = "ui.context";

/** A LOINC code, a wearable key stem or a focus id: no spaces, no values. */
const MEASURE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const viewRefSchema = z
  .object({ kind: z.enum(VIEW_KINDS), measure: z.string().regex(MEASURE) })
  .strict();

const chartSchema = z
  .object({
    kind: z.enum(VIEW_KINDS),
    measure: z.string().regex(MEASURE),
    start: z.string().regex(DAY),
    end: z.string().regex(DAY),
  })
  .strict();

const uiContextShape = z
  .object({
    panels: z.array(z.enum(UI_PANELS)).max(UI_PANELS.length),
    organ: z.enum(TWIN_FOCUS_IDS).nullable(),
    chart: chartSchema.nullable(),
    views: z.array(viewRefSchema).max(UI_CONTEXT_MAX_VIEWS),
    /** Every view in the thread, including those not listed. */
    viewCount: z.number().int().min(0).max(9999),
  })
  .strict();

export type UiContext = z.infer<typeof uiContextShape>;

type ViewRef = UiContext["views"][number];

const viewRefText = (view: ViewRef): string => `${view.kind} ${view.measure}`;

/** The block's lines after its heading, one per part that is set. */
export const uiContextLines = (context: UiContext): readonly string[] => [
  ...(context.panels.length > 0 ? [`- open: ${context.panels.join(", ")}`] : []),
  ...(context.organ === null ? [] : [`- organ: ${context.organ}`]),
  ...(context.chart === null
    ? []
    : [
        `- chart: ${viewRefText(context.chart)}, ${context.chart.start} to ${context.chart.end}`,
      ]),
  ...(context.viewCount > 0
    ? [
        `- views in this thread (${context.viewCount}, newest first): ${
          context.views.length > 0
            ? context.views.map(viewRefText).join("; ")
            : "none listed"
        }`,
      ]
    : []),
];

const BLOCK_HEADING = [
  "## UI context",
  'What the person has on screen as they ask; no values. Read "this" or "it" against it.',
];

/** The system prompt's block: a heading and the lines, or nothing when no line is set. */
export const uiContextBlock = (context: UiContext): string => {
  const lines = uiContextLines(context);
  return lines.length === 0 ? "" : [...BLOCK_HEADING, ...lines].join("\n");
};

export const uiContextSchema = uiContextShape
  .refine((context) => context.views.length <= context.viewCount, {
    message: "viewCount counts every listed view",
  })
  .refine((context) => uiContextBlock(context).length <= UI_CONTEXT_MAX_CHARS, {
    message: `the UI context block is longer than ${UI_CONTEXT_MAX_CHARS} characters`,
  });

/** What the screen knows, before it is cut down to a context. */
export type UiState = Readonly<{
  outputsOpen: boolean;
  twinOpen: boolean;
  organ: TwinFocusId | null;
  /** The view drawn large in the Outputs panel, if any. */
  largeView: ChatView | null;
  /** The thread's views, newest first. */
  views: readonly ChatView[];
}>;

/** The code or key a view draws; a twin view's focus. */
const measureOf = (view: ChatView): string =>
  view.kind === "twin.body" ? view.spec.focus : view.spec.measure;

const viewRefOf = (view: ChatView): ViewRef | null => {
  const measure = measureOf(view);
  return MEASURE.test(measure) ? { kind: view.kind, measure } : null;
};

/**
 * A compare chart's range runs from its earlier window to its later one; a
 * twin view may have none, and a map of population estimates has none.
 */
const rangeOf = (view: ChatView): Readonly<{ start: string; end: string }> | null => {
  if (view.kind === "chart.compare") {
    return { start: view.spec.before.start, end: view.spec.after.end };
  }
  return view.kind === "map.choropleth" ? null : view.spec.window;
};

const chartOf = (view: ChatView | null): UiContext["chart"] => {
  if (view === null) return null;
  const ref = viewRefOf(view);
  const range = rangeOf(view);
  // A twin view without a window has no days to name.
  if (range === null) return null;
  const start = range.start.slice(0, 10);
  const end = range.end.slice(0, 10);
  return ref !== null && DAY.test(start) && DAY.test(end) ? { ...ref, start, end } : null;
};

/**
 * The context of what is on screen, or null when nothing is: no panel open,
 * no organ picked and no views. Views that do not fit the block are counted
 * but not listed, so the block stays under its size whatever the thread holds.
 */
export const buildUiContext = (state: UiState): UiContext | null => {
  const listed = state.views
    .flatMap((view) => {
      const ref = viewRefOf(view);
      return ref === null ? [] : [ref];
    })
    .filter(
      (ref, index, all) =>
        all.findIndex(
          (other) => other.kind === ref.kind && other.measure === ref.measure,
        ) === index,
    );
  const base: UiContext = {
    panels: UI_PANELS.filter((panel) =>
      panel === "outputs" ? state.outputsOpen : state.twinOpen,
    ),
    organ: state.organ,
    chart: chartOf(state.largeView),
    views: listed.slice(0, UI_CONTEXT_MAX_VIEWS),
    viewCount: Math.min(state.views.length, 9999),
  };
  const fitted = fitBlock(base);
  return uiContextLines(fitted).length === 0 ? null : fitted;
};

/** Drops listed views from the oldest end until the block fits. */
const fitBlock = (context: UiContext): UiContext =>
  uiContextBlock(context).length <= UI_CONTEXT_MAX_CHARS || context.views.length === 0
    ? context
    : fitBlock({ ...context, views: context.views.slice(0, -1) });

/**
 * The audit row for one answer's context: the context itself is the row's
 * arguments, so the chain holds its hash and never its text.
 */
export const uiContextEvent = (
  context: UiContext,
  call: Readonly<{ actor: string; sessionId: string; modelId: string }>,
): AppendInput => ({
  actor: call.actor,
  sessionId: call.sessionId,
  subjectRef: null,
  tool: UI_CONTEXT_AUDIT_TOOL,
  args: { modelId: call.modelId, context },
  result: { lines: uiContextLines(context).length },
  rowCount: 0,
});
