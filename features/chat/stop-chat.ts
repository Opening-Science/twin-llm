import type { AnswerOwnership } from "./answer-ownership";
import { type StopRequest, stopRequestSchema } from "./chat-request";

/**
 * `POST /api/chat/stop` (#373): ends one running answer of the caller's. A
 * factory, so the route wires the real reads and tests pass fakes.
 *
 * It answers to the same person and turn checks as `POST /api/chat`, but not to
 * its abuse protection: that budget is for model calls, and running out of it
 * must not keep anyone from ending one. An answer that has already ended, or
 * was never on the list, is not an error; Stop only says how many it ended.
 */

export type StopChatDeps = Readonly<{
  resolveActorId: () => Promise<string | null>;
  ownership: (actorId: string, answer: StopRequest) => Promise<AnswerOwnership>;
  stop: (answer: StopRequest, mayStillStart: boolean) => number;
}>;

const refuse = (status: number, error: string): Response =>
  Response.json({ error }, { status });

export const createStopChatHandler =
  (deps: StopChatDeps) =>
  async (request: Request): Promise<Response> => {
    const actorId = await deps.resolveActorId();
    if (!actorId) return refuse(401, "Sign in to stop an answer.");

    const body: unknown = await request.json().catch(() => null);
    const parsed = stopRequestSchema.safeParse(body);
    if (!parsed.success) return refuse(400, "That request didn't look right.");

    const ownership = await deps.ownership(actorId, parsed.data);
    if (ownership.kind === "missing") {
      return refuse(400, "That turn hasn't been started for this model.");
    }
    if (ownership.kind === "someone-else") {
      return refuse(403, "That answer isn't yours to stop.");
    }
    return Response.json({
      stopped: deps.stop(parsed.data, ownership.status === "STREAMING"),
    });
  };
