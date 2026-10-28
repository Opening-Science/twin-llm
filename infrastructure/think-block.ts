/**
 * Some local models think out loud even with `think: false` (qwen3 does). Their
 * chat template opens the `<think>` block in the prompt, so the reply often
 * carries only the closing tag: "Okay, let's see… </think>\n## Reasoning …".
 * Nothing before that tag is part of the answer.
 *
 * Pure. A reply with no closing tag is left alone unless it opens with
 * `<think>`; a model that never thinks is never cut.
 */

export type SplitThinking = Readonly<{
  /** What the model thought before answering, trimmed; null when it did not. */
  thinking: string | null;
  /** The reply without it. */
  text: string;
}>;

const OPEN = /^\s*<think>/i;
const CLOSE = /<\/think>/gi;

export const splitThinking = (text: string): SplitThinking => {
  const closes = [...text.matchAll(CLOSE)];
  const last = closes.at(-1);
  if (last?.index !== undefined) {
    const thinking = text
      .slice(0, last.index)
      .replace(/<\/?think>/gi, "")
      .trim();
    return {
      thinking: thinking === "" ? null : thinking,
      text: text.slice(last.index + last[0].length).replace(/^\s+/, ""),
    };
  }
  // Still streaming inside an opened block: nothing to show yet.
  if (OPEN.test(text)) {
    const thinking = text.replace(OPEN, "").trim();
    return { thinking: thinking === "" ? null : thinking, text: "" };
  }
  return { thinking: null, text };
};
