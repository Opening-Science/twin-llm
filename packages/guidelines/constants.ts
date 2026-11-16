export const EMBEDDING_MODEL = "nomic-embed-text" as const;
export const EMBEDDING_DIM = 768 as const;
export { DEFAULT_OLLAMA_BASE_URL as DEFAULT_OLLAMA_OPENAI_URL } from "@/infrastructure/ollama-context";

export const DOCUMENT_EMBED_PREFIX = "search_document: " as const;
export const QUERY_EMBED_PREFIX = "search_query: " as const;

export const FULL_TEXT_LICENCES = ["cc-by-nc-nd-4.0", "cc-by-nc-4.0"] as const;
export const CITE_ONLY_LICENCES = ["publisher", "esc-oup"] as const;

export type FullTextLicence = (typeof FULL_TEXT_LICENCES)[number];
export type CiteOnlyLicence = (typeof CITE_ONLY_LICENCES)[number];
export type GuidelineLicence = FullTextLicence | CiteOnlyLicence;

export type IngestMode = "full_text" | "cite_only";

/** `guideline_documents.source` for rows from GUIDELINE_MANIFEST. */
export const GUIDELINE_SOURCE = "guideline" as const;

export const GUIDELINE_MODEL_TOOL = "guideline_search" as const;
export const GUIDELINE_AUDIT_TOOL = "guidelines.guideline_search" as const;
export const GUIDELINE_SEARCH_DEFAULT_K = 5 as const;
export const GUIDELINE_SEARCH_MAX_K = 8 as const;

export const GUIDELINE_ATTRIBUTION_LINE =
  "Published guideline passage as reference material, not a statement about this person." as const;

/**
 * How an answer cites what `guideline_search` returned (#612): a sentence that
 * rests on a passage ends with its id, a claim no passage supports is marked.
 * In the tool text, so a turn pays for it only when the tool is offered; kept
 * short because the General agent's 16k prompt has little room left
 * (`bun run prompt:size`).
 */
export const GUIDELINE_CITE_RULE =
  "In Answer, end a sentence resting on a passage with its id, e.g. [ean-als-2024], or a claim none supports with [unsupported]." as const;
