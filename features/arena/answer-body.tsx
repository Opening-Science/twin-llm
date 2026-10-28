"use client";

import { type ReactNode, useId, useMemo, useState } from "react";

import type { NumberSource } from "@/infrastructure/number-sources";
import {
  parseTwinAnswer,
  type WearableSummaries,
} from "@/infrastructure/parse-twin-answer";
import { splitThinking } from "@/infrastructure/think-block";
import { UNVERIFIED_NARRATION } from "@/infrastructure/response-document/copy";
import { STREAM_STATUS_LINES } from "@/infrastructure/response-document/stream-copy";
import { type DecorateText, RichText } from "@/infrastructure/rich-text";

import { AnswerViews } from "./answer-views";
import { ExplainabilityPanel } from "./explainability-panel";
import { streamingView } from "./streaming-view";
import type { ResponseState } from "./conversation";
import { numberLinkPieces, sourceCallIds, sourcesByText } from "./number-links";
import { type ActiveNumber, ToolCallCards, toolCardTitleId } from "./tool-call-cards";

const StreamingAnswer = ({
  response,
}: {
  readonly response: Pick<ResponseState, "text" | "tools" | "views"> &
    Partial<Pick<ResponseState, "id">>;
}) => {
  const view = streamingView(response.text);
  const tools = response.tools ?? [];
  if (view.kind === "answer") {
    return (
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
        <ToolCallCards cards={tools} />
        <RichText text={view.text} />
        <AnswerViews views={response.views ?? []} answerId={response.id} />
      </div>
    );
  }
  const status = (
    <p role="status" className="text-muted-foreground text-sm">
      {STREAM_STATUS_LINES[view.stage]}
    </p>
  );
  return tools.length === 0 ? (
    status
  ) : (
    <div className="flex flex-col gap-3">
      <ToolCallCards cards={tools} />
      {status}
    </div>
  );
};

/**
 * A run of answer text with its sourced numbers as buttons. Each names the
 * card(s) it came from through `aria-describedby`; pressing it opens them.
 */
const linkedNumbers =
  (
    byText: ReadonlyMap<string, readonly NumberSource[]>,
    idPrefix: string,
    onOpen: (text: string) => void,
  ): DecorateText =>
  (text, key) =>
    numberLinkPieces(text, byText).map((piece, index): ReactNode =>
      typeof piece === "string" ? (
        piece
      ) : (
        <button
          key={`${key}-${index}`}
          type="button"
          className="number-link"
          aria-describedby={sourceCallIds(piece.sources)
            .map((id) => toolCardTitleId(idPrefix, id))
            .join(" ")}
          onClick={() => onOpen(piece.text)}
        >
          {piece.text}
        </button>
      ),
    );

type AnswerBodyResponse = Pick<
  ResponseState,
  | "status"
  | "text"
  | "reasoningText"
  | "attribution"
  | "document"
  | "tools"
  | "views"
  | "numberSources"
> &
  Partial<Pick<ResponseState, "id">>;

const SettledAnswer = ({
  response,
  wearables,
}: {
  readonly response: AnswerBodyResponse;
  readonly wearables: WearableSummaries;
}) => {
  const idPrefix = useId();
  const [active, setActive] = useState<ActiveNumber | null>(null);
  const sources = response.numberSources;
  const byText = useMemo(() => sourcesByText(sources ?? []), [sources]);

  const parsed = parseTwinAnswer(response.text, wearables);
  const document = response.document ?? null;
  const withheld =
    document?.abstained === true ||
    document?.answer_class === "declined_decision_support";
  const shown = parsed.answerText || splitThinking(response.text).text;
  // A model can run its lookups and stop without writing anything.
  const silent = !withheld && shown.trim() === "";
  const decorate = linkedNumbers(byText, idPrefix, (text) =>
    setActive((was) => ({ text, key: (was?.key ?? 0) + 1 })),
  );

  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
      <ToolCallCards
        cards={response.tools ?? []}
        numbers={sources ?? []}
        active={active}
        idPrefix={idPrefix}
      />
      {!withheld && !silent && document?.interpretation.kind === "narration" && (
        <p className="text-eyebrow">{UNVERIFIED_NARRATION}</p>
      )}
      {silent && (
        <p className="text-muted-foreground text-sm">
          {noAnswerLine(response.tools?.length ?? 0)}
        </p>
      )}
      {/* Prefer the Answer section when Twin structure is present; otherwise
          show the full reply, less any thinking a model leaked. */}
      {!withheld && !silent && <RichText text={shown} decorate={decorate} />}
      {!withheld && <AnswerViews views={response.views ?? []} answerId={response.id} />}
      {response.status === "COMPLETE" && (
        <ExplainabilityPanel
          reasoningText={
            withheld ? null : (response.reasoningText ?? parsed.reasoningText)
          }
          attribution={response.attribution ?? parsed.attribution}
          document={document}
        />
      )}
    </div>
  );
};

/** What a column says when the model wrote nothing after its lookups. */
export const noAnswerLine = (lookups: number): string =>
  lookups === 0
    ? "This model wrote no answer."
    : `This model ran ${lookups} ${lookups === 1 ? "lookup" : "lookups"} and wrote no answer. The cards above show what ${lookups === 1 ? "it" : "they"} returned.`;

/**
 * One column's answer. Its tool calls show as cards above it, live and after a
 * reload alike. While it streams, only a status line or the Answer section
 * shows (`streaming-view.ts`). Once complete, when the response
 * document says the model abstained or declined, the answer text is withheld
 * and only the panel (with its abstain or declined banner) is shown. A missing
 * or malformed document leaves the answer exactly as it streamed.
 *
 * A finished answer's numbers that a tool call holds are buttons: pressing one
 * opens its card and lists the rows that hold it (`number-links.ts`). Numbers
 * with no source stay plain text.
 */
export const AnswerBody = ({
  response,
  wearables,
}: {
  readonly response: AnswerBodyResponse;
  readonly wearables: WearableSummaries;
}) =>
  response.status === "STREAMING" ? (
    <StreamingAnswer response={response} />
  ) : (
    <SettledAnswer response={response} wearables={wearables} />
  );
