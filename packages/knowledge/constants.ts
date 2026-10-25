export const KNOWLEDGE_MODEL_TOOL = "knowledge_search" as const;
export const KNOWLEDGE_AUDIT_TOOL = "knowledge.knowledge_search" as const;

/** `guideline_documents.source` for OpenTwin knowledge files. */
export const KNOWLEDGE_SOURCE = "opentwin-knowledge" as const;
export const KNOWLEDGE_LICENCE = "cc-by-4.0" as const;
export const KNOWLEDGE_SOCIETY = "Open Science Foundation" as const;
export const KNOWLEDGE_YEAR = 2026 as const;

/** Repo-relative folder of the corpus. */
export const KNOWLEDGE_DIR = "knowledge/opentwin" as const;
/** Files in the folder that are not knowledge notes. */
export const KNOWLEDGE_SKIPPED_FILES: readonly string[] = ["LICENSE.md", "README.md"];
