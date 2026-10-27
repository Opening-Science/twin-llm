/**
 * The frontmatter of a SKILL.md: a small, strict subset of YAML.
 *
 * Between two `---` lines, each entry is `key: value`, `key: [a, b, c]`, or
 * `key:` followed by indented `- item` lines. An indented line that is not a
 * list item continues the entry above it (Prettier wraps long lists that way).
 * Values may be wrapped in single or double quotes. Blank lines and lines
 * starting with `#` are skipped. Anything else is an error with its line
 * number, so a skill never loads half-read. The body after the closing `---`
 * is the skill's instructions.
 */

export type FrontmatterValue = string | readonly string[];

export type ParsedSkillFile = Readonly<{
  fields: Readonly<Record<string, FrontmatterValue>>;
  body: string;
}>;

export type ParseResult =
  Readonly<{ ok: true; value: ParsedSkillFile }> | Readonly<{ ok: false; error: string }>;

type Line = Readonly<{ number: number; text: string; indented: boolean }>;

type Entry = Readonly<{ head: Line; rest: readonly Line[] }>;

type EntryResult =
  | Readonly<{ ok: true; key: string; value: FrontmatterValue }>
  | Readonly<{ ok: false; error: string }>;

const KEY_LINE = /^([a-z][a-z0-9-]*):(?:\s+(.*))?$/;
const LIST_ITEM = /^-\s+(.+)$/;

const unquote = (raw: string): string => {
  const text = raw.trim();
  const quoted =
    text.length >= 2 &&
    ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'")));
  return quoted ? text.slice(1, -1) : text;
};

const parseInline = (raw: string): FrontmatterValue => {
  if (!raw.startsWith("[")) return unquote(raw);
  // YAML allows one trailing comma, and Prettier writes it when it wraps a long list.
  const inner = raw.slice(1, -1).trim().replace(/,\s*$/, "");
  return inner === "" ? [] : inner.split(",").map(unquote);
};

const groupEntries = (lines: readonly Line[]): readonly Entry[] =>
  lines.reduce<readonly Entry[]>((entries, line) => {
    const last = entries.at(-1);
    return line.indented && last !== undefined
      ? [...entries.slice(0, -1), { head: last.head, rest: [...last.rest, line] }]
      : [...entries, { head: line, rest: [] }];
  }, []);

const parseEntry = ({ head, rest }: Entry): EntryResult => {
  const match = KEY_LINE.exec(head.text);
  if (head.indented || match === null) {
    return {
      ok: false,
      error: `line ${head.number}: expected "key: value", got "${head.text}"`,
    };
  }
  const [, key = "", inline = ""] = match;
  const items = rest.map((line) => LIST_ITEM.exec(line.text));
  if (inline.trim() === "" && items[0] != null) {
    const bad = rest.find((_, index) => items[index] === null);
    return bad === undefined
      ? { ok: true, key, value: items.map((item) => unquote(item?.[1] ?? "")) }
      : { ok: false, error: `line ${bad.number}: expected "- item" under "${key}"` };
  }
  const text = [inline, ...rest.map((line) => line.text)].join(" ").trim();
  if (text === "")
    return { ok: false, error: `line ${head.number}: "${key}" has no value` };
  if (text.startsWith("[") && !text.endsWith("]")) {
    return { ok: false, error: `line ${head.number}: "${key}" list is not closed` };
  }
  return { ok: true, key, value: parseInline(text) };
};

export const parseSkillFile = (source: string): ParseResult => {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    return {
      ok: false,
      error: "line 1: SKILL.md must start with a --- frontmatter line",
    };
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (close === -1) return { ok: false, error: "frontmatter has no closing --- line" };

  const content = lines
    .slice(1, close)
    .map((raw, index) => ({
      number: index + 2,
      text: raw.trim(),
      indented: /^\s/.test(raw),
    }))
    .filter((line) => line.text !== "" && !line.text.startsWith("#"));
  const parsed = groupEntries(content).map(parseEntry);
  const failure = parsed.find((entry) => !entry.ok);
  if (failure !== undefined && !failure.ok) return { ok: false, error: failure.error };

  const entries = parsed.flatMap((entry) =>
    entry.ok ? [[entry.key, entry.value] as const] : [],
  );
  const duplicate = entries.find(
    ([key], index) => entries.findIndex(([other]) => other === key) !== index,
  );
  if (duplicate !== undefined) {
    return { ok: false, error: `"${duplicate[0]}" appears more than once` };
  }
  return {
    ok: true,
    value: {
      fields: Object.fromEntries(entries),
      body: lines
        .slice(close + 1)
        .join("\n")
        .trim(),
    },
  };
};
