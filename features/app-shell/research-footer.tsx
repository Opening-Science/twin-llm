/**
 * The research footer under every shell page, the focus pages and the
 * Synthea host. Its sentences are binding: tests and the claims lint check
 * them word for word. A native disclosure on phones, so it works with the
 * keyboard and a screen reader and without scripts.
 */

export const RESEARCH_FOOTER_TEXT =
  "Research-use visualisation only. This tool presents supplied data and model output and does not provide medical advice.";

export const RESEARCH_FOOTER_SHORT = "Research use only, not clinical advice.";

export type Residency = Readonly<{ localOnly: boolean; provider: string }>;

const PROVIDER_SENTENCE: Readonly<Record<string, string>> = {
  exoscale:
    "Cloud model in use: our own open models on Exoscale (Switzerland), personal data only in a consented pilot.",
  ollama: "Model served by Ollama at the configured address.",
  infomaniak: "Cloud model in use: Infomaniak (Switzerland, synthetic data only).",
  openrouter: "Cloud model in use: OpenRouter (synthetic data only).",
  "remote-gpu":
    "Model served on a remote GPU through an SSH tunnel (synthetic data only).",
};

export const LOCAL_ONLY_SENTENCE =
  "Local only: models and storage run on this machine. Wearable syncs download from each vendor's cloud.";

/** Where models and data live, from the server's settings; null for an unknown provider. */
export const residencySentence = ({ localOnly, provider }: Residency): string | null =>
  localOnly ? LOCAL_ONLY_SENTENCE : (PROVIDER_SENTENCE[provider] ?? null);

export const ResearchFooter = ({ residency }: Readonly<{ residency?: Residency }>) => {
  const where = residency === undefined ? null : residencySentence(residency);
  return (
    <footer className="research-footer">
      <p className="hidden sm:block">
        <span className="research-footer-half">{RESEARCH_FOOTER_TEXT}</span>
        {where !== null && (
          <>
            <span aria-hidden="true" className="research-footer-dot">
              {" · "}
            </span>{" "}
            <span className="research-footer-half">{where}</span>
          </>
        )}
      </p>
      <details className="research-footer-phone sm:hidden">
        <summary>
          {RESEARCH_FOOTER_SHORT} <span className="research-footer-more">More</span>
          <span className="research-footer-less">Less</span>
        </summary>
        <p className="mt-1">
          {RESEARCH_FOOTER_TEXT}
          {where !== null && ` ${where}`}
        </p>
      </details>
    </footer>
  );
};
