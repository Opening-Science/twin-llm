import "server-only";

import { cookies } from "next/headers";

import { type Locale, LOCALE_COOKIE, localeFromCookie } from "./locale";

/** The viewer's interface language, read from the request's cookie. */
export const serverLocale = async (): Promise<Locale> =>
  localeFromCookie((await cookies()).get(LOCALE_COOKIE)?.value);
