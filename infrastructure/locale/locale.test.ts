import { describe, expect, test } from "bun:test";

import {
  htmlLang,
  LOCALE_COOKIE,
  localeCookie,
  localeFromCookie,
  localeFromDocumentCookie,
  otherLocale,
} from "./locale";

describe("otherLocale", () => {
  test("offers German from English and English from German", () => {
    expect(otherLocale("en")).toBe("de");
    expect(otherLocale("de")).toBe("en");
  });
});

describe("localeFromCookie", () => {
  test("only `de` picks German", () => {
    expect(localeFromCookie("de")).toBe("de");
    expect(localeFromCookie("en")).toBe("en");
  });

  test("a missing, empty or unknown value is English", () => {
    expect(localeFromCookie(undefined)).toBe("en");
    expect(localeFromCookie("")).toBe("en");
    expect(localeFromCookie("DE")).toBe("en");
    expect(localeFromCookie("fr")).toBe("en");
  });
});

describe("localeCookie", () => {
  test("is site-wide, kept for a year and sent on same-site requests", () => {
    expect(localeCookie("de")).toBe(
      `${LOCALE_COOKIE}=de; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
  });

  test("round-trips through localeFromCookie", () => {
    for (const locale of ["en", "de"] as const) {
      const value = localeCookie(locale).split(";")[0]?.split("=")[1];
      expect(localeFromCookie(value)).toBe(locale);
    }
  });
});

describe("htmlLang", () => {
  test("British English by default, German when chosen", () => {
    expect(htmlLang("en")).toBe("en-GB");
    expect(htmlLang("de")).toBe("de");
  });
});

describe("localeFromDocumentCookie", () => {
  test("finds the language among other cookies", () => {
    expect(localeFromDocumentCookie("twinllm-sidebar=pinned; twinllm-locale=de")).toBe(
      "de",
    );
    expect(localeFromDocumentCookie("twinllm-locale=de")).toBe("de");
  });

  test("is English without the cookie, or for a cookie that only ends in its name", () => {
    expect(localeFromDocumentCookie("")).toBe("en");
    expect(localeFromDocumentCookie("twinllm-locale=en; a=b")).toBe("en");
    expect(localeFromDocumentCookie("other-twinllm-locale=de")).toBe("en");
  });
});
