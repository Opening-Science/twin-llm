"use client";

import { Button } from "@/infrastructure/ui-kit/button";

/**
 * Saves text the page already holds as a file, without another request:
 * a table as CSV or a recording as FHIR JSON. Nothing leaves the machine.
 */
export const DownloadButton = ({
  label,
  fileName,
  mimeType,
  text,
}: Readonly<{ label: string; fileName: string; mimeType: string; text: string }>) => (
  <Button
    size="sm"
    onClick={() => {
      const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
      const link = Object.assign(document.createElement("a"), {
        href: url,
        download: fileName,
      });
      link.click();
      URL.revokeObjectURL(url);
    }}
  >
    {label}
  </Button>
);
