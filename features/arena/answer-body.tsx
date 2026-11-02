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
import { ProfileFrameFooter, ProfileFrameHeader } from "./profile-frame";
import { ExplainabilityPanel } from "./explainability-panel";
import { streamingView } from "./streaming-view";
import type { ResponseState } from "./conversation";
import { numberLinkPieces, sourceCallIds, sourcesByText } from "./number-links";
import { type ActiveNumber, ToolSteps, toolCardTitleId } from "./tool-call-cards";
import { reviewStep } from "./tool-steps";

/** The step trace's line once the Answer section streams and no call runs. */
const WRITING_LINE = "Writing the answer…";

/** What streams below the steps: a status line until the Answer section starts. */
const StreamingAnswer = ({
  response,
  hasSteps,
}: {
  readonly response: Pick<ResponseState, "text" | "views"> &
    Partial<Pick<ResponseState, "id" | "profileFrame">>;
  /** The step trace above already says what is happening. */
  readonly hasSteps: boolean;
}) => {
  const view = streamingView(response.text);
  const frame = response.profileFrame ?? null;
  if (view.kind === "answer") {
    return (
      <>
        {frame !== null && <ProfileFrameHeader frame={frame} />}
        <RichText text={view.text} />
        <AnswerViews views={response.views ?? []} answerId={response.id} />
        {frame !== null && <ProfileFrameFooter frame={frame} />}
      </>
    );
  }
  return hasSteps ? null : (
    <p role="status" className="text-muted-foreground text-sm">
      {STREAM_STATUS_LINES[view.stage]}
    </p>
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
  Partial<Pick<ResponseState, "id" | "reviewing" | "profileFrame">>;

const SettledAnswer = ({
  response,
  wearables,
  decorate,
}: {
  readonly response: AnswerBodyResponse;
  readonly wearables: WearableSummaries;
  readonly decorate: DecorateText;
}) => {
  const parsed = parseTwinAnswer(response.text, wearables);
  const document = response.document ?? null;
  const withheld =
    document?.abstained === true ||
    document?.answer_class === "declined_decision_support";
  const shown = parsed.answerText || splitThinking(response.text).text;
  // A model can run its lookups and stop without writing anything.
  const silent = !withheld && shown.trim() === "";
  const frame = withheld ? null : (response.profileFrame ?? null);

  return (
    <>
      {frame !== null && <ProfileFrameHeader frame={frame} />}
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
      {frame !== null && <ProfileFrameFooter frame={frame} />}
      {response.status === "COMPLETE" && (
        <ExplainabilityPanel
          reasoningText={
            withheld ? null : (response.reasoningText ?? parsed.reasoningText)
          }
          attribution={response.attribution ?? parsed.attribution}
          document={document}
        />
      )}
    </>
  );
};

/** What a column says when the model wrote nothing after its lookups. */
export const noAnswerLine = (lookups: number): string =>
  lookups === 0
    ? "This model wrote no answer."
    : `This model ran ${lookups} ${lookups === 1 ? "lookup" : "lookups"} and wrote no answer. The steps above show what ${lookups === 1 ? "it" : "they"} returned.`;

/**
 * One column's answer. Its tool calls show as a step trace above it, live and
 * after a reload alike (`ToolSteps`): working while the answer streams,
 * folded into "Used N tools" once it settles. One component holds the trace
 * across the stream's end, so its timer sees the whole run. While it
 * streams, only a status line or the Answer section shows
 * (`streaming-view.ts`); with tool calls, the trace's own line stands in for
 * the status line. Once complete, when the response document says the model
 * abstained or declined, the answer text is withheld and only the panel
 * (with its abstain or declined banner) is shown. A missing or malformed
 * document leaves the answer exactly as it streamed.
 *
 * A finished answer's numbers that a tool call holds are buttons: pressing one
 * opens the trace and its card and lists the rows that hold it
 * (`number-links.ts`). Numbers with no source stay plain text.
 */
export const AnswerBody = ({
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
  const tools = response.tools ?? [];
  const streaming = response.status === "STREAMING";
  const view = streaming ? streamingView(response.text) : null;
  const decorate = linkedNumbers(byText, idPrefix, (text) =>
    setActive((was) => ({ text, key: (was?.key ?? 0) + 1 })),
  );

  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
      <ToolSteps
        cards={tools}
        status={response.status}
        workingLabel={
          view === null
            ? undefined
            : view.kind === "status"
              ? STREAM_STATUS_LINES[view.stage]
              : WRITING_LINE
        }
        numbers={sources ?? []}
        active={active}
        idPrefix={idPrefix}
        review={reviewStep(
          streaming && response.reviewing === true,
          response.document?.number_review,
        )}
      />
      {streaming ? (
        <StreamingAnswer
          response={response}
          hasSteps={tools.length > 0 || response.reviewing === true}
        />
      ) : (
        <SettledAnswer response={response} wearables={wearables} decorate={decorate} />
      )}
    </div>
  );
};
