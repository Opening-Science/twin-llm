import { describe, expect, test } from "bun:test";

import { streamingView } from "./streaming-view";

const REASONING = "## Reasoning\nSynthetic reasoning line.\n\n";
const EVIDENCE = "## Evidence Used\n- [oura.sleep.score.2026-01-01]\n\n";

const preparing = { kind: "status", stage: "preparing" } as const;
const answer = (text: string) => ({ kind: "answer", text }) as const;

describe("streamingView, one partial stage at a time", () => {
  test("nothing yet: waiting", () => {
    expect(streamingView("")).toEqual({ kind: "status", stage: "waiting" });
    expect(streamingView("\n  ")).toEqual({ kind: "status", stage: "waiting" });
  });

  test("a decline, plain or in bold: status, never the marker", () => {
    expect(streamingView("REFUSE: this tool does not pick doses.")).toEqual(preparing);
    expect(streamingView("**REFUSE:** this tool does not pick doses.")).toEqual(
      preparing,
    );
  });

  test("reasoning in progress: status", () => {
    expect(streamingView("## Reas")).toEqual(preparing);
    expect(streamingView("## Reasoning\nSynthetic reas")).toEqual(preparing);
  });

  test("evidence keys in progress: status", () => {
    expect(streamingView(`${REASONING}${EVIDENCE}`)).toEqual(preparing);
  });

  test("Answer heading half typed: status", () => {
    expect(streamingView(`${REASONING}${EVIDENCE}## Ans`)).toEqual(preparing);
  });

  test("Answer heading only, no body yet: status", () => {
    expect(streamingView(`${REASONING}${EVIDENCE}## Answer`)).toEqual(preparing);
    expect(streamingView(`${REASONING}${EVIDENCE}## Answer\n`)).toEqual(preparing);
  });

  test("Answer body arriving: only the answer text", () => {
    expect(streamingView(`${REASONING}${EVIDENCE}## Answer\nSynthetic ans`)).toEqual(
      answer("Synthetic ans"),
    );
  });

  test("Uncertainty heading half typed after the answer: held back", () => {
    expect(
      streamingView(`${REASONING}${EVIDENCE}## Answer\nSynthetic answer.\n\n## Unc`),
    ).toEqual(answer("Synthetic answer."));
    expect(
      streamingView(`${REASONING}${EVIDENCE}## Answer\nSynthetic answer.\n**Lim`),
    ).toEqual(answer("Synthetic answer."));
  });

  test("Uncertainty under way: still only the answer", () => {
    expect(
      streamingView(
        `${REASONING}${EVIDENCE}## Answer\nSynthetic answer.\n\n## Uncertainty\nSynthetic cav`,
      ),
    ).toEqual(answer("Synthetic answer."));
  });

  test("bold labels and an alias work the same way", () => {
    expect(streamingView("**Reasoning:**\nSynthetic.\n**Summary:**\n")).toEqual(
      preparing,
    );
    expect(
      streamingView("**Reasoning:**\nSynthetic.\n**Summary:**\nShort reply"),
    ).toEqual(answer("Short reply"));
  });

  test("a **Summary** inside canonical reasoning waits for ## Answer", () => {
    expect(streamingView(`${REASONING}**Summary**\nNot the answer yet.\n`)).toEqual(
      preparing,
    );
    expect(
      streamingView(`${REASONING}**Summary**\nNot the answer.\n## Answer\nThe answer`),
    ).toEqual(answer("The answer"));
  });

  test("inline labels: the answer streams from its label line", () => {
    const head = "Reasoning: Synthetic reasoning.\nEvidence Used: - none\n";
    expect(streamingView(`${head}Answ`)).toEqual(preparing);
    expect(streamingView(`${head}Answer:`)).toEqual(preparing);
    expect(streamingView(`${head}Answer: Synthetic ans`)).toEqual(
      answer("Synthetic ans"),
    );
  });

  test("inline Uncertainty label half typed after the answer: held back", () => {
    const head = "Reasoning: Synthetic.\nAnswer: Synthetic answer.\n";
    expect(streamingView(`${head}Unc`)).toEqual(answer("Synthetic answer."));
    expect(streamingView(`${head}**Uncertainty`)).toEqual(answer("Synthetic answer."));
    expect(streamingView(`${head}Uncertainty: Synthetic cav`)).toEqual(
      answer("Synthetic answer."),
    );
  });

  test("no headings at all: status until the reply finishes", () => {
    expect(streamingView("Plain synthetic reply with no headings.")).toEqual(preparing);
  });
});
