"use client";

import { useEffect } from "react";

import { Button } from "@/infrastructure/ui-kit/button";
import { WarningIcon } from "@/infrastructure/ui-kit/nav-icons";

/**
 * What a shell page shows when it fails to render: only the page is
 * replaced, so the sidebar, the button and the footer stay. The error's
 * message is never shown; the console gets its digest or its name.
 */

export const SCREEN_ERROR_COPY = {
  title: "This screen couldn't load",
  line: "The problem is on our side. Everything else still works, and trying again usually helps.",
  retry: "Try again",
} as const;

export const ScreenError = ({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) => {
  useEffect(() => {
    console.error("[shell] screen failed", error.digest ?? error.name);
  }, [error]);

  return (
    <div className="page-form">
      <div
        role="alert"
        className="border-destructive/40 bg-destructive/5 mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border p-6 text-center"
      >
        <WarningIcon className="text-destructive size-6" />
        <h1 className="text-lg font-medium">{SCREEN_ERROR_COPY.title}</h1>
        <p className="text-muted-foreground text-sm">{SCREEN_ERROR_COPY.line}</p>
        <Button variant="secondary" onClick={reset}>
          {SCREEN_ERROR_COPY.retry}
        </Button>
      </div>
    </div>
  );
};
