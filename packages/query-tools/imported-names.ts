/**
 * Names of the chat tools that read a person's own imported data
 * (Customize · Data, docs/personal-data.md). Pure and free of zod, so the
 * knowledge sources, the thread policy and the tool cards can import it in
 * the browser.
 */

export const IMPORTED_DATASETS_TOOL = "imported_datasets" as const;
export const IMPORTED_LATEST_TOOL = "imported_latest" as const;
export const IMPORTED_TREND_TOOL = "imported_trend" as const;
export const IMPORTED_TABLE_TOOL = "imported_table" as const;
export const IMPORTED_CONDITIONS_TOOL = "imported_conditions" as const;
export const IMPORTED_MEDICATIONS_TOOL = "imported_medications" as const;

export const IMPORTED_TOOLS = [
  IMPORTED_DATASETS_TOOL,
  IMPORTED_LATEST_TOOL,
  IMPORTED_TREND_TOOL,
  IMPORTED_TABLE_TOOL,
  IMPORTED_CONDITIONS_TOOL,
  IMPORTED_MEDICATIONS_TOOL,
] as const;

export type ImportedToolName = (typeof IMPORTED_TOOLS)[number];

export const isImportedTool = (name: string): name is ImportedToolName =>
  (IMPORTED_TOOLS as readonly string[]).includes(name);
