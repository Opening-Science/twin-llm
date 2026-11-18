import { readableTitle } from "@/infrastructure/readable-title";

import { exportSlug, markdownFileName } from "./thread-markdown";

/**
 * The Markdown export as a FHIR R4 DocumentReference (SPEC 9.3): tagged
 * research use only, the Markdown as one base64 attachment. No Patient and
 * no subject: the document names nobody.
 */

export const FHIR_TAG_SYSTEM = "https://opening.science/twinllm";

export const fhirDocument = (
  title: string,
  markdown: string,
  today: string,
): Readonly<Record<string, unknown>> => ({
  resourceType: "DocumentReference",
  meta: {
    tag: [
      {
        system: FHIR_TAG_SYSTEM,
        code: "research-use-only",
        display: "Research use only",
      },
    ],
  },
  status: "current",
  docStatus: "final",
  type: { text: "TwinLLM thread export" },
  date: `${today}T00:00:00Z`,
  description: readableTitle(title),
  content: [
    {
      attachment: {
        contentType: "text/markdown; charset=utf-8",
        language: "en",
        data: Buffer.from(markdown, "utf8").toString("base64"),
        title: markdownFileName(title),
      },
    },
  ],
});

export const fhirFileName = (title: string): string => `${exportSlug(title)}.fhir.json`;
