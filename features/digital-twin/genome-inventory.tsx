"use client";

import {
  ARK_STATE_LABEL,
  type ArkStatusOk,
  type ArkStatusPayload,
  type ArkStatusUnavailable,
} from "@/features/connectors/ark-status-view";

/**
 * Ark slot inventory for Digital Twin. Filled/Empty plus optional build and
 * catalog version. Busy and locked show the state badge only.
 */

type GenomeInventoryProps = {
  readonly status: ArkStatusPayload;
};

const slotMeta = (build: string | null, version: string | null): string | null => {
  const parts = [
    build ? `Build ${build}` : null,
    version ? `Catalog version ${version}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
};

const UnavailableInventory = ({ status }: { readonly status: ArkStatusUnavailable }) => (
  <article className="surface px-4 py-5">
    <div className="flex items-start justify-between gap-3">
      <h2 className="font-display text-xl tracking-tight">Inventory</h2>
      <span className="text-eyebrow shrink-0">{ARK_STATE_LABEL[status.state]}</span>
    </div>
    {status.state === "busy" && (
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Close the Ark Hub tab
      </p>
    )}
  </article>
);

const ReadyInventory = ({ status }: { readonly status: ArkStatusOk }) => (
  <article className="surface px-4 py-5">
    <div className="flex items-start justify-between gap-3">
      <h2 className="font-display text-xl tracking-tight">Inventory</h2>
      <span className="text-eyebrow shrink-0">{ARK_STATE_LABEL.ok}</span>
    </div>
    <ul className="mt-4 space-y-2">
      {status.slots.map((entry) => {
        const meta = slotMeta(entry.build, entry.version);
        return (
          <li key={entry.slot} className="flex items-start justify-between gap-3 text-sm">
            <div>
              <p>{entry.name}</p>
              {meta && <p className="text-muted-foreground mt-0.5 text-xs">{meta}</p>}
            </div>
            <span className="text-muted-foreground shrink-0 text-xs">
              {entry.state === "empty" ? "Empty" : "Filled"}
            </span>
          </li>
        );
      })}
    </ul>
  </article>
);

export const GenomeInventory = ({ status }: GenomeInventoryProps) => {
  if (!status.enabled) return null;
  if (status.state !== "ok") {
    return <UnavailableInventory status={status} />;
  }
  return <ReadyInventory status={status} />;
};
