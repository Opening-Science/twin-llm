import { z } from "zod";

/**
 * Body of `POST /api/chat`: one model, one turn, the conversation so far.
 *
 * The browser sends one request per selected model, in parallel, so a model
 * that fails or hangs never takes the others down with it. The turn must
 * already exist (created by `startTurn`). Limits keep a single request to a
 * sane size: at most 100 messages of at most 32,000 characters each.
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
});

export type ChatRequest = Readonly<z.infer<typeof chatRequestSchema>>;
