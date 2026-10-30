import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { WearableSummaries } from "@/infrastructure/parse-twin-answer";
import {
  ABSTAIN_BANNER,
  DECLINED_BANNER,
  GUIDELINE_ATTRIBUTION_LINE,
  GUIDELINE_ONLY_BANNER,
  UNVERIFIED_NARRATION,
} from "@/infrastructure/response-document/copy";
import { STREAM_STATUS_LINES } from "@/infrastructure/response-document/stream-copy";
import { toResponseDocument } from "@/infrastructure/response-document/parse";
import { GBD_ATTRIBUTION_LINE } from "@/packages/gbd-mcp/constants";

import { AnswerBody, noAnswerLine } from "./answer-body";
import { toSavedResponseState } from "./saved-response-state";
import { documentFromMetadata } from "./answer-stream";
import {
  makeResponseDocument,
  syntheticGbdRow,
  syntheticGuideline,
  syntheticToolCall,
} from "./response-document-fixture";
import type { ResponseState } from "./conversation";

const noWearables: WearableSummaries = {
  oura: null,
  whoop: null,
  googleHealth: null,
  vitronic: null,
};

const answerText = (answer: string): string =>
  [
    "## Reasoning",
    "Synthetic reasoning line.",
    "",
    "## Evidence Used",
    "- none",
    "",
    "## Answer",
    answer,
    "",
    "## Uncertainty",
    "Synthetic uncertainty line.",
  ].join("\n");

const render = (
  response: Pick<
    ResponseState,
    "status" | "text" | "reasoningText" | "attribution" | "document" | "tools"
  >,
): string =>
  renderToStaticMarkup(createElement(AnswerBody, { response, wearables: noWearables }));

