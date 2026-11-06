type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Tells the server to end one answer (#373). The column already reads as
 * stopped, so a failed call only leaves the server finishing the answer as it
 * would have, and a reload shows it. `keepalive` lets the call outlive the page.
 */
export const stopOnServer = async (
  answer: Readonly<{ turnId: string; modelId: string }>,
  fetcher: Fetcher = fetch,
): Promise<void> => {
  try {
    const response = await fetcher("/api/chat/stop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ turnId: answer.turnId, modelId: answer.modelId }),
      keepalive: true,
    });
    if (!response.ok) {
      console.error("[arena] the server did not stop the answer", response.status);
    }
  } catch (thrown) {
    console.error(
      "[arena] could not reach the server to stop the answer",
      thrown instanceof Error ? thrown.name : typeof thrown,
    );
  }
};
