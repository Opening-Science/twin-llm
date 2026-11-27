import { isTimeZone } from "@/packages/query-tools/replay/local-time";

/**
 * Personal replay cuts days in the viewer's time zone, which only the browser
 * knows. The browser hands it over in a first-party cookie rather than the
 * query string, so the zone stays out of history, logs and shared links.
 */
export const YOUR_DAY_ZONE_COOKIE = "twinllm-your-day-zone";

/** Only the Your Day page reads the zone, so the cookie goes nowhere else. */
export const YOUR_DAY_PATH = "/digital-twin/your-day";

/** The zone in the cookie, or null when it is missing or not an IANA zone. */
export const zoneFromCookie = (value: string | undefined): string | null =>
  value !== undefined && isTimeZone(value) ? value : null;

/**
 * The cookie as `document.cookie` takes it: a session cookie (no Max-Age),
 * SameSite=Lax, limited to the Your Day path. A zone that is not an IANA name
 * is written as UTC, so the server never refuses what the browser wrote.
 */
export const yourDayZoneCookie = (zone: string, secure: boolean): string =>
  `${YOUR_DAY_ZONE_COOKIE}=${isTimeZone(zone) ? zone : "UTC"}; Path=${YOUR_DAY_PATH}; SameSite=Lax${secure ? "; Secure" : ""}`;
