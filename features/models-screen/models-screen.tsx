import { Fragment } from "react";

import { type CatalogModel, formatModelWindow } from "@/infrastructure/model-catalog";
import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import {
  costSentence,
  defaultsSentence,
  modelsOrder,
  OFFLINE_SENTENCE,
  orderLead,
  PER_CALL_ZERO,
  perCallKnown,
  PROVIDER_SENTENCE,
  summaryParts,
  tableCaption,
  UNAVAILABLE_SENTENCE,
  widestWindow,
  windowShare,
} from "./models-copy";

/**
 * The models page (`/models`): read-only, the models the active provider
 * offers right now with their context windows drawn to scale and the ones a
 * new chat starts with marked. Choosing happens in the prompt bar. The page
 * reads the provider on each request and nothing personal.
 */

export type ModelsScreenProps = Readonly<{
  /** Null when the provider sent no list. */
  models: readonly CatalogModel[] | null;
  /** True for the built-in list shown when the provider could not be reached. */
  offline: boolean;
  defaults: readonly string[];
  provider: string;
}>;

const Heading = () => <h1 className="text-display">Models</h1>;

export const ModelsScreen = (props: ModelsScreenProps) => {
  if (props.models === null) {
    return (
      <div className="page-wide page-stack">
        <Heading />
        <p className="text-muted-foreground max-w-prose">{UNAVAILABLE_SENTENCE}</p>
        <p>
          {/* A full page load: the list is read on the server. */}
          <a href="/models" className={buttonClassName({ variant: "primary" })}>
            Try again
          </a>
        </p>
      </div>
    );
  }
  return <ModelList {...props} models={props.models} />;
};

const ModelList = ({
  models,
  offline,
  defaults,
  provider,
}: ModelsScreenProps & Readonly<{ models: readonly CatalogModel[] }>) => {
  const order = modelsOrder(models);
  const widest = widestWindow(models);
  const intro = [
    orderLead(order),
    PROVIDER_SENTENCE,
    costSentence(provider),
    defaultsSentence(models, defaults),
  ].filter((sentence) => sentence !== null);
  const costKnown = perCallKnown(provider);
  const parts = summaryParts(models, provider);

  return (
    <div className="page-wide page-stack">
      <Heading />
      <p className="text-muted-foreground max-w-prose leading-relaxed">
        {intro.join(" ")}
      </p>

      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-x-1.5 font-mono text-xs">
          {parts.map((part, index) => (
            <Fragment key={part}>
              {index > 0 && <span aria-hidden="true">·</span>}
              <span>{part}</span>
            </Fragment>
          ))}
          {offline && (
            <StatusBadge tone="warn" className="ml-2 font-sans">
              Offline
            </StatusBadge>
          )}
        </p>
        {offline && (
          <p className="text-muted-foreground max-w-prose text-sm">{OFFLINE_SENTENCE}</p>
        )}
      </div>

      <div className="surface overflow-hidden">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">{tableCaption(order)}</caption>
          <thead>
            <tr className="border-border border-b">
              <th scope="col" className="text-eyebrow px-4 py-2.5 text-left font-normal">
                Model
              </th>
              <th
                scope="col"
                className="text-eyebrow hidden w-32 px-4 py-2.5 text-right font-normal sm:table-cell"
              >
                Per call
              </th>
              <th
                scope="col"
                className="text-eyebrow w-32 px-4 py-2.5 text-right font-normal sm:w-44"
              >
                Context
              </th>
            </tr>
          </thead>
          <tbody>
            {models.map((model) => (
              <tr key={model.id} className="border-border border-b last:border-b-0">
                <th scope="row" className="px-4 py-3 text-left align-middle font-normal">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="border-input text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-full border font-mono text-xs"
                    >
                      {model.provider.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="flex min-w-0 flex-col">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-display text-lg leading-snug break-all">
                          {model.name}
                        </span>
                        {defaults.includes(model.id) && (
                          <span className="model-default-tag">default</span>
                        )}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {model.provider}
                        <span aria-hidden="true"> · </span>
                        <code className="font-mono break-all">{model.id}</code>
                      </span>
                    </span>
                  </div>
                </th>
                <td className="hidden px-4 py-3 text-right align-middle font-mono text-sm sm:table-cell">
                  {costKnown ? (
                    PER_CALL_ZERO
                  ) : (
                    <>
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">unknown</span>
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-right align-middle">
                  <span className="font-mono text-sm font-bold">
                    {formatModelWindow(model)}
                  </span>
                  {!model.contextUnknown && (
                    <span aria-hidden="true" className="measure-bar mt-1.5">
                      <span
                        style={{ width: `${windowShare(model.contextTokens, widest)}%` }}
                      />
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
