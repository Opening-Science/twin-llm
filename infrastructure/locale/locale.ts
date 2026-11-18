/**
 * The interface language: English (the default) or German. The choice lives
 * in one cookie so the server renders the right words on the first paint and
 * `<html lang>` is right before any script runs. Pure; the root layout reads
 * the cookie and the language switch writes it.
 *
 * Only the interface's own words change. Model answers, stored data, the
 * docs and the research footer (binding text, checked word for word) stay as
 * they are, and numbers and dates keep the en-GB format.
 */

export const LOCALES = ["en", "de"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "twinllm-locale";

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Only the exact value `de` picks German; anything else, or nothing, is English. */
export const localeFromCookie = (value: string | undefined): Locale =>
  value === "de" ? "de" : DEFAULT_LOCALE;

/** The language in a `document.cookie` string, for a page outside the root layout. */
export const localeFromDocumentCookie = (cookie: string): Locale =>
  localeFromCookie(
    cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
      ?.slice(LOCALE_COOKIE.length + 1),
  );

/** The cookie as `document.cookie` takes it. */
export const localeCookie = (locale: Locale): string =>
  `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax`;

/** The `lang` attribute for `<html>`: British English or German. */
export const htmlLang = (locale: Locale): string => (locale === "de" ? "de" : "en-GB");

/** The language the switch offers: the one not in use. */
export const otherLocale = (locale: Locale): Locale => (locale === "de" ? "en" : "de");

/** One string per language; a feature keeps its own words in one of these. */
export type Translated<T> = Readonly<Record<Locale, T>>;
