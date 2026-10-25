import { describe, expect, test } from "bun:test";

import {
  DOCUMENT_EMBED_PREFIX,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  GUIDELINE_ATTRIBUTION_LINE,
  GUIDELINE_AUDIT_TOOL,
  GUIDELINE_MODEL_TOOL,
  GUIDELINE_SEARCH_DEFAULT_K,
  GUIDELINE_SEARCH_MAX_K,
  QUERY_EMBED_PREFIX,
} from "./constants";

describe("guideline embedding constants", () => {
  test("nomic-embed-text is 768-d with nomic task prefixes", () => {
    expect(EMBEDDING_MODEL).toBe("nomic-embed-text");
    expect(EMBEDDING_DIM).toBe(768);
    expect(DOCUMENT_EMBED_PREFIX).toBe("search_document: ");
    expect(QUERY_EMBED_PREFIX).toBe("search_query: ");
  });
});

describe("guideline search constants", () => {
  test("closed tool names, k bounds, and reference-material copy", () => {
    expect(GUIDELINE_MODEL_TOOL).toBe("guideline_search");
    expect(GUIDELINE_AUDIT_TOOL).toBe("guidelines.guideline_search");
    expect(GUIDELINE_SEARCH_DEFAULT_K).toBe(5);
    expect(GUIDELINE_SEARCH_MAX_K).toBe(8);
    expect(GUIDELINE_ATTRIBUTION_LINE).toBe(
      "Published guideline passage as reference material, not a statement about this person.",
    );
  });
});
