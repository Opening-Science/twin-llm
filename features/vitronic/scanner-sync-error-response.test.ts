import { expect, test } from "bun:test";

import {
  VitronicScannerHttpError,
  VitronicScanNotFoundError,
} from "@/packages/vitronic/sync-errors";

import { scannerSyncErrorResponse } from "./scanner-sync-error-response";

const label = "[vitronic] sync failed (test)";

test("no matching scan is a 404 with scan key guidance", async () => {
  const response = scannerSyncErrorResponse(new VitronicScanNotFoundError(), label);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({
    error: expect.stringContaining("proband ID"),
  });
});

test.each([401, 403])(
  "scanner HTTP %i returns a token permissions hint",
  async (status) => {
    const response = scannerSyncErrorResponse(
      new VitronicScannerHttpError(status),
      label,
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: expect.stringContaining("Check that the token can read scans."),
    });
  },
);

test("other scanner HTTP failures report only the status", async () => {
  const response = scannerSyncErrorResponse(new VitronicScannerHttpError(503), label);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: "The BodyLoop scanner returned HTTP 503. Check the scanner API and try again.",
  });
});

test("unexpected errors do not expose their message", async () => {
  const response = scannerSyncErrorResponse(new Error("private details"), label);
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({
    error: "Could not sync BodyLoop data. Check the connection and try again.",
  });
});
