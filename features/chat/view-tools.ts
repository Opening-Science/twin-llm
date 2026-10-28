import "server-only";

import { tool } from "ai";
import type { z } from "zod";

import {
  type ChatView,
  LIST_VIEWS_TOOL,
  OPEN_VIEW_TOOL,
  viewIsPersonal,
  viewReadings,
  viewSubject,
} from "@/infrastructure/chat-view";
import { modelInputSchema } from "@/packages/query-tools/model-schema";
import { defaultQueryToolPorts, type QueryToolPorts } from "@/packages/query-tools/ports";
import type { SessionScope } from "@/packages/query-tools/scope";
import {
  listViewsInput,
  openViewInput,
  VIEW_TOOL_DEFINITIONS,
} from "@/packages/query-tools/view-schema";

import { modelNoteOf } from "./show-view-tool";
import type { ThreadView } from "./thread-views";

/**
 * `list_views` and `open_view`: "show my sleep chart again" reopens the view
 * the thread already has instead of querying again. `open_view` returns the
 * stored view unchanged, so its points are the rows the first audited query
 * returned, and `twin-ui-stream.ts` streams it as a `data-view` part like a
 * new one. Both calls are audited: `open_view` as a read of the stored view
 * (its subject, its point count), `list_views` with the titles it listed.
 *
 * A synthetic request is never offered a view of the person's own wearables,
 * and a skill turn only the kinds its skill allows.
 */

export type ViewToolDeps = Readonly<{
  scope: SessionScope;
  /** Only `appendAudit` is used. */
  ports?: QueryToolPorts;
  /** The views of the thread this audit session's turn belongs to, newest first. */
  loadViews: (sessionId: string) => Promise<readonly ThreadView[]>;
  /** True when this request may carry personal data (`requestDataMode`). */
  personal: boolean;
  /** View kinds this turn may show (a skill's `views`); left out, every kind. */
  views?: readonly string[];
}>;

export type ViewListEntry = Readonly<{
  id: string;
  title: string;
  kind: ChatView["kind"];
  model: string;
  at: string | null;
}>;

export type ListViewsOutput = Readonly<{ views: readonly ViewListEntry[] }>;

export const VIEW_NOT_FOUND = {
  code: "VIEW_NOT_FOUND",
  error: "no view with that id in this thread; call list_views for the ids",
} as const;

export type OpenViewOutput = ChatView | typeof VIEW_NOT_FOUND;

const offered = async (deps: ViewToolDeps): Promise<readonly ThreadView[]> =>
  (await deps.loadViews(deps.scope.sessionId)).filter(
    (entry) =>
      (deps.personal || !viewIsPersonal(entry.view)) &&
      (deps.views === undefined || deps.views.includes(entry.view.kind)),
  );

const appendAudit = (deps: ViewToolDeps) =>
  (deps.ports ?? defaultQueryToolPorts()).appendAudit;

export const runListViews = async (
  deps: ViewToolDeps,
  input: z.infer<typeof listViewsInput>,
): Promise<ListViewsOutput> => {
  const output: ListViewsOutput = {
    views: (await offered(deps)).map((entry) => ({
      id: entry.view.id,
      title: entry.view.title,
      kind: entry.view.kind,
      model: entry.modelName,
      at: entry.at,
    })),
  };
  await appendAudit(deps)({
    actor: deps.scope.actor,
    sessionId: deps.scope.sessionId,
    subjectRef: null,
    tool: LIST_VIEWS_TOOL,
    args: input,
    result: output,
    rowCount: output.views.length,
  });
  return output;
};

export const runOpenView = async (
  deps: ViewToolDeps,
  input: z.infer<typeof openViewInput>,
): Promise<OpenViewOutput> => {
  const found = (await offered(deps)).find((entry) => entry.view.id === input.id);
  const output: OpenViewOutput = found?.view ?? VIEW_NOT_FOUND;
  await appendAudit(deps)({
    actor: deps.scope.actor,
    sessionId: deps.scope.sessionId,
    subjectRef: found ? viewSubject(found.view) : null,
    tool: OPEN_VIEW_TOOL,
    args: input,
    result: output,
    rowCount: found ? viewReadings(found.view) : 0,
  });
  return output;
};

const definition = (name: string) => {
  const found = VIEW_TOOL_DEFINITIONS.find((entry) => entry.name === name);
  if (!found) throw new Error(`no view tool definition named ${name}`);
  return found;
};

export const createViewTools = (deps: ViewToolDeps) => ({
  [LIST_VIEWS_TOOL]: tool({
    description: definition(LIST_VIEWS_TOOL).description,
    inputSchema: modelInputSchema(listViewsInput),
    execute: async (input): Promise<ListViewsOutput> => runListViews(deps, input),
  }),
  [OPEN_VIEW_TOOL]: tool({
    description: definition(OPEN_VIEW_TOOL).description,
    inputSchema: modelInputSchema(openViewInput),
    execute: async (input): Promise<OpenViewOutput> => runOpenView(deps, input),
    toModelOutput: ({ output }) => ({ type: "json", value: modelNoteOf(output) }),
  }),
});
