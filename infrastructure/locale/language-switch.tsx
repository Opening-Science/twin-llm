"use client";

import { useRouter } from "next/navigation";

import { cn } from "@/infrastructure/ui";

import { localeCookie, otherLocale, type Translated } from "./locale";
import { useLocale } from "./locale-provider";

/**
 * A round button beside the theme toggle that offers the other language. It
 * shows the code of the language it switches to, in that language, and its
 * label says the same in words. The cookie is written in the browser and the
 * server renders the page again, so the words change without a reload.
 */

const OFFER: Translated<Readonly<{ code: string; label: string }>> = {
  en: { code: "EN", label: "Switch to English" },
  de: { code: "DE", label: "Auf Deutsch umschalten" },
};

export const LanguageSwitch = ({ className }: Readonly<{ className?: string }>) => {
  const router = useRouter();
  const target = otherLocale(useLocale());
  const offer = OFFER[target];
  const switchTo = () => {
    document.cookie = localeCookie(target);
    router.refresh();
  };
  return (
    <button
      type="button"
      lang={target}
      aria-label={offer.label}
      title={offer.label}
      onClick={switchTo}
      className={cn(
        "border-border text-muted-foreground hover:border-input hover:text-foreground inline-flex size-9 items-center justify-center rounded-full border font-mono text-xs transition-colors",
        className,
      )}
    >
      {offer.code}
    </button>
  );
};
