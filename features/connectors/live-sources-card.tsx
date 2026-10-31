"use client";

import { useState, useTransition } from "react";

import {
  LIVE_SOURCES,
  LIVE_SOURCES_LOCAL_ONLY_NOTE,
  LIVE_SOURCES_NEVER_NOTE,
  type LiveSourceId,
  setLiveSourceEnabled,
} from "@/infrastructure/live-sources";
import { Switch } from "@/infrastructure/ui-kit/switch";

import { ConnectorCard } from "./connector-card";
import { saveLiveSourceChoice } from "./live-source-actions";

/**
 * Live public lookups (#6) on Customize · Connectors: one card per source with
 * its switch, off by default, and exactly what a lookup sends and what it
 * never sends. In local-only mode the switches are replaced by a note.
 */
export const LiveSourceCards = ({
  initialEnabled,
  localOnly,
  canSave,
}: Readonly<{
  initialEnabled: readonly LiveSourceId[];
  localOnly: boolean;
  /** False without a signed-in person: the switches are shown but disabled. */
  canSave: boolean;
}>) => {
  const [enabled, setEnabled] = useState<readonly LiveSourceId[]>(
    localOnly ? [] : initialEnabled,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (id: LiveSourceId, on: boolean) => {
    const previous = enabled;
    const next = setLiveSourceEnabled(enabled, id, on);
    setEnabled(next);
    setError(null);
    startTransition(async () => {
      const result = await saveLiveSourceChoice({ enabled: [...next] });
      if (!result.ok) {
        setEnabled(previous);
        setError(result.error);
      }
    });
  };

  return (
    <>
      {LIVE_SOURCES.map((source) => {
        const on = enabled.includes(source.id);
        return (
          <ConnectorCard
            key={source.id}
            name={source.label}
            purpose={source.description}
            badge={on ? { label: "On", tone: "ok" } : { label: "Off", tone: "off" }}
            notice={
              localOnly
                ? { text: LIVE_SOURCES_LOCAL_ONLY_NOTE, tone: "info" }
                : error === null
                  ? null
                  : { text: error, tone: "warn" }
            }
            actions={
              localOnly ? null : (
                <span className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={on}
                    disabled={!canSave || pending}
                    label={`Live ${source.label} lookups`}
                    onChange={(next) => toggle(source.id, next)}
                  />
                  {on ? "Lookups on" : "Lookups off"}
                </span>
              )
            }
          >
            <dl className="mt-3 space-y-2 text-xs leading-relaxed">
              <div>
                <dt className="font-medium">Sent to {source.recipient}</dt>
                <dd className="text-muted-foreground">{source.sends}</dd>
              </div>
              <div>
                <dt className="font-medium">Never sent</dt>
                <dd className="text-muted-foreground">{source.keeps}</dd>
              </div>
            </dl>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed">
              {LIVE_SOURCES_NEVER_NOTE}
            </p>
          </ConnectorCard>
        );
      })}
    </>
  );
};
