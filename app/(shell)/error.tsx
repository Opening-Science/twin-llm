"use client";

import { useEffect } from "react";

import { Button } from "@/infrastructure/ui-kit/button";

/**
 * Error boundary for screens inside the shell. The sidebar and top bar keep
 * rendering; only the failed screen is replaced by a plain explanation and a
 * retry. A failure in the shell layout itself is handled by
 * `app/global-error.tsx`, since a boundary never covers its own layout.
 *
 * In production React redacts the message, so the digest (which matches the
 * server log entry) is what gets logged here.
 */
type Props = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

const WarningMark = () => (
  <svg viewBox="0 0 20 20" className="size-4 shrink-0" aria-hidden>
    <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M10 5.5v5.5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
    />
    <circle cx="10" cy="14" r="1" fill="currentColor" />
  </svg>
);

const ShellError = ({ error, reset }: Props) => {
  useEffect(() => {
    console.error("[shell] screen failed", error.digest ?? error.name);
  }, [error]);

  return (
    <section
      role="alert"
      className="border-destructive/40 bg-destructive/8 mx-auto mt-16 w-full max-w-md rounded-xl border px-4 py-3.5 sm:mt-24"
    >
      <h2 className="text-destructive flex items-center gap-2 text-sm font-medium">
        <WarningMark />
        This screen couldn&rsquo;t load
      </h2>
      <p className="text-muted-foreground mt-1.5 text-sm leading-relaxed">
        The problem is on our side. Everything else in TwinLLM still works; trying again
        usually fixes it.
      </p>
      <Button className="mt-3" onClick={reset}>
        Try again
      </Button>
    </section>
  );
};

export default ShellError;
