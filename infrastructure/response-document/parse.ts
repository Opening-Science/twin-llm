import { type ResponseDocumentV1, responseDocumentV1Schema } from "./document-v1";

/**
 * The one boundary where a response document arrives as `unknown` (stream
 * metadata, a `Json` column). v1 and v1.1 both parse; v1.1 fields missing from
 * a stored v1 document take their defaults. Anything else is dropped, so the
 * answer still renders without explainability rather than failing.
 */
export const toResponseDocument = (value: unknown): ResponseDocumentV1 | null => {
  const result = responseDocumentV1Schema.safeParse(value);
  return result.success ? result.data : null;
};
