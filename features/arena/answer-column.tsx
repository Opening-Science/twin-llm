import type { WearableSummaries } from "@/infrastructure/parse-twin-answer";
import { Button } from "@/infrastructure/ui-kit/button";

import { AnswerBody } from "./answer-body";
import { AnswerStats } from "./answer-stats";
import type { ResponseState } from "./conversation";
import { Mark } from "./marks";

/**
 * One model's answer to one prompt: who answered, the answer itself (or why
 * there is none), and what the call measured. A failed column offers its own
 * retry, because the other models in the turn are independent of it.
 */

const FailedAnswer = ({
  lost,
  onRetry,
}: Readonly<{ lost: boolean; onRetry: () => void }>) => (
  <div role="alert" className="flex flex-col items-start gap-2 text-sm">
    <p className="text-destructive flex items-center gap-2 font-medium">
      <Mark name="alert" />
      {lost
        ? "The connection closed while this model was still working"
        : "No answer came back from this model"}
    </p>
    <p className="text-muted-foreground">
      The other answers are not affected. You can ask this model again.
    </p>
    <Button size="sm" onClick={onRetry}>
      Try again
    </Button>
  </div>
);

export const AnswerColumn = ({
  response,
  wearables,
  onRetry,
}: Readonly<{
  response: ResponseState;
  wearables: WearableSummaries;
  onRetry: () => void;
}>) => (
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
      <h3 id={`answer-${response.id}`} className="truncate text-[15px] font-medium">
        {response.modelName}
      </h3>
    </header>
    <div className="flex-1">
      {response.status === "FAILED" ? (
        <FailedAnswer lost={response.lost === true} onRetry={onRetry} />
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
