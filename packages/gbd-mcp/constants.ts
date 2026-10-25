export const GBD_MCP_TOOL = "gbd_query";
export const GBD_AUDIT_TOOL = "gbd.gbd_query";
export const GBD_MODEL_TOOL = "gbd_population";
export const GBD_RELEASE_YEAR = "2021";
export const GBD_TIMEOUT_MS = 15_000;

export const gbdAttributionLine = (releaseYear: string): string =>
  `Population estimate (IHME GBD ${releaseYear}), not a statement about this person.`;

export const GBD_ATTRIBUTION_LINE = gbdAttributionLine(GBD_RELEASE_YEAR);
