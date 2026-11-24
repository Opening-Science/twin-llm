import { NextResponse } from "next/server";

import {
  VitronicScannerHttpError,
  VitronicScanKeyConflictError,
  VitronicScanNotFoundError,
} from "@/packages/vitronic/sync-errors";
import { TlsPinMismatchError } from "@/packages/vitronic/tls";

export const scannerSyncErrorResponse = (error: unknown, logLabel: string) => {
  if (error instanceof VitronicScanKeyConflictError) {
    console.warn(logLabel, error.name);
    return NextResponse.json(
      {
        error:
          "The scan key could not be changed. Reload Connectors. For a different subject, keep existing scans separate in Digital Twin.",
      },
      { status: 409 },
    );
  }
  if (error instanceof VitronicScanNotFoundError) {
    console.warn(logLabel, error.name);
    return NextResponse.json(
      {
        error:
          "No matching BodyLoop scan was found. Check that the scan key is the subject's proband ID and that it has a completed scan.",
      },
      { status: 404 },
    );
  }
  if (error instanceof VitronicScannerHttpError) {
    console.error(logLabel, error.name, error.status);
    const message =
      error.status === 401 || error.status === 403
        ? "The BodyLoop scanner rejected the API token or its permissions. Check that the token can read scans."
        : `The BodyLoop scanner returned HTTP ${error.status}. Check the scanner API and try again.`;
    return NextResponse.json({ error: message }, { status: 502 });
  }
  console.error(logLabel, error instanceof Error ? error.name : "unknown");
  const message =
    error instanceof TlsPinMismatchError
      ? "The BodyLoop scanner's TLS certificate no longer matches the saved connection. Verify the certificate with the scanner operator."
      : "Could not sync BodyLoop data. Check the connection and try again.";
  return NextResponse.json({ error: message }, { status: 502 });
};
