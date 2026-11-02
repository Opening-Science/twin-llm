/**
 * How large a GBD file Customize · Data takes, and how much disk it must
 * leave free (#434). Shared by the route and the page, which refuses a file
 * over the cap before sending it.
 */

/**
 * 1 GB, for `POST /api/gbd/imports` only. It is held while the body streams to the
 * upload file; every other route keeps the 52 MB `proxyClientMaxBodySize`.
 */
export const GBD_MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
/** What must stay free in the state folder after the file is written. */
export const GBD_FREE_SPACE_MARGIN_BYTES = 1024 * 1024 * 1024;

/** Codes the page shows with a refusal made before the file is read. */
export const GBD_UPLOAD_CODES = {
  tooLarge: "GBD_UPLOAD_TOO_LARGE",
  noSpace: "GBD_UPLOAD_NO_SPACE",
} as const;

/**
 * Whether a file of `declared` bytes (unknown: 0) fits with the margin left
 * over. Free space that cannot be told does not refuse: the write itself
 * still stops and cleans up when the disk fills.
 */
export const gbdUploadHasRoom = (free: number | null, declared: number | null): boolean =>
  free === null || free - (declared ?? 0) >= GBD_FREE_SPACE_MARGIN_BYTES;
