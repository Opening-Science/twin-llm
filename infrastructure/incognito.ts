/**
 * Incognito chats: never saved, local only. Pure and free of Node APIs, so the
 * route, the compare screen, the model picker and a future search palette
 * share one set of names and one decision.
 *
 * An incognito conversation lives in the browser's React state and nowhere
 * else: no Thread, Turn or ModelResponse row, no thread history entry, no
 * `/t/<id>` URL and no analytics event about it. It runs only on a chat model
 * on this machine (Ollama on loopback, `isLocalChatModel`). Tool reads are
 * still audited, under a random session id per answer (`incognitoSessionId`)
 * that no thread or turn row ever carries.
 */

/** The search parameter that opens a new chat in incognito mode. */
export const INCOGNITO_PARAM = "incognito" as const;

/** Where any part of the UI links to start an incognito chat. */
export const INCOGNITO_HREF = `/?${INCOGNITO_PARAM}=1` as const;

/** Where turning incognito off goes: an ordinary new chat. */
export const NEW_CHAT_HREF = "/" as const;

/** True when the page's search parameter asks for incognito mode. */
export const isIncognitoParam = (
  value: string | readonly string[] | undefined,
): boolean => value === "1";

/** The banner under the heading, and the screen reader name of the toggle. */
export const INCOGNITO_BANNER =
  "Incognito chat. Not saved, not in your threads or search, local models only.";
export const INCOGNITO_TOGGLE_LABEL = "Incognito chat";

/** Why a model is greyed out in the picker during an incognito chat. */
export const INCOGNITO_MODEL_NOT_LOCAL =
  "Not on this machine, so not for incognito chats.";

export const INCOGNITO_LOCAL_ONLY = "INCOGNITO_LOCAL_ONLY" as const;

/** What a person reads when the server refuses a model for an incognito chat. */
export const INCOGNITO_LOCAL_ONLY_SENTENCE =
  "Incognito chats run only on models on this machine, so this model did not run.";

export type IncognitoDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: typeof INCOGNITO_LOCAL_ONLY;
      readonly error: typeof INCOGNITO_LOCAL_ONLY_SENTENCE;
    };

/** May an incognito turn go to the active chat model? Only when it is local. */
export const permitIncognitoModel = (
  input: Readonly<{ chatIsLocal: boolean }>,
): IncognitoDecision =>
  input.chatIsLocal
    ? { ok: true }
    : { ok: false, code: INCOGNITO_LOCAL_ONLY, error: INCOGNITO_LOCAL_ONLY_SENTENCE };

/** Prefix of an incognito answer's audit session id; never a turn id. */
export const INCOGNITO_SESSION_PREFIX = "incognito-" as const;

/** A fresh audit session id for one incognito answer. */
export const incognitoSessionId = (randomId: () => string): string =>
  `${INCOGNITO_SESSION_PREFIX}${randomId()}`;
