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

/**
 * A tool call a model wrote as text instead of making it. A fine-tune asked to
 * answer on a step with no tools (`run-twin-turn.ts`) sometimes types out the
 * call it wanted; it is not an answer, so it is dropped (an unclosed one while
 * streaming too).
 */
const TOOL_CALL_TEXT = /<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi;

export const splitThinking = (reply: string): SplitThinking => {
  const text = reply.replace(TOOL_CALL_TEXT, "").trim();
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
