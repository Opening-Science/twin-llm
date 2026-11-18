/**
 * Stop on the server (SPEC 8.3, SERVER-SPEC 3.12): one same-origin POST per
 * answer, `keepalive` so it outlives the page. Saved chats only. It never
 * throws: a failed stop is logged by status or error name, and the server
 * then finishes and stores the answer as it would have.
 */

export type StopTarget = Readonly<{ turnId: string; modelId: string }>;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

export const stopAnswer = async (target: StopTarget): Promise<void> => {
  try {
    const response = await fetch("/api/chat/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnId: target.turnId, modelId: target.modelId }),
      keepalive: true,
    });
    if (!response.ok) {
      console.error(`[chat] ${target.modelId} stop not accepted`, response.status);
    }
  } catch (error) {
    console.error(`[chat] ${target.modelId} stop not sent`, errorName(error));
  }
};
