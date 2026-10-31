import {
  CONNECTOR_RETURNS,
  type ConnectorReturn,
  type ConnectorReturnParam,
} from "@/infrastructure/oauth-state";

/**
 * Reads `/connectors?oura=denied` (and the Whoop and Google Health params) into
 * one plain sentence for that connector's card. Unknown words are ignored, so a
 * hand-edited URL never shows anything the handlers did not send.
 */

export const RETURN_SOURCES: readonly ConnectorReturnParam[] = [
  "oura",
  "whoop",
  "google-health",
];

export const RETURN_SOURCE_NAME: Readonly<Record<ConnectorReturnParam, string>> = {
  oura: "Oura",
  whoop: "Whoop",
  "google-health": "Google Health",
};

export type ConnectorReturnNotice = Readonly<{
  source: ConnectorReturnParam;
  outcome: ConnectorReturn;
  text: string;
  /** Shows the card's Error badge. */
  failed: boolean;
  /** Shows a "Try again" link back to authorize. */
  retry: boolean;
}>;

/** `dev` adds the local-development fix; elsewhere localhost means nothing. */
export type ReturnContext = Readonly<{ dev: boolean }>;

const sentence = (
  outcome: ConnectorReturn,
  name: string,
  { dev }: ReturnContext,
): string => {
  switch (outcome) {
    case "connected":
      return `${name} is linked.`;
    case "denied":
      return `${name} access was declined.`;
    case "error":
      return `Couldn’t finish linking ${name}.`;
    case "expired":
      return dev
        ? `The sign-in return didn’t reach this browser session. Open TwinLLM at http://localhost:3000, then link ${name} again.`
        : "The sign-in return didn’t reach this browser session. Start the link again from this page.";
    case "locked":
      return `Your data is locked, so ${name} was not linked. Unlock it, then link ${name} again.`;
    case "signin":
      return `Sign in to link ${name}.`;
    case "unconfigured":
      return `${name} isn’t set up in this workspace yet. Open Setup on the card.`;
  }
};

const isReturn = (value: unknown): value is ConnectorReturn =>
  typeof value === "string" && (CONNECTOR_RETURNS as readonly string[]).includes(value);

export type SearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export const parseConnectorReturn = (
  params: SearchParams,
  context: ReturnContext,
): ConnectorReturnNotice | null => {
  for (const source of RETURN_SOURCES) {
    const raw = params[source];
    const outcome = Array.isArray(raw) ? raw[0] : raw;
    if (!isReturn(outcome)) continue;
    return {
      source,
      outcome,
      text: sentence(outcome, RETURN_SOURCE_NAME[source], context),
      failed: outcome === "error" || outcome === "expired",
      retry:
        outcome === "denied" ||
        outcome === "error" ||
        outcome === "expired" ||
        outcome === "locked",
    };
  }
  return null;
};
