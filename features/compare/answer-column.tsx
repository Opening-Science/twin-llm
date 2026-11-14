"use client";

import { type ReactNode, useId, useState } from "react";

import type { CatalogModel } from "@/infrastructure/model-catalog";
import { UNVERIFIED_NARRATION } from "@/infrastructure/response-document/copy";
import { STREAM_STATUS_LINES } from "@/infrastructure/response-document/stream-copy";
import { RichText } from "@/infrastructure/rich-text";
import { Button } from "@/infrastructure/ui-kit/button";
import type { TwinFocusId } from "@/packages/anatomy/twin-focus";

import { AnswerViews } from "./answer-views";
import {
  finishedAnswer,
  isWithheld,
  silentAnswerLine,
  stoppedAnswerText,
  streamingView,
} from "./answer-text";
import { ColumnHeader } from "./column-header";
import { answerEffortLine, autoLine, traceStateOf } from "./column-lines";
import type { AnswerState } from "./conversation";
import { EvidencePanel } from "./evidence-panel";
import { hasPanel } from "./evidence-lines";
import { numbersByCall } from "./number-links";
import { NumberText } from "./number-text";
import { ProfileFooter, ProfileHeader } from "./profile-frame";
import { StatsFooter } from "./stats-footer";
import { type Reveal, ToolSteps } from "./tool-steps";

/**
 * One answerer's column in a turn (SPEC 2.4–2.7, 4–6): who answered, the
 * steps it took, the answer or why there is none, and once finished its
 * reasoning, evidence and measured figures. Columns are independent: "Try
 * again" resets only this one.
 */

export const WRITING_THE_ANSWER = "Writing the answer…";
export const NOT_RUN_HEADING = "This model did not run";
export const FAILED_HEADING = "No answer came back from this model.";
export const FAILED_LINE =
  "The other answers are not affected, and this model can be asked again.";
export const LOST_HEADING = "The connection closed while this model was still working.";
export const LOST_LINE =
  "The server keeps going and stores the answer; reload the thread to read it, or ask this model again.";
export const STOPPED_HEADING = "You stopped this answer";
export const STOPPED_LINE =
  "Anything it had already written stays here, and this model can be asked again.";

const StatusLine = ({ text }: Readonly<{ text: string }>) => (
  <p role="status" className="text-muted-foreground text-sm">
    {text}
  </p>
);

const WarningMark = () => (
  <span
    aria-hidden="true"
    className="border-destructive text-destructive flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] leading-none font-bold"
  >
    !
  </span>
);

const Notice = ({
  role,
  heading,
  line,
  warning,
  onRetry,
}: Readonly<{
  role: "alert" | "status";
  heading: string;
  line: ReactNode;
  warning: boolean;
  onRetry: () => void;
}>) => (
  <div role={role} className="flex flex-col items-start gap-2 text-sm">
    <p className="flex items-center gap-2 font-medium">
      {warning ? <WarningMark /> : null}
      {heading}
    </p>
    <div className="text-muted-foreground">{line}</div>
    <Button size="sm" onClick={onRetry}>
      Try again
    </Button>
  </div>
);

