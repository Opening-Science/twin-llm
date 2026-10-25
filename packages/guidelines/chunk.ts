const TARGET_CHARS = 2000;
const MAX_CHARS = 2400;
const OVERLAP_CHARS = 320;

export type GuidelineChunkDraft = {
  readonly sectionHeading: string;
  readonly recommendationId: string | null;
  readonly recClass: string | null;
  readonly evidenceLevel: string | null;
  readonly page: string | null;
  readonly body: string;
  readonly text: string;
};

const metaLine = (label: string, source: string): string | null => {
  const match = source.match(new RegExp(`^#\\s*${label}:\\s*(.+)$`, "im"));
  const value = match?.[1]?.trim();
  return value && value.length > 0 ? value : null;
};

export const formatChunkText = (draft: {
  readonly sectionHeading: string;
  readonly recommendationId: string | null;
  readonly recClass: string | null;
  readonly evidenceLevel: string | null;
  readonly body: string;
}): string => {
  const bits = [
    draft.sectionHeading,
    draft.recommendationId ? `Rec ${draft.recommendationId}` : null,
    draft.recClass ? `Class ${draft.recClass}` : null,
    draft.evidenceLevel ? `Evidence ${draft.evidenceLevel}` : null,
  ].filter((bit): bit is string => bit !== null);
  return `${bits.join(" · ")}\n\n${draft.body.trim()}`.trim();
};

const splitLongBody = (body: string): string[] => {
  const trimmed = body.trim();
  if (trimmed.length <= MAX_CHARS) return trimmed.length === 0 ? [] : [trimmed];
  const parts: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    const end = Math.min(start + TARGET_CHARS, trimmed.length);
    let cut = end;
    if (end < trimmed.length) {
      const window = trimmed.slice(start, end);
      const lastBreak = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("\n"),
      );
      if (lastBreak >= TARGET_CHARS / 2) cut = start + lastBreak + 1;
    }
    parts.push(trimmed.slice(start, cut).trim());
    if (cut >= trimmed.length) break;
    start = Math.max(0, cut - OVERLAP_CHARS);
  }
  return parts.filter((part) => part.length > 0);
};

const parseMarkedBlock = (block: string): GuidelineChunkDraft[] => {
  const sectionHeading = metaLine("Section", block) ?? "Untitled section";
  const recommendationId = metaLine("Rec", block);
  const recClass = metaLine("Class", block);
  const evidenceLevel = metaLine("Evidence", block);
  const page = metaLine("Page", block);
  const body = block
    .split("\n")
    .filter((line) => !/^\s*#\s*(Section|Rec|Class|Evidence|Page):/i.test(line))
    .join("\n")
    .trim();
  return splitLongBody(body).map((part) => ({
    sectionHeading,
    recommendationId,
    recClass,
    evidenceLevel,
    page,
    body: part,
    text: formatChunkText({
      sectionHeading,
      recommendationId,
      recClass,
      evidenceLevel,
      body: part,
    }),
  }));
};

const parseMarkdownSections = (source: string): GuidelineChunkDraft[] => {
  const lines = source.split("\n");
  const drafts: GuidelineChunkDraft[] = [];
  let heading = "Untitled section";
  let rec: string | null = null;
  let recClass: string | null = null;
  let evidence: string | null = null;
  let page: string | null = null;
  let bodyLines: string[] = [];

  const flush = (): void => {
    const body = bodyLines.join("\n").trim();
    if (body.length === 0) return;
    for (const part of splitLongBody(body)) {
      drafts.push({
        sectionHeading: heading,
        recommendationId: rec,
        recClass,
        evidenceLevel: evidence,
        page,
        body: part,
        text: formatChunkText({
          sectionHeading: heading,
          recommendationId: rec,
          recClass,
          evidenceLevel: evidence,
          body: part,
        }),
      });
    }
  };

  for (const line of lines) {
    const section = line.match(/^#{1,3}\s+(.+)$/);
    if (section?.[1]) {
      flush();
      heading = section[1].trim();
      rec = null;
      recClass = null;
      evidence = null;
      page = null;
      bodyLines = [];
      continue;
    }
    const recMatch = line.match(/^\s*(?:Rec(?:ommendation)?|PICO)\s*[:#]?\s*(\S+)/i);
    if (recMatch?.[1]) rec = recMatch[1];
    const classMatch = line.match(/^\s*Class\s*[:#]?\s*(.+)$/i);
    if (classMatch?.[1]) recClass = classMatch[1].trim();
    const evidenceMatch = line.match(/^\s*(?:Evidence|GRADE|LoE)\s*[:#]?\s*(.+)$/i);
    if (evidenceMatch?.[1]) evidence = evidenceMatch[1].trim();
    bodyLines.push(line);
  }
  flush();
  return drafts;
};

export const chunkGuidelineText = (source: string): GuidelineChunkDraft[] => {
  const trimmed = source.trim();
  if (trimmed.length === 0) return [];
  if (/^#\s*Section:/im.test(trimmed)) {
    return trimmed
      .split(/\n(?=#\s*Section:)/i)
      .flatMap((block) => parseMarkedBlock(block));
  }
  return parseMarkdownSections(trimmed);
};
