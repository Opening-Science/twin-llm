"use client";

import { useEffect } from "react";

import { htmlLang, type Translated } from "@/infrastructure/locale/locale";
import { useLocale } from "@/infrastructure/locale/locale-provider";
import { Button } from "@/infrastructure/ui-kit/button";
import { WarningIcon } from "@/infrastructure/ui-kit/nav-icons";

/**
 * What a shell page shows when it fails to render: only the page is
 * replaced, so the sidebar, the button and the footer stay. The error's
 * message is never shown; the console gets its digest or its name.
 */

export type ScreenErrorCopy = Readonly<{ title: string; line: string; retry: string }>;

export const SCREEN_ERROR_COPY: Translated<ScreenErrorCopy> = {
  en: {
    title: "This screen couldn't load",
    line: "The problem is on our side. Everything else still works, and trying again usually helps.",
    retry: "Try again",
  },
  de: {
    title: "Diese Ansicht konnte nicht geladen werden",
    line: "Das Problem liegt bei uns. Alles andere funktioniert weiter, und ein neuer Versuch hilft meistens.",
    retry: "Erneut versuchen",
  },
};

export const ScreenError = ({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) => {
  const locale = useLocale();
  const copy = SCREEN_ERROR_COPY[locale];
  useEffect(() => {
    console.error("[shell] screen failed", error.digest ?? error.name);
  }, [error]);

  // In the main region, which is marked English; this message has its own language.
  return (
    <div className="page-form" lang={htmlLang(locale)}>
      <div
        role="alert"
        className="border-destructive/40 bg-destructive/5 mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border p-6 text-center"
      >
        <WarningIcon className="text-destructive size-6" />
        <h1 className="text-lg font-medium">{copy.title}</h1>
        <p className="text-muted-foreground text-sm">{copy.line}</p>
        <Button variant="secondary" onClick={reset}>
          {copy.retry}
        </Button>
      </div>
    </div>
  );
};
