import type { Translated } from "@/infrastructure/locale/locale";

/**
 * The words of the page shown when the root or shell layout fails
 * (`app/global-error.tsx`), in English and German. That page has no
 * providers, so it reads the language from the cookie itself.
 */

export type GlobalErrorCopy = Readonly<{ title: string; line: string; reload: string }>;

export const GLOBAL_ERROR_COPY: Translated<GlobalErrorCopy> = {
  en: {
    title: "TwinLLM couldn’t load",
    line: "The problem is on our side. Reload the page to try again. If it keeps happening, whoever runs TwinLLM here can check what is missing.",
    reload: "Reload",
  },
  de: {
    title: "TwinLLM konnte nicht geladen werden",
    line: "Das Problem liegt bei uns. Lade die Seite neu, um es noch einmal zu versuchen. Wenn es wieder passiert, kann die Person, die TwinLLM hier betreibt, prüfen, was fehlt.",
    reload: "Neu laden",
  },
};