describe("answer body with a response document", () => {
  test("abstained: answer text is withheld and the abstain banner is shown", () => {
    const markup = render({
      status: "COMPLETE",
      text: answerText("Synthetic withheld sentence."),
      document: makeResponseDocument({
        sufficient_data: false,
        abstained: true,
        next_step: "more_data",
        interpretation: { kind: "none" },
      }),
    });
    expect(markup).toContain(ABSTAIN_BANNER);
    expect(markup).not.toContain("Synthetic withheld sentence.");
    expect(markup).not.toContain("Synthetic reasoning line.");
    expect(markup).not.toContain(UNVERIFIED_NARRATION);
  });

  test("guideline-only: answer shown with the guideline banner and references", () => {
    const markup = render({
      status: "COMPLETE",
      text: answerText("Synthetic guideline summary."),
      document: makeResponseDocument({
        sufficient_data: false,
        next_step: "more_data",
        interpretation: { kind: "none" },
        data_basis: {
          evidence_keys: [],
          hallucinated_keys: [],
          tool_calls: [syntheticToolCall(1)],
          sources: { gbd: [], guidelines: [syntheticGuideline] },
          gbd_rows: [],
        },
      }),
    });
    expect(markup).toContain("Synthetic guideline summary.");
    expect(markup).toContain(GUIDELINE_ONLY_BANNER);
    expect(markup).not.toContain(ABSTAIN_BANNER);
    expect(markup).toContain("EAN/ERN EURO-NMD ALS · 2024 · 10.1111/ene.example");
    expect(markup).toContain(GUIDELINE_ATTRIBUTION_LINE);
    expect(markup).toContain("1 data lookup recorded for this answer.");
  });

  test("populated: sections render in the documented order", () => {
    const markup = render({
      status: "COMPLETE",
      text: answerText("Synthetic populated answer."),
      attribution: [
        { metricKey: "whoop.recovery.score.2026-01-02", label: "Recovery", value: "64" },
      ],
      document: makeResponseDocument({
        data_basis: {
          evidence_keys: ["whoop.recovery.score.2026-01-02"],
          hallucinated_keys: [],
          tool_calls: [syntheticToolCall(1), syntheticToolCall(2), syntheticToolCall(3)],
          sources: { gbd: [], guidelines: [syntheticGuideline] },
          gbd_rows: [syntheticGbdRow],
        },
        uncertainty: { model_statement: "One synthetic day is not a trend." },
        interpretation: { kind: "narration", text: "Synthetic populated answer." },
      }),
    });
    expect(markup).toContain(UNVERIFIED_NARRATION);
    expect(markup).toContain("Synthetic populated answer.");
    expect(markup).toContain("One synthetic day is not a trend.");
    expect(markup).toContain(GBD_ATTRIBUTION_LINE);

    const order = [
      "Evidence",
      "Guideline references",
      "Population context",
      "Uncertainty",
      "3 data lookups recorded for this answer.",
    ].map((needle) => markup.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("malformed document is ignored: the answer renders without banners", () => {
    const document = toResponseDocument({ abstained: "yes", data_basis: null });
    expect(document).toBeNull();

    const markup = render({
      status: "COMPLETE",
      text: answerText("Synthetic plain answer."),
      document,
    });
    expect(markup).toContain("Synthetic plain answer.");
    expect(markup).not.toContain(ABSTAIN_BANNER);
    expect(markup).not.toContain(GUIDELINE_ONLY_BANNER);
    expect(markup).not.toContain(UNVERIFIED_NARRATION);
    expect(markup).not.toContain("no_interpreter_input");
    expect(markup).not.toContain("data lookup");
  });
});

describe("abstained answers withhold the model's uncertainty statement", () => {
  const abstained = makeResponseDocument({
    sufficient_data: false,
    abstained: true,
    next_step: "more_data",
    interpretation: { kind: "none" },
    uncertainty: { model_statement: "Synthetic model-written uncertainty." },
  });
  const text = answerText("Synthetic withheld sentence.");

  const assertWithheld = (markup: string): void => {
    expect(markup).toContain(ABSTAIN_BANNER);
    expect(markup).not.toContain("Synthetic model-written uncertainty.");
    expect(markup).not.toContain("Synthetic uncertainty line.");
    expect(markup).not.toContain("Uncertainty");
    expect(markup).not.toContain("Synthetic withheld sentence.");
  };

  test("live path: document read from the stream's message metadata", () => {
    const metadata: unknown = {
      modelId: "synthetic/model",
      timeToFirstTokenMs: 100,
      tokensPerSecond: 10,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      costUsd: 0,
      intended_use: "research_hypothesis_generation_n_of_1",
      not_for_diagnostic_use: true,
      document: abstained,
    };
    const document = documentFromMetadata(metadata);
    expect(document?.uncertainty.model_statement).toBe(
      "Synthetic model-written uncertainty.",
    );
    assertWithheld(render({ status: "COMPLETE", text, document }));
  });

  test("/t/[threadId] path: document read from the stored JSON column", () => {
    const state = toSavedResponseState({
      id: "response-1",
      modelId: "synthetic/model",
      modelName: "Synthetic",
      status: "COMPLETE",
      text,
      reasoningText: "Synthetic reasoning line.",
      attribution: null,
      responseDocument: JSON.parse(JSON.stringify(abstained)) as unknown,
      toolParts: null,
      timeToFirstTokenMs: 100,
      tokensPerSecond: 10,
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      costUsd: 0,
    });
    expect(state.document?.abstained).toBe(true);
    assertWithheld(render(state));
  });
});

describe("v1.1 answers", () => {
  test("declined: the REFUSE reply is withheld; banner and clinician sentence shown", () => {
    const markup = render({
      status: "COMPLETE",
      text: "REFUSE: Synthetic refusal sentence.",
      document: makeResponseDocument({
        sufficient_data: true,
        abstained: false,
        answer_class: "declined_decision_support",
        data_basis: {
          evidence_keys: [],
          hallucinated_keys: [],
          tool_calls: [syntheticToolCall(1)],
          sources: { gbd: [], guidelines: [] },
          gbd_rows: [],
        },
        uncertainty: { model_statement: null, level: "high", reasons: ["declined"] },
        next_step: "consult_clinician",
        interpretation: { kind: "none" },
      }),
    });
    expect(markup).toContain(DECLINED_BANNER);
    expect(markup).toContain("A clinician is the right person to ask about this.");
    expect(markup).not.toContain("REFUSE");
    expect(markup).not.toContain("Synthetic refusal sentence.");
    expect(markup).not.toContain(ABSTAIN_BANNER);
    expect(markup).not.toContain(UNVERIFIED_NARRATION);
  });

  test("abstained, level high: rating and reasons shown, model statement withheld", () => {
    const markup = render({
      status: "COMPLETE",
      text: answerText("Synthetic withheld sentence."),
      document: makeResponseDocument({
        sufficient_data: false,
        abstained: true,
        answer_class: "information",
        uncertainty: {
          model_statement: "Synthetic model-written uncertainty.",
          level: "high",
          reasons: ["no_personal_data"],
        },
        next_step: "connect_wearable",
        interpretation: { kind: "none" },
      }),
    });
    expect(markup).toContain(ABSTAIN_BANNER);
    expect(markup).toContain("Uncertainty: high (based on the data behind this answer).");
    expect(markup).toContain("No person-level data was used.");
    expect(markup).toContain(
      "Connect and sync a wearable so answers can use your own data.",
    );
    expect(markup).not.toContain("Synthetic model-written uncertainty.");
    expect(markup).not.toContain("Synthetic withheld sentence.");
  });
});

const statusLine = (line: string): string =>
  `<p role="status" class="text-muted-foreground text-sm">${line}</p>`;

const body = (inner: string): string =>
  `<div class="flex flex-col gap-3 text-[15px] leading-relaxed">${inner}</div>`;

const SCAFFOLD = [
  "## Reasoning",
  "Synthetic reasoning line.",
  "",
  "## Evidence Used",
  "- [oura.synthetic.key]",
  "",
].join("\n");

describe("answer body while streaming", () => {
  test("before any text: the waiting line", () => {
    expect(render({ status: "STREAMING", text: "" })).toBe(
      body(statusLine(STREAM_STATUS_LINES.waiting)),
    );
  });

  test("scaffolding before the Answer section is never shown", () => {
    const markup = render({ status: "STREAMING", text: SCAFFOLD });
    expect(markup).toBe(body(statusLine(STREAM_STATUS_LINES.preparing)));
    expect(markup).not.toContain("Reasoning");
    expect(markup).not.toContain("oura.synthetic.key");
  });

  test("once the Answer section starts, only its text renders", () => {
    const markup = render({
      status: "STREAMING",
      text: `${SCAFFOLD}## Answer\nSynthetic partial answer`,
    });
    expect(markup).toBe(
      body(
        `<div class="flex flex-col gap-3"><p class="whitespace-pre-wrap">Synthetic partial answer</p></div>`,
      ),
    );
  });

  test("tool calls show as a working step trace; its line stands in for the status line", () => {
    const tools = [
      {
        id: "c1",
        tool: "summary_stats",
        title: "Summarised a measure",
        args: [
          { label: "Measure", value: "8867-4" },
          { label: "Subject", value: "synthetic-subject-1" },
        ],
        state: "running",
        rowCount: null,
        note: null,
      },
    ] as const;
    const markup = render({ status: "STREAMING", text: "", tools });
    expect(markup).toContain('<p role="status" class="sr-only">Working.</p>');
    expect(markup).toContain('step-trace-working">Summarising 8867-4</span>');
    expect(markup).toContain('aria-label="Tool calls"');
    expect(markup).toContain('<span class="sr-only">In progress: </span>');
    // The card under the step keeps its arguments, title and tool name.
    expect(markup).toContain('<dd class="min-w-0 break-words">synthetic-subject-1</dd>');
    expect(markup).toContain("<dd>Summarised a measure</dd>");
    expect(markup).toContain('<dd class="font-mono">summary_stats</dd>');
    expect(markup).toContain(">Running<");
    expect(markup).not.toContain(statusLine(STREAM_STATUS_LINES.waiting));
  });

  test("between calls the line says what the model is doing", () => {
    const tools = [
      {
        id: "c1",
        tool: "guideline_search",
        title: "Searched guidelines",
        args: [],
        state: "done",
        rowCount: 4,
        note: null,
      },
    ] as const;
    const waiting = render({ status: "STREAMING", text: "", tools });
    expect(waiting).toContain(
      `step-trace-waiting">${STREAM_STATUS_LINES.waiting}</span>`,
    );
    const writing = render({
      status: "STREAMING",
      text: `${SCAFFOLD}## Answer\nSynthetic.`,
      tools,
    });
    expect(writing).toContain('step-trace-waiting">Writing the answer…</span>');
    expect(writing).toContain("Searched guidelines");
    expect(writing).toContain("4 rows");
    expect(writing).toContain("Synthetic.");
  });

  test("a complete answer folds its steps into a count; a refusal reads No data", () => {
    const tools = [
      {
        id: "c1",
        tool: "resting_hr_trend",
        title: "Fitted a resting heart rate trend",
        args: [{ label: "Window", value: "4 Jul 2026 – 1 Oct 2026" }],
        state: "done",
        rowCount: 88,
        note: null,
      },
      {
        id: "c2",
        tool: "summary_stats",
        title: "Summarised a measure",
        args: [],
        state: "refused",
        rowCount: 0,
        note: "No reading for that measure in this window.",
        refusalCode: "NO_ROWS",
      },
    ] as const;
    const markup = render({ status: "COMPLETE", text: answerText("Synthetic."), tools });
    expect(markup).toContain('<p role="status" class="sr-only">Done. Used 2 tools.</p>');
    expect(markup).toContain('<span class="min-w-0 flex-1 truncate">Used 2 tools</span>');
    expect(markup).toMatch(/<ol id="[^"]+" hidden="" aria-label="Tool calls"/);
    expect(markup).toContain("Reading resting heart rate, 4 Jul 2026 to 1 Oct 2026");
    expect(markup).toContain(">No data: NO_ROWS</span>");
    expect(markup).toContain("No reading for that measure in this window.");
  });
});

describe("noAnswerLine", () => {
  test("says how many lookups ran before the model stopped", () => {
    expect(noAnswerLine(0)).toBe("This model wrote no answer.");
    expect(noAnswerLine(1)).toBe(
      "This model ran 1 lookup and wrote no answer. The steps above show what it returned.",
    );
    expect(noAnswerLine(8)).toBe(
      "This model ran 8 lookups and wrote no answer. The steps above show what they returned.",
    );
  });
});
