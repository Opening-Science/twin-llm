/**
 * A small streaming scanner for start tags in a large XML file (Apple
 * Health's `export.xml`). Text arrives in chunks; every start or empty tag
 * whose name is asked for is handed over with its attributes, and the rest
 * of the document is skipped. It is not a validating parser: it reads tags,
 * comments and CDATA, which is all an export uses, and keeps only the
 * unfinished tail of the text between chunks.
 */

export type XmlElement = Readonly<{
  name: string;
  attributes: Readonly<Record<string, string>>;
}>;

export type XmlScanner = Readonly<{
  push: (text: string) => void;
  /** True when the text ended outside a tag. */
  end: () => boolean;
}>;

const TAG_NAME = /^([A-Za-z_][\w.:-]*)/;
const ATTRIBUTE = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const ENTITY = /&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g;
const NAMED: Readonly<Record<string, string>> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

export const decodeXmlText = (text: string): string =>
  text.includes("&")
    ? text.replace(ENTITY, (whole, entity: string) => {
        if (entity in NAMED) return NAMED[entity]!;
        const code =
          entity[1] === "x"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10);
        return Number.isFinite(code) && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      })
    : text;

export const parseXmlAttributes = (tag: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    [...tag.matchAll(ATTRIBUTE)].map((match) => [
      match[1]!,
      decodeXmlText(match[2] ?? match[3] ?? ""),
    ]),
  );

/** Index of the `>` closing the tag that starts before `from`, outside quotes; -1 if not yet. */
const tagEnd = (text: string, from: number): number => {
  let quote = "";
  for (let index = from; index < text.length; index += 1) {
    const char = text[index];
    if (quote !== "") {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === ">") {
      return index;
    }
  }
  return -1;
};

const SKIPPED = [
  ["<!--", "-->"],
  ["<![CDATA[", "]]>"],
  ["<?", "?>"],
] as const;

/**
 * `onElement` may answer "stop" to end the scan early (a cap was reached);
 * later text is then ignored.
 */
export const createXmlElementScanner = (
  names: ReadonlySet<string>,
  onElement: (element: XmlElement) => void | "stop",
): XmlScanner => {
  let buffer = "";
  let stopped = false;

  const drain = () => {
    let position = 0;
    while (!stopped) {
      const open = buffer.indexOf("<", position);
      if (open === -1) {
        position = buffer.length;
        break;
      }
      const skipped = SKIPPED.find(([start]) => buffer.startsWith(start, open));
      if (skipped !== undefined) {
        const close = buffer.indexOf(skipped[1], open + skipped[0].length);
        if (close === -1) {
          position = open;
          break;
        }
        position = close + skipped[1].length;
        continue;
      }
      const close = tagEnd(buffer, open + 1);
      if (close === -1) {
        position = open;
        break;
      }
      const tag = buffer.slice(open + 1, close);
      const name = TAG_NAME.exec(tag)?.[1];
      if (name !== undefined && names.has(name)) {
        const answer = onElement({ name, attributes: parseXmlAttributes(tag) });
        if (answer === "stop") stopped = true;
      }
      position = close + 1;
    }
    buffer = stopped ? "" : buffer.slice(position);
  };

  return {
    push: (text) => {
      if (stopped) return;
      buffer += text;
      drain();
    },
    end: () => {
      drain();
      return buffer.trim() === "";
    },
  };
};
