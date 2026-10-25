import Link from "next/link";

import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";

import { conversationHref, trainingHref } from "./training-browser";
import { type ConversationView as View } from "./training-sets";

/**
 * One training conversation as a model would read it: the system prompt
 * (folded, it is the same in every record), the question, each tool call with
 * its arguments and the result the real tool returned, then the final answer.
 * Text is shown as written, in a monospace block, never rendered as markdown.
 */

const Block = ({ children }: { readonly children: React.ReactNode }) => (
  <pre className="bg-muted mt-2 overflow-x-auto rounded-lg p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
    {children}
  </pre>
);

export const ConversationView = ({
  set,
  index,
  conversation,
  total,
}: {
  readonly set: string;
  readonly index: number;
  readonly conversation: View;
  /** Conversations in the set, when the meta file says; null shows Next anyway. */
  readonly total: number | null;
}) => (
  <>
    <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
      <Link href={trainingHref(set)} className={buttonClassName({ size: "sm" })}>
        Back to {set}
      </Link>
      <div className="flex gap-2">
        {index > 0 && (
          <Link
            href={conversationHref(set, index - 1)}
            className={buttonClassName({ size: "sm" })}
          >
            Previous
          </Link>
        )}
        {(total === null || index + 1 < total) && (
          <Link
            href={conversationHref(set, index + 1)}
            className={buttonClassName({ size: "sm" })}
          >
            Next
          </Link>
        )}
      </div>
    </div>

    <Card as="section" padding="lg" className="mt-4 min-w-0">
      <h2 className="font-display text-xl">
        Conversation {index + 1}
        {total !== null && <span className="text-muted-foreground"> of {total}</span>}
      </h2>

      <details className="mt-4">
        <summary className="text-foreground cursor-pointer text-sm font-medium">
          System prompt
        </summary>
        <Block>{conversation.system}</Block>
      </details>

      <h3 className="text-eyebrow mt-5">User</h3>
      <Block>{conversation.user}</Block>

      {conversation.steps.length === 0 ? (
        <p className="text-muted-foreground mt-5 text-sm">
          No tool call in this conversation.
        </p>
      ) : (
        <ol className="mt-5 space-y-4">
          {conversation.steps.map((step, i) => (
            <li key={step.id} className="border-border rounded-lg border p-3">
              <p className="text-sm">
                <span className="text-muted-foreground font-mono text-xs">
                  Tool call {i + 1} ·{" "}
                </span>
                <span className="font-mono">{step.name}</span>
                {step.refusal && (
                  <span className="text-muted-foreground font-mono text-xs">
                    {" "}
                    · refused: {step.refusal}
                  </span>
                )}
              </p>
              <h4 className="text-eyebrow mt-3">Arguments</h4>
              <Block>{step.args}</Block>
              <h4 className="text-eyebrow mt-3">Result</h4>
              <Block>{step.result ?? "No result in the record."}</Block>
            </li>
          ))}
        </ol>
      )}

      <h3 className="text-eyebrow mt-5">
        Answer{conversation.refused ? " · declined" : ""}
      </h3>
      <Block>{conversation.answer}</Block>
    </Card>
  </>
);
