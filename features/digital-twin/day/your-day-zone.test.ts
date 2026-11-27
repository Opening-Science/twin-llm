import { expect, test } from "bun:test";

import { YOUR_DAY_ZONE_COOKIE, yourDayZoneCookie, zoneFromCookie } from "./your-day-zone";

test("reads a valid IANA zone from the cookie", () => {
  expect(zoneFromCookie("Europe/Zurich")).toBe("Europe/Zurich");
  expect(zoneFromCookie("UTC")).toBe("UTC");
});

test("refuses an invalid zone in the cookie", () => {
  expect(zoneFromCookie("Mars/Olympus_Mons")).toBeNull();
  expect(zoneFromCookie("Europe/Zurich; Path=/")).toBeNull();
  expect(zoneFromCookie("")).toBeNull();
});

test("treats a missing cookie as no zone", () => {
  expect(zoneFromCookie(undefined)).toBeNull();
});

test("writes a session cookie limited to Your Day", () => {
  expect(yourDayZoneCookie("Europe/Zurich", false)).toBe(
    `${YOUR_DAY_ZONE_COOKIE}=Europe/Zurich; Path=/digital-twin/your-day; SameSite=Lax`,
  );
  expect(yourDayZoneCookie("Europe/Zurich", true)).toEndWith("; Secure");
  expect(yourDayZoneCookie("Europe/Zurich", true)).not.toContain("Max-Age");
});

test("writes UTC when the browser reports no usable zone", () => {
  expect(yourDayZoneCookie("", false)).toStartWith(`${YOUR_DAY_ZONE_COOKIE}=UTC;`);
});
