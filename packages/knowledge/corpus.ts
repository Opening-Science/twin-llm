import {
  chunkGuidelineText,
  type GuidelineChunkDraft,
} from "@/packages/guidelines/chunk";
import type { StoredDocument } from "@/packages/guidelines/store";

import {
  KNOWLEDGE_DIR,
  KNOWLEDGE_LICENCE,
  KNOWLEDGE_SKIPPED_FILES,
  KNOWLEDGE_SOCIETY,
  KNOWLEDGE_SOURCE,
  KNOWLEDGE_YEAR,
} from "./constants";

/**
 * One file in knowledge/opentwin. `url` is the repo path, which the citation
 * shows as the file. Pure, so tests and the retrieval check share it.
 */
export type KnowledgeDocument = StoredDocument & {
  readonly file: string;
  readonly body: string;
};

export type CorpusPorts = {
  readonly listFiles: () => Promise<readonly string[]>;
  readonly readFile: (file: string) => Promise<string>;
};

const TITLE_LINE = /^#\s*Title:\s*(.+)$/im;
const FIRST_SECTION = /^#\s*Section:/im;

export const isKnowledgeFile = (file: string): boolean =>
  file.endsWith(".md") && !KNOWLEDGE_SKIPPED_FILES.includes(file);

/** Title from `# Title:`; everything before the first `# Section:` is preamble. */
export const parseKnowledgeFile = (file: string, text: string): KnowledgeDocument => {
  const title = text.match(TITLE_LINE)?.[1]?.trim();
  if (!title) throw new Error(`KNOWLEDGE_TITLE_MISSING: ${file}`);
  const start = text.search(FIRST_SECTION);
  if (start < 0) throw new Error(`KNOWLEDGE_NO_SECTIONS: ${file}`);
  return {
    id: `opentwin-${file.replace(/\.md$/, "")}`,
    file: `${KNOWLEDGE_DIR}/${file}`,
    title,
    year: KNOWLEDGE_YEAR,
    society: KNOWLEDGE_SOCIETY,
    doi: "",
    url: `${KNOWLEDGE_DIR}/${file}`,
    licence: KNOWLEDGE_LICENCE,
    ingestMode: "full_text",
    source: KNOWLEDGE_SOURCE,
    body: text.slice(start).trim(),
  };
};

export const readKnowledgeCorpus = async (
  ports: CorpusPorts,
): Promise<KnowledgeDocument[]> => {
  const files = [...(await ports.listFiles())].filter(isKnowledgeFile).sort();
  const documents: KnowledgeDocument[] = [];
  for (const file of files) {
    documents.push(parseKnowledgeFile(file, await ports.readFile(file)));
  }
  return documents;
};

/** Guideline chunker in marked mode, with the file title in front of each chunk. */
export const chunkKnowledgeDocument = (
  document: KnowledgeDocument,
): GuidelineChunkDraft[] =>
  chunkGuidelineText(document.body).map((draft) => ({
    ...draft,
    text: `${document.title} · ${draft.text}`,
  }));
