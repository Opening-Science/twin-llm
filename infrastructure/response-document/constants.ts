export const CHAT_RESPONSE_DOCUMENT = {
  intended_use: "research_hypothesis_generation_n_of_1",
  not_for_diagnostic_use: true,
} as const;

export type ChatResponseDocument = typeof CHAT_RESPONSE_DOCUMENT;
