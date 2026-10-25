"use client";

import {
  ConnectorCard,
  ConnectorCardSkeleton,
  ConnectorCardUnavailable,
} from "./connector-card";
import type { ConnectorSetupView } from "./connector-setup";
import { connectorBadge } from "./connector-status";
import { isGbdStatusPayload, type GbdStatusPayload } from "./gbd-status-view";
import { SetupDisclosure } from "./setup-disclosure";
import { useConnectorStatus, type StatusPreview } from "./use-connector-status";

export type { GbdStatusError, GbdStatusOk, GbdStatusPayload } from "./gbd-status-view";

type GbdCardProps = {
  readonly setup: ConnectorSetupView;
  readonly preview?: StatusPreview<GbdStatusPayload>;
};

const PURPOSE = "Population estimates from IHME GBD. Not a statement about a person.";

export const GBD_PENDING_NOTE =
  "IHME’s GBD 2023 server is not yet open to other clients. TwinLLM’s connection is pending IHME’s OK.";

/**
 * Connectors inventory for IHME GBD population estimates.
 * Status names only — no schemas, no results, no person-level claim.
 */
export const GbdCard = ({ setup, preview }: GbdCardProps) => {
  const [status] = useConnectorStatus("/api/gbd/status", isGbdStatusPayload, preview);

  if (status.state === "loading") return <ConnectorCardSkeleton name="GBD" />;
  if (status.state === "failed") {
    return (
      <ConnectorCardUnavailable
        name="GBD"
        purpose={PURPOSE}
        setup={<SetupDisclosure setup={setup} />}
      />
    );
  }
  const payload = status.payload;

  const configured = payload.configured;
  const failed = payload.configured && payload.state === "error";

  return (
    <ConnectorCard
      name="GBD"
      purpose={PURPOSE}
      badge={connectorBadge({ configured, connected: configured && !failed, failed })}
      notice={
        !configured
          ? { text: GBD_PENDING_NOTE, tone: "info" }
          : failed
            ? { text: "The GBD server didn’t answer. Try again later.", tone: "warn" }
            : null
      }
      setup={<SetupDisclosure setup={setup} />}
    >
      {payload.configured && payload.state === "ok" && payload.tools.length > 0 && (
        <ul className="text-muted-foreground mt-3 space-y-1 font-mono text-xs">
          {payload.tools.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </ConnectorCard>
  );
};