export const AnswerColumn = ({
  answer,
  prompt,
  catalog,
  onRetry,
  onOrganPick,
}: Readonly<{
  answer: AnswerState;
  prompt: string;
  catalog: readonly CatalogModel[] | null;
  onRetry: () => void;
  onOrganPick?: (organ: TwinFocusId) => void;
}>) => {
  const prefix = useId();
  const headingId = `${prefix}-name`;
  const [reveal, setReveal] = useState<Reveal | null>(null);

  const tools = answer.tools ?? [];
  const views = answer.views ?? [];
  const document = answer.document ?? null;
  const withheld = isWithheld(document);
  const streaming = answer.status === "STREAMING";
  const complete = answer.status === "COMPLETE";
  const frame = answer.profileFrame ?? null;

  const numberCheck =
    answer.reviewing === true || document?.number_review !== undefined
      ? { running: answer.reviewing === true, review: document?.number_review ?? null }
      : null;
  const showTrace = tools.length > 0 || numberCheck !== null;

  const live = streaming ? streamingView(answer.text) : null;
  const viewProps = {
    answerId: answer.id,
    views,
    ...(onOrganPick === undefined ? {} : { onOrganPick }),
  };

  const traceLabel =
    live?.kind === "answer" ? WRITING_THE_ANSWER : STREAM_STATUS_LINES.waiting;

  const body = (): ReactNode => {
    if (live !== null) {
      if (live.kind !== "answer") {
        return showTrace ? null : (
          <StatusLine
            text={
              live.kind === "waiting"
                ? STREAM_STATUS_LINES.waiting
                : STREAM_STATUS_LINES.preparing
            }
          />
        );
      }
      return (
        <>
          {frame === null ? null : <ProfileHeader frame={frame} />}
          <RichText text={live.text} />
          <AnswerViews {...viewProps} />
          {frame === null ? null : <ProfileFooter frame={frame} />}
        </>
      );
    }

    if (answer.stopped === true) {
      const written = stoppedAnswerText(answer.text);
      return (
        <>
          {written === "" ? null : <RichText text={written} />}
          {written !== "" || tools.length > 0 ? <AnswerViews {...viewProps} /> : null}
          <Notice
            role="status"
            heading={STOPPED_HEADING}
            line={STOPPED_LINE}
            warning={false}
            onRetry={onRetry}
          />
        </>
      );
    }

    if (answer.refusal !== undefined) {
      return (
        <Notice
          role="alert"
          heading={NOT_RUN_HEADING}
          line={answer.refusal}
          warning
          onRetry={onRetry}
        />
      );
    }

    if (!complete) {
      return answer.lost === true ? (
        <Notice
          role="alert"
          heading={LOST_HEADING}
          line={LOST_LINE}
          warning
          onRetry={onRetry}
        />
      ) : (
        <Notice
          role="alert"
          heading={FAILED_HEADING}
          line={FAILED_LINE}
          warning
          onRetry={onRetry}
        />
      );
    }

    if (withheld) return null;
    const text = finishedAnswer(answer.text).answer;
    if (text === "") {
      return (
        <p className="text-muted-foreground text-sm">{silentAnswerLine(tools.length)}</p>
      );
    }
    return (
      <>
        {frame === null ? null : <ProfileHeader frame={frame} />}
        {document?.interpretation.kind === "narration" ? (
          <p className="text-eyebrow">{UNVERIFIED_NARRATION}</p>
        ) : null}
        <NumberText
          text={text}
          sources={answer.numberSources ?? []}
          prefix={prefix}
          cardIds={tools.map((card) => card.id)}
          onPress={(link) =>
            setReveal((was) => ({
              key: (was?.key ?? 0) + 1,
              number: link.text,
              callIds: link.callIds,
            }))
          }
        />
        <AnswerViews {...viewProps} />
        {frame === null ? null : <ProfileFooter frame={frame} />}
      </>
    );
  };

  const attribution = answer.attribution ?? [];
  const reasoning = withheld ? null : answer.reasoningText;
  const panel =
    complete && hasPanel({ reasoning, attribution, document }) ? (
      <EvidencePanel
        reasoning={reasoning}
        attribution={attribution}
        document={document}
        withheld={withheld}
      />
    ) : null;

  return (
    <section
      aria-labelledby={headingId}
      aria-busy={streaming || undefined}
      className="flex min-w-0 flex-col gap-4 p-4 sm:p-5"
    >
      <ColumnHeader
        headingId={headingId}
        modelId={answer.modelId}
        modelName={answer.modelName}
        autoLine={autoLine(answer, prompt, catalog)}
        effortLine={answerEffortLine(document)}
      />
      {showTrace ? (
        <ToolSteps
          prefix={prefix}
          tools={tools}
          state={traceStateOf(answer)}
          workingLabel={traceLabel}
          numberCheck={numberCheck}
          numbersByCall={numbersByCall(
            complete && !withheld ? (answer.numberSources ?? []) : [],
          )}
          reveal={reveal}
        />
      ) : null}
      {/* Grows so footers line up; an empty body (a withheld answer) adds no gap. */}
      <div className="flex flex-1 flex-col gap-4 text-sm empty:-mt-4">{body()}</div>
      {panel}
      {complete && answer.metrics !== null ? (
        <StatsFooter metrics={answer.metrics} />
      ) : null}
    </section>
  );
};
