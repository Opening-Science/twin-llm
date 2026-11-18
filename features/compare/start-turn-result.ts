/** What starting a turn answers: the written rows in pick order, or a plain sentence. */
export type StartTurnResult =
  | Readonly<{
      ok: true;
      threadId: string;
      threadTitle: string;
      turnId: string;
      responses: readonly Readonly<{ id: string; modelId: string; modelName: string }>[];
    }>
  | Readonly<{ ok: false; error: string }>;
