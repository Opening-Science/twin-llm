import { MAX_SPEAK_CHARS, type SpeechLanguage } from "./contract";
import { spokenUnits } from "./spoken-units";

/**
 * An answer as it should sound (docs/voice.md): the words, without what only
 * makes sense on screen. Code, tables, images, web addresses and bracketed
 * citation ids are dropped, a link keeps its words, a heading or list item
 * ends as a sentence, and numbers with units are said in words
 * (`spoken-units.ts`). Then the text is cut into pieces at sentence ends, so
 * the first piece can play while the next is made. Pure.
 */

/** Short enough that the first sentence plays soon after the answer ends. */
export const SPOKEN_CHUNK_CHARS = 400;

const withStop = (line: string): string =>
  line === "" || /[.!?:;]$/.test(line) ? line : `${line}.`;

export const spokenText = (markdown: string, language: SpeechLanguage): string =>
  spokenUnits(
    markdown
      .replace(/```[\s\S]*?(?:```|$)/g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => !line.startsWith("|") && !/^[-*_]{3,}$/.test(line))
      .map((line) => {
        const block = /^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/.test(line);
        const words = line
          .replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, "")
          .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
          .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
          .replace(/\[[^\][\n]{1,200}\]/g, "")
          .replace(/https?:\/\/\S*[^\s.,;:!?)]/g, "")
          .replace(/`([^`]*)`/g, "$1")
          .replace(/(\*\*|__|\*|_)(\S(?:.*?\S)?)\1/g, "$2")
          .replace(/\s+([.,;:!?])/g, "$1")
          .replace(/\s+/g, " ")
          .trim();
        return block ? withStop(words) : words;
      })
      .filter((line) => line !== "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
    language,
  );

/** A piece longer than the limit, cut at the last space before it. */
const cutLong = (sentence: string, limit: number): string[] => {
  if (sentence.length <= limit) return [sentence];
  const space = sentence.lastIndexOf(" ", limit);
  const at = space > 0 ? space : limit;
  return [sentence.slice(0, at).trim(), ...cutLong(sentence.slice(at).trim(), limit)];
};

/**
 * The text in pieces of whole sentences, each at most `limit` characters
 * (never above the sidecar's own limit). A sentence longer than that is cut
 * at a space.
 */
export const spokenChunks = (
  text: string,
  limit: number = SPOKEN_CHUNK_CHARS,
): readonly string[] => {
  const max = Math.min(limit, MAX_SPEAK_CHARS);
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "")
    .flatMap((sentence) => cutLong(sentence, max));
  return sentences.reduce<string[]>((chunks, sentence) => {
    const last = chunks.at(-1);
    if (last !== undefined && last.length + 1 + sentence.length <= max) {
      return [...chunks.slice(0, -1), `${last} ${sentence}`];
    }
    return [...chunks, sentence];
  }, []);
};
