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
  infomaniak: "Cloud model in use: Infomaniak (Switzerland).",
  openrouter: "Cloud model in use: OpenRouter (synthetic data only).",
  "remote-gpu":
    "Model served on a remote GPU through an SSH tunnel (synthetic data only).",
};

export const residencyText = (residency: DataResidency): string =>
  residency.localOnly ? LOCAL_ONLY_TEXT : PROVIDER_TEXT[residency.provider];

/**
 * One compact line: the research sentence, then where models run. Each half is
 * an inline block, so a narrower screen breaks between them, not mid-sentence.
 * Both halves together need about 1,250 px, so the separator only shows from
 * 1600 px, where they share a line; below that it would dangle at a line end. The
 * space between the halves keeps them apart when a page without the sidebar fits
 * both on one line below 1600 px.
 */
export const ResearchFooter = ({ residency }: { readonly residency?: DataResidency }) => (
  <footer className="border-border text-muted-foreground border-t px-4 py-1.5 text-center text-xs leading-snug">
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
  </footer>
);
