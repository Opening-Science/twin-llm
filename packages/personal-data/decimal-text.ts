/**
 * Numbers as written in an export. A value is read only when it is a plain
 * decimal; anything else (`<0.5`, `NaN`, an empty cell) is not a number.
 * A unit change by a power of ten (s to ms, a fraction to %) moves the
 * decimal point in the text instead of multiplying, so `0.97` becomes
 * exactly `97` and never `97.00000000000001`.
 */

const PLAIN_DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;
const PLAIN_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** A plain number (`5.4`, `-1`, `1e3`), or null. */
export const parsePlainNumber = (raw: string | null | undefined): number | null => {
  const text = (raw ?? "").trim();
  if (!PLAIN_NUMBER.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/**
 * The decimal `raw` times 10^places, worked out on the digits. Null when
 * `raw` is not a plain decimal without an exponent.
 */
export const shiftDecimal = (raw: string, places: number): number | null => {
  const match = PLAIN_DECIMAL.exec(raw.trim());
  if (match === null) return null;
  const [, sign = "", whole = "", fraction = ""] = match;
  if (whole === "" && fraction === "") return null;
  const digits = `${whole}${fraction}`;
  const point = whole.length + places;
  const padded =
    point < 0
      ? `${"0".repeat(-point)}${digits}`
      : digits.padEnd(Math.max(point, digits.length), "0");
  const at = Math.max(point, 0);
  const text = `${sign}${padded.slice(0, at) || "0"}.${padded.slice(at) || "0"}`;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};
