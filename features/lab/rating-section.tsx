import Link from "next/link";

import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { Card } from "@/infrastructure/ui-kit/card";

/** The Lab's Second rating section: what it is and the way in (#351). */

const AGREEMENT_COMMAND = "bun run eval:agreement -- <run-id> [<run-id> …]";

export const RatingSection = () => (
  <Card padding="md" className="flex min-w-0 flex-col gap-3">
    <p className="text-sm leading-relaxed">
      For the hb runs in evaluation/runs/. Pick a pseudonym; the order of the answers
      follows from it, and you can stop and resume at any time.
    </p>
    <div className="flex flex-wrap gap-2">
      <Link
        href="/lab/rate"
        className={buttonClassName({ variant: "primary", size: "sm" })}
      >
        Open the rating view
      </Link>
    </div>
    <pre className="command-block" aria-label="Command that reports agreement">
      <code>{AGREEMENT_COMMAND}</code>
    </pre>
  </Card>
);
