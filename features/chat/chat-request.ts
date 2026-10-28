import { z } from "zod";

import { SKILL_NAME_PATTERN } from "@/infrastructure/skill-gate";

/**
 * Body of `POST /api/chat`: one model, one turn, the conversation so far.
 *
 * The browser sends one request per selected model, in parallel, so a model
 * that fails or hangs never takes the others down with it. The turn must
 * already exist (created by `startTurn`). Limits keep a single request to a
 * sane size: at most 100 messages of at most 32,000 characters each.
 *
 * `skill` names the skill the turn was sent with (`/sleep`). The server loads
 * it and enforces it; a name it does not offer is refused.
 */
const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_MODEL_ID_CHARS = 200;

const conversationMessage = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
});

export const chatRequestSchema = z.object({
  modelId: z.string().min(1).max(MAX_MODEL_ID_CHARS),
  turnId: z.string().min(1),
  messages: z.array(conversationMessage).min(1).max(MAX_MESSAGES),
  skill: z.string().regex(SKILL_NAME_PATTERN).optional(),
});

export type ChatRequest = Readonly<z.infer<typeof chatRequestSchema>>;

/**
 * Body of `POST /api/chat/incognito`: one model and the conversation so far,
 * held only in the browser. There is no turn id because nothing was written
 * down. Closed (`strict`), so a stray field is refused rather than ignored, and
 * bounded like the saved request.
 */
export const incognitoChatRequestSchema = z
  .object({
    modelId: z.string().min(1).max(MAX_MODEL_ID_CHARS),
    messages: z.array(conversationMessage.strict()).min(1).max(MAX_MESSAGES),
    skill: z.string().regex(SKILL_NAME_PATTERN).optional(),
  })
  .strict();

export type IncognitoChatRequest = Readonly<z.infer<typeof incognitoChatRequestSchema>>;

/** The prompt this request answers: its last user message, or "" if none. */
export const currentPrompt = (
  messages: readonly Readonly<{ role: "user" | "assistant"; content: string }>[],
): string => messages.findLast((message) => message.role === "user")?.content ?? "";
