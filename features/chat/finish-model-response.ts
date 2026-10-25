import type { ResponseDocumentV1 } from "@/infrastructure/response-document/document-v1";

/**
 * The end of one model's answer: build the response document, then store the
 * row. Kept apart from `stream-model-response.ts` (server-only) so tests can
 * pass fake ports.
 *
 * A failed write must not leave the row `STREAMING` while the answer is
 * tracked as complete, so it marks the row `FAILED` instead. A failed build
 * (the audit read or schema parse) still stores the text, without a document,
 * which is how a saved answer renders when its document is unreadable.
 */
export type FinishModelResponsePorts = Readonly<{
  buildDocument: () => Promise<ResponseDocumentV1>;
  writeComplete: (document: ResponseDocumentV1 | null) => Promise<void>;
  writeFailed: () => Promise<void>;
  /** Gets the error's name only: Prisma and zod messages can echo row values. */
  logError: (message: string, errorName: string) => void;
}>;

export type FinishModelResponseOutcome = Readonly<{
  document: ResponseDocumentV1 | null;
  status: "COMPLETE" | "FAILED";
}>;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

export const finishModelResponse = async (
  ports: FinishModelResponsePorts,
): Promise<FinishModelResponseOutcome> => {
  let document: ResponseDocumentV1 | null = null;
  try {
    document = await ports.buildDocument();
  } catch (error: unknown) {
    ports.logError("could not build the response document", errorName(error));
  }

  try {
    await ports.writeComplete(document);
    return { document, status: "COMPLETE" };
  } catch (error: unknown) {
    ports.logError("could not store the answer", errorName(error));
  }

  try {
    await ports.writeFailed();
  } catch (error: unknown) {
    ports.logError("could not record the answer as failed", errorName(error));
  }
  return { document, status: "FAILED" };
};
