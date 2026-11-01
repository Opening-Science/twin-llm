import type { WearableSummaries } from "@/infrastructure/parse-twin-answer";
import { Button } from "@/infrastructure/ui-kit/button";

import { AnswerBody } from "./answer-body";
import { autoLineOf, columnRawId, effortLineOf, STOPPED_COPY } from "./answer-header";
import { AnswerStats } from "./answer-stats";
import type { ResponseState } from "./conversation";
import { Mark } from "./marks";

/**
 * One model's answer to one prompt: who answered, the answer itself (or why
 * there is none), and what the call measured. A fine-tune's raw id sits
 * under its readable name, and an Auto answer says which agent it ran as. A
 * failed column offers its own retry, because the other models in the turn
 * are independent of it.
 */

const FailedAnswer = ({
  lost,
  stopped,
  refusal,
  onRetry,
}: Readonly<{
  lost: boolean;
  stopped: boolean;
  refusal?: string;
  onRetry: () => void;
}>) => (
  <div
    role={stopped ? "status" : "alert"}
    className="flex flex-col items-start gap-2 text-sm"
  >
    <p
      className={
        stopped
          ? "flex items-center gap-2 font-medium"
          : "text-destructive flex items-center gap-2 font-medium"
      }
    >
      {stopped ? null : <Mark name="alert" />}
      {refusal !== undefined
        ? "This model did not run"
        : stopped
          ? STOPPED_COPY.title
          : lost
            ? "The connection closed while this model was still working"
            : "No answer came back from this model"}
    </p>
    <p className="text-muted-foreground">
      {refusal ??
        (stopped
          ? STOPPED_COPY.body
          : "The other answers are not affected. You can ask this model again.")}
    </p>
    <Button size="sm" onClick={onRetry}>
      Try again
    </Button>
  </div>
);

export const AnswerColumn = ({
  response,
  prompt,
  wearables,
  onRetry,
  modelNameOf,
}: Readonly<{
  response: ResponseState;
  /** The model a specialist runs on, for the Auto line (#366). */
  modelNameOf?: (agentId: string) => string | null;
  /** The turn's prompt, for the line that says why Auto chose its agent. */
  prompt: string;
  wearables: WearableSummaries;
  onRetry: () => void;
}>) => {
  const rawId = columnRawId(response.modelId);
  const autoLine = autoLineOf(response, prompt, modelNameOf);
  const effortLine = effortLineOf(response.document);
  return (
    <article
      aria-labelledby={`answer-${response.id}`}
      className="flex min-w-0 flex-col gap-4 p-4 sm:p-5"
    >
      <header className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="border-input text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] uppercase"
        >
          {response.modelName.charAt(0)}
        </span>
        <span className="flex min-w-0 flex-col">
          <h3 id={`answer-${response.id}`} className="truncate text-[15px] font-medium">
            {response.modelName}
          </h3>
          {rawId === null ? null : (
            <span className="text-muted-foreground truncate font-mono text-xs">
              {rawId}
            </span>
          )}
        </span>
      </header>
      {autoLine === null ? null : (
        <p className="text-muted-foreground text-xs">{autoLine}</p>
      )}
      {effortLine === null ? null : (
        <p className="text-muted-foreground text-xs">{effortLine}</p>
      )}
      <div className="flex-1">
        {response.status === "FAILED" ? (
          <FailedAnswer
            lost={response.lost === true}
            stopped={response.stopped === true}
            refusal={response.refusal}
            onRetry={onRetry}
          />
        ) : (
          <AnswerBody response={response} wearables={wearables} />
        )}
      </div>
      {response.status === "COMPLETE" && response.metrics && (
        <footer className="border-border border-t pt-3">
          <AnswerStats metrics={response.metrics} />
        </footer>
      )}
    </article>
  );
};
