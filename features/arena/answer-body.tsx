"use client";

import {
  parseTwinAnswer,
  type WearableSummaries,
} from "@/infrastructure/parse-twin-answer";
import { UNVERIFIED_NARRATION } from "@/infrastructure/response-document/copy";
import {
  STREAM_STATUS_LINES,
  TOOL_PHASE_LINES,
} from "@/infrastructure/response-document/stream-copy";
import { RichText } from "@/infrastructure/rich-text";

import { AnswerViews } from "./answer-views";
import { ExplainabilityPanel } from "./explainability-panel";
import { streamingView, toolPhase } from "./streaming-view";
import type { ResponseState } from "./conversation";

const StreamingAnswer = ({
  response,
}: {
  readonly response: Pick<ResponseState, "text" | "tools" | "views">;
}) => {
  const view = streamingView(response.text);
  if (view.kind === "answer") {
    return (
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
        <RichText text={view.text} />
        <AnswerViews views={response.views ?? []} />
      </div>
    );
  }
  const phase = toolPhase(response.tools ?? []);
  return (
    <p role="status" className="text-muted-foreground text-sm">
      {phase ? TOOL_PHASE_LINES[phase] : STREAM_STATUS_LINES[view.stage]}
    </p>
  );
};

/**
 * One column's answer. While it streams, only a status line or the Answer
 * section shows (`streaming-view.ts`). Once complete, when the response
 * document says the model abstained or declined, the answer text is withheld
 * and only the panel (with its abstain or declined banner) is shown. A missing
 * or malformed document leaves the answer exactly as it streamed.
 */
export const AnswerBody = ({
  response,
  wearables,
}: {
  readonly response: Pick<
    ResponseState,
    "status" | "text" | "reasoningText" | "attribution" | "document" | "tools" | "views"
  >;
  readonly wearables: WearableSummaries;
}) => {
  if (response.status === "STREAMING") return <StreamingAnswer response={response} />;

  const parsed = parseTwinAnswer(response.text, wearables);
  const document = response.document ?? null;
  const withheld =
    document?.abstained === true ||
    document?.answer_class === "declined_decision_support";

  return (
    <div className="flex flex-col gap-3 text-[15px] leading-relaxed">
      {!withheld && document?.interpretation.kind === "narration" && (
        <p className="text-eyebrow">{UNVERIFIED_NARRATION}</p>
      )}
      {/* Prefer the Answer section when Twin structure is present; otherwise
          show the full reply. */}
      {!withheld && <RichText text={parsed.answerText || response.text} />}
      {!withheld && <AnswerViews views={response.views ?? []} />}
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
