"use client";

import { createContext, type ReactNode, useContext } from "react";

import { DEFAULT_LOCALE, type Locale, type Translated } from "./locale";

/**
 * The language the root layout read from the cookie, for client components.
 * The server passes it down, so the first render already has the right words.
 */

const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export const LocaleProvider = ({
  locale,
  children,
}: Readonly<{ locale: Locale; children: ReactNode }>) => (
  <LocaleContext value={locale}>{children}</LocaleContext>
);

export const useLocale = (): Locale => useContext(LocaleContext);

/** A feature's words in the current language. */
export const useCopy = <T,>(copy: Translated<T>): T => copy[useLocale()];
