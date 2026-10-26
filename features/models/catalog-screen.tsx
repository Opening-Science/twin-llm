import type { LlmProvider } from "@/infrastructure/data-mode";
import { formatMeasure, formatNumber } from "@/infrastructure/format-measure";
import {
  type CatalogModel,
  formatContextWindow,
  formatModelWindow,
} from "@/infrastructure/model-catalog";
import { buttonClassName } from "@/infrastructure/ui-kit/button";

import { costCopy } from "./cost-copy";
import { catalogOrder, defaultsCopy, ORDER_COPY } from "./defaults-copy";

/**
 * `/models`: the models the active provider offers right now, read straight
 * from the provider, in the catalog's own order. Each context window is drawn
 * to scale against the widest one, and the models a new thread starts with are
 * marked. Read-only; choosing happens in the prompt bar.
 */

const PROVIDER_SENTENCE =
  "With LOCAL_ONLY=true the only provider is Ollama on this machine; otherwise the default is our own open models on Exoscale in Switzerland. OpenRouter and the remote GPU (SSH tunnel) are only available when DATA_MODE is synthetic and no wearable snapshot is loaded.";

const Unavailable = () => (
  <div className="flex flex-col items-start gap-4">
    <p className="text-muted-foreground max-w-prose">
      The provider did not send its model list just now, so there is nothing to show. The
      rest of TwinLLM still works.
    </p>
    {/* A full reload, not a client navigation: the list is read on the server. */}
    <a href="/models" className={buttonClassName({ variant: "primary" })}>
      Try again
    </a>
  </div>
);

const intro = (
  catalog: readonly CatalogModel[],
  defaults: readonly string[],
  provider: LlmProvider,
): string =>
  [
    ORDER_COPY[catalogOrder(catalog)].lead,
    PROVIDER_SENTENCE,
    costCopy(provider)?.sentence,
    defaultsCopy(catalog, defaults),
  ]
    .filter((part) => part)
    .join(" ");

/** Cost only where the provider's calls really are priced per model; else unknown. */
const CostCell = ({ known }: Readonly<{ known: boolean }>) =>
  known ? (
    <>{formatMeasure("costUsd", 0)}</>
  ) : (
    <>
      <span aria-hidden="true">—</span>
      <span className="sr-only">unknown</span>
    </>
  );

const ModelRow = ({
  model,
  widest,
  isDefault,
  costKnown,
}: Readonly<{
  model: CatalogModel;
  widest: number;
  isDefault: boolean;
  costKnown: boolean;
}>) => (
  <tr className="border-border border-t first:border-t-0">
    <th scope="row" className="px-4 py-3 text-left font-normal">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="border-input text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs"
        >
          {model.provider.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display text-lg leading-tight break-all">
              {model.name}
            </span>
            {isDefault && (
              <span className="border-border text-muted-foreground rounded border px-1.5 font-mono text-[10px] tracking-wider uppercase">
                default
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-xs break-all">
            {model.provider} · <span className="font-mono">{model.id}</span>
          </p>
        </div>
      </div>
    </th>
    <td className="hidden px-4 py-3 text-right font-mono text-sm sm:table-cell">
      <CostCell known={costKnown} />
    </td>
    <td className="w-32 px-4 py-3 text-right sm:w-44">
      <span className="font-mono text-sm font-bold">{formatModelWindow(model)}</span>
      {!model.contextUnknown && (
        <span aria-hidden="true" className="measure-bar mt-1.5 block">
          <span style={{ width: `${(model.contextTokens / widest) * 100}%` }} />
        </span>
      )}
    </td>
  </tr>
);

export const CatalogScreen = ({
  catalog,
  defaultModelIds,
  provider,
}: Readonly<{
  catalog: readonly CatalogModel[] | null;
  defaultModelIds: readonly string[];
  provider: LlmProvider;
}>) => {
  const measured = (catalog ?? []).filter((model) => !model.contextUnknown);
  const widest = Math.max(1, ...measured.map((model) => model.contextTokens));
  const costKnown = costCopy(provider)?.perModel === true;
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <h1 className="text-display">Models</h1>
      {catalog === null ? (
        <Unavailable />
      ) : (
        <>
          <p className="text-muted-foreground max-w-prose leading-relaxed">
            {intro(catalog, defaultModelIds, provider)}
          </p>
          <p className="font-mono text-xs">
            {formatNumber(catalog.length, 0)} {catalog.length === 1 ? "model" : "models"}{" "}
            {measured.length > 0 ? ` · ${formatContextWindow(widest)} widest window` : ""}
            {costKnown ? ` · ${formatMeasure("costUsd", 0)} each` : ""}
          </p>
          <div className="surface overflow-hidden">
            <table className="w-full table-fixed">
              <caption className="sr-only">
                {ORDER_COPY[catalogOrder(catalog)].caption}
              </caption>
              <thead>
                <tr className="text-eyebrow border-border border-b">
                  <th scope="col" className="px-4 py-2.5 text-left font-normal">
                    Model
                  </th>
                  <th
                    scope="col"
                    className="hidden w-28 px-4 py-2.5 text-right font-normal sm:table-cell"
                  >
                    Per call
                  </th>
                  <th
                    scope="col"
                    className="w-32 px-4 py-2.5 text-right font-normal sm:w-44"
                  >
                    Context
                  </th>
                </tr>
              </thead>
              <tbody>
                {catalog.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    widest={widest}
                    isDefault={defaultModelIds.includes(model.id)}
                    costKnown={costKnown}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
