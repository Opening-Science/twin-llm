import { type LlmProvider } from "@/infrastructure/data-mode-policy";

export const RESEARCH_FOOTER_TEXT =
  "Research-use visualisation only. This tool presents supplied data and model output and does not provide medical advice.";

/** Where model calls and storage run, as configured on the server. */
export type DataResidency = Readonly<{
  localOnly: boolean;
  provider: LlmProvider;
}>;

export const LOCAL_ONLY_TEXT =
  "Local only: models and storage run on this machine. Wearable syncs download from each vendor's cloud.";

const PROVIDER_TEXT: Record<LlmProvider, string> = {
  exoscale:
    "Cloud model in use: our own open models on Exoscale (Switzerland), personal data only in a consented pilot.",
  ollama: "Model served by Ollama at the configured address.",
  infomaniak: "Cloud model in use: Infomaniak (Switzerland, synthetic data only).",
  openrouter: "Cloud model in use: OpenRouter (synthetic data only).",
  "remote-gpu":
    "Model served on a remote GPU through an SSH tunnel (synthetic data only).",
};

export const residencyText = (residency: DataResidency): string =>
  residency.localOnly ? LOCAL_ONLY_TEXT : PROVIDER_TEXT[residency.provider];

/**
 * The phone line (#461): the research note in a few words, worded so the claim
 * lint passes without an allowlist entry; the full sentence is one tap away.
 */
export const RESEARCH_FOOTER_SHORT_TEXT = "Research use only, not clinical advice.";

/**
 * The research sentence, then where models run. Each half is an inline block,
 * so a narrower screen breaks between them, not mid-sentence. Both halves
 * together need about 1,250 px, so the separator only shows from 1600 px, where
 * they share a line; below that it would dangle at a line end. The space between
 * the halves keeps them apart when a page without the sidebar fits both on one
 * line below 1600 px.
 */
const FullText = ({ residency }: { readonly residency?: DataResidency }) => (
  <>
    <span className="inline-block">{RESEARCH_FOOTER_TEXT}</span>
    {residency ? (
      <>
        {" "}
        <span className="mr-1.5 hidden min-[1600px]:inline" aria-hidden>
          ·
        </span>
        <span className="inline-block">{residencyText(residency)}</span>
      </>
    ) : null}
  </>
);

/**
 * From 640 px the footer shows the full text. On a phone it is one line
 * (#461): the short note and "More", which opens the full text in place. The
 * footer is a row of the page's grid, under the page rather than over it, so
 * it covers nothing, open or closed.
 */
export const ResearchFooter = ({ residency }: { readonly residency?: DataResidency }) => (
  <footer className="border-border text-muted-foreground border-t px-4 py-1.5 text-center text-xs leading-snug">
    <details className="group sm:hidden">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {RESEARCH_FOOTER_SHORT_TEXT}{" "}
        <span className="text-foreground underline underline-offset-2">
          <span className="group-open:hidden">More</span>
          <span className="hidden group-open:inline">Less</span>
        </span>
      </summary>
      <p className="mt-1">
        <FullText residency={residency} />
      </p>
    </details>
    <p className="hidden sm:block">
      <FullText residency={residency} />
    </p>
  </footer>
);
