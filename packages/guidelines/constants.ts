export const EMBEDDING_MODEL = "nomic-embed-text" as const;
export const EMBEDDING_DIM = 768 as const;
export const DEFAULT_OLLAMA_OPENAI_URL = "http://127.0.0.1:11434/v1" as const;

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
