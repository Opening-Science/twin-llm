/**
 * Named refusals of `gbd_estimate` (#387). Each has a `code`, so the audit
 * row counts 0 rows and the model can say plainly why there is no figure.
 */

/** Rows one `gbd_estimate` call may return. More is refused, not cut. */
export const GBD_ROW_CAP = 200;

export const GBD_REFUSAL_CODES = [
  "GBD_NOT_IMPORTED",
  "GBD_UNKNOWN_LOCATION",
  "GBD_AMBIGUOUS_LOCATION",
  "GBD_UNKNOWN_CAUSE",
  "GBD_UNKNOWN_RISK",
  "GBD_NO_ESTIMATE",
  "GBD_NO_SDI",
  "GBD_TOO_MANY_ROWS",
] as const;

export type GbdRefusalCode = (typeof GBD_REFUSAL_CODES)[number];

export type GbdRefusal = Readonly<{
  code: GbdRefusalCode;
  error: string;
  /** The name or code the call gave, when the refusal is about one. */
  query?: string;
  /** What was imported or could be meant instead; at most 20. */
  options?: readonly string[];
}>;

const CAP_OPTIONS = 20;

const withOptions = (options: readonly string[]) =>
  options.length === 0 ? {} : { options: options.slice(0, CAP_OPTIONS) };

export const GBD_NOT_IMPORTED: GbdRefusal = {
  code: "GBD_NOT_IMPORTED",
  error:
    "no GBD results are imported on this machine; they are downloaded from IHME's GBD Results Tool and imported with bun run gbd:import",
};

export const gbdUnknownLocation = (query: string): GbdRefusal => ({
  code: "GBD_UNKNOWN_LOCATION",
  error:
    "no GBD location has this name, ISO 3166-1 alpha-3 or ISO 3166-2 code, or it has no imported estimates",
  query,
});

export const gbdAmbiguousLocation = (
  query: string,
  options: readonly string[],
): GbdRefusal => ({
  code: "GBD_AMBIGUOUS_LOCATION",
  error: "more than one GBD location has this name; ask again with an ISO code",
  query,
  ...withOptions(options),
});

export const gbdUnknownCause = (
  query: string,
  options: readonly string[],
): GbdRefusal => ({
  code: "GBD_UNKNOWN_CAUSE",
  error: "no imported GBD estimate is for a cause with this name",
  query,
  ...withOptions(options),
});

export const gbdUnknownRisk = (
  query: string,
  options: readonly string[],
): GbdRefusal => ({
  code: "GBD_UNKNOWN_RISK",
  error: "no imported GBD estimate is for a risk factor with this name",
  query,
  ...withOptions(options),
});

export const gbdNoEstimate = (detail: string): GbdRefusal => ({
  code: "GBD_NO_ESTIMATE",
  error: `the imported GBD results hold no estimate for ${detail}`,
});

export const GBD_NO_SDI: GbdRefusal = {
  code: "GBD_NO_SDI",
  error:
    "the imported GBD results hold no SDI group (High SDI, Low SDI, ...); import a file that includes them",
};

export const GBD_TOO_MANY_ROWS: GbdRefusal = {
  code: "GBD_TOO_MANY_ROWS",
  error: `more than ${GBD_ROW_CAP} estimates match; ask for fewer locations or years`,
};
