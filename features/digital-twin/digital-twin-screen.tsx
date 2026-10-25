"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import {
  isArkStatusPayload,
  type ArkStatusPayload,
} from "@/features/connectors/ark-status-view";
import { Card } from "@/infrastructure/ui-kit/card";
import type { BodyTwinPreview } from "./bodyloop-avatar";

import { BodyLoopAvatar } from "./bodyloop-avatar";
import { GenomeAudit } from "./genome-audit";
import { GenomeHelixFallback } from "./genome-helix-fallback";
import { GenomeInventory } from "./genome-inventory";
import {
  sourceLines,
  twinSections,
  type SectionPlan,
  type TwinContext,
} from "./page-sections";
import {
  BODY_TWIN,
  BODY_TWIN_NOTE,
  GENOME_EMPTY,
  GENOME_NOTE,
  GENOME_TWIN,
  PAGE_TITLE,
  SOURCES_NOTE,
  SOURCES_TITLE,
} from "./twin-page-copy";

/**
 * Digital Twin: the body twin first and full width, then where its data comes
 * from, then the genome twin. The body section is always the first element of
 * the page, so Sources appearing below it never remounts the 3D view. The
 * helix loads only on the client.
 */

const GenomeHelix = dynamic(
  () => import("./genome-helix").then((mod) => mod.GenomeHelix),
  { ssr: false, loading: () => <GenomeHelixFallback /> },
);

type DigitalTwinScreenProps = {
  readonly preview?: ArkStatusPayload;
  readonly bodyPreview?: BodyTwinPreview;
  /** Tests only: what the body viewer reports once its subject is known. */
  readonly contextPreview?: TwinContext;
};

const SectionHead = ({
  title,
  note,
}: Readonly<{ title: string; note: string | null }>) => (
  <>
    <h2 className="font-display text-2xl tracking-tight">{title}</h2>
    {note ? (
      <p className="text-muted-foreground mt-2 max-w-xl text-[15px] leading-relaxed">
        {note}
      </p>
    ) : null}
  </>
);

const GenomeSection = ({ status }: { readonly status: ArkStatusPayload | null }) => {
  const enabled = status?.enabled === true;
  return (
    <section className="mt-12">
      <SectionHead title={GENOME_TWIN} note={enabled ? GENOME_NOTE : null} />
      {!enabled ? (
        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
          {GENOME_EMPTY}
        </p>
      ) : (
        <>
          <div className="mt-6">
            <GenomeHelix />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <GenomeInventory status={status} />
            <GenomeAudit />
          </div>
        </>
      )}
    </section>
  );
};

const SourcesSection = ({
  context,
  plan,
}: Readonly<{ context: TwinContext; plan: SectionPlan }>) => (
  <section className="mt-12">
    <SectionHead title={SOURCES_TITLE} note={SOURCES_NOTE} />
    <Card className="mt-4">
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
        {sourceLines(context, plan.empty).map((line) => (
          <div key={line.label} className="contents">
            <dt className="text-muted-foreground">{line.label}</dt>
            <dd>{line.text}</dd>
          </div>
        ))}
      </dl>
    </Card>
  </section>
);

export const DigitalTwinScreen = ({
  preview,
  bodyPreview,
  contextPreview,
}: DigitalTwinScreenProps) => {
  const [payload, setPayload] = useState<ArkStatusPayload | null>(preview ?? null);
  const [context, setContext] = useState<TwinContext | null>(contextPreview ?? null);

  useEffect(() => {
    if (preview !== undefined) return;
    let cancelled = false;
    void fetch("/api/ark/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (cancelled || !isArkStatusPayload(value)) return;
        setPayload(value);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [preview]);

  const status = preview !== undefined ? (preview ?? null) : payload;
  const plan = twinSections({ context, genomeEnabled: status?.enabled === true });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-display">{PAGE_TITLE}</h1>
      <section className="mt-6">
        <SectionHead title={BODY_TWIN} note={BODY_TWIN_NOTE} />
        <div className="surface mt-4 px-4 py-5">
          <BodyLoopAvatar preview={bodyPreview} onContext={setContext} />
        </div>
      </section>
      {context && plan.sections.includes("sources") ? (
        <SourcesSection context={context} plan={plan} />
      ) : null}
      <GenomeSection status={status} />
    </div>
  );
};
