"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { buttonClassName } from "@/infrastructure/ui-kit/button";

import {
  ARK_STATE_LABEL,
  ARK_STATE_TONE,
  isArkStatusPayload,
  type ArkStatusPayload,
} from "./ark-status-view";
import {
  ConnectorCard,
  ConnectorCardSkeleton,
  ConnectorCardUnavailable,
} from "./connector-card";
import { setupGap, type ConnectorSetupView } from "./connector-setup";
import { connectorBadge } from "./connector-status";
import { SetupDisclosure } from "./setup-disclosure";
import { useConnectorStatus, type StatusPreview } from "./use-connector-status";

export type {
  ArkSlotView,
  ArkStatusDisabled,
  ArkStatusOk,
  ArkStatusPayload,
  ArkStatusUnavailable,
} from "./ark-status-view";

export const ARK_CARD_HREF = "/digital-twin";

/**
 * Connectors inventory for the Ark. "Not configured" when GENOME_SOURCE is none;
 * the device's own state word (Locked, Busy …) is the detail under the badge.
 * Copy is slot and device state only — no clinical claims.
 */

const flagLabel = (on: boolean | null, yes: string, no: string): string => {
  if (on === null) return "Unknown";
  return on ? yes : no;
};

const pathsCopy = (count: number, allGenome: boolean): string =>
  allGenome ? `${count} readable paths, all under v1/genome` : `${count} readable paths`;

type ArkCardProps = {
  readonly setup: ConnectorSetupView;
  readonly preview?: StatusPreview<ArkStatusPayload>;
};

const PURPOSE = "Genome slots on a local Ark device. Device and slot state only.";

const ArkCardFrame = ({
  payload,
  setup,
  children,
}: {
  readonly payload: Exclude<ArkStatusPayload, { enabled: false }>;
  readonly setup: ConnectorSetupView;
  readonly children?: ReactNode;
}) => (
  <ConnectorCard
    name="Ark"
    purpose={PURPOSE}
    badge={connectorBadge({
      configured: true,
      connected: payload.state === "ok",
      failed: ARK_STATE_TONE[payload.state] === "warn",
    })}
    detail={ARK_STATE_LABEL[payload.state]}
    notice={
      payload.state === "busy" ? { text: "Close the Ark Hub tab", tone: "info" } : null
    }
    actions={
      <Link href={ARK_CARD_HREF} className={buttonClassName({ size: "sm" })}>
        Open Digital Twin
      </Link>
    }
    setup={<SetupDisclosure setup={setup} />}
  >
    {children}
  </ConnectorCard>
);

export const ArkCard = ({ setup, preview }: ArkCardProps) => {
  const [status] = useConnectorStatus("/api/ark/status", isArkStatusPayload, preview);

  if (status.state === "loading") return <ConnectorCardSkeleton name="Ark" />;
  if (status.state === "failed") {
    return (
      <ConnectorCardUnavailable
        name="Ark"
        purpose={PURPOSE}
        setup={<SetupDisclosure setup={setup} />}
      />
    );
  }
  const payload = status.payload;

  if (!payload.enabled) {
    return (
      <ConnectorCard
        name="Ark"
        purpose={PURPOSE}
        badge={connectorBadge({ configured: false, connected: false, failed: false })}
        detail={setupGap(setup)}
        setup={<SetupDisclosure setup={setup} />}
      />
    );
  }

  if (payload.state !== "ok") return <ArkCardFrame payload={payload} setup={setup} />;

  return (
    <ArkCardFrame payload={payload} setup={setup}>
      <dl className="text-muted-foreground mt-3 space-y-1 text-xs">
        <div className="flex justify-between gap-3">
          <dt>Hardware</dt>
          <dd className="text-foreground text-right">
            {payload.hardware.model} ({payload.hardware.version})
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Firmware</dt>
          <dd className="text-foreground text-right">{payload.firmware}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Trust</dt>
          <dd className="text-foreground text-right">{payload.trust}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Paired</dt>
          <dd className="text-foreground text-right">
            {flagLabel(payload.paired, "Paired", "Not paired")}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>Unlocked</dt>
          <dd className="text-foreground text-right">
            {flagLabel(payload.unlocked, "Unlocked", "Locked")}
          </dd>
        </div>
      </dl>
      <ul className="mt-3 space-y-1">
        {payload.slots.map((entry) => (
          <li
            key={entry.slot}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span>{entry.name}</span>
            <span className="text-muted-foreground">
              {entry.state === "empty" ? "Empty" : "Filled"}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
        {pathsCopy(payload.pathCount, payload.allGenome)}
      </p>
    </ArkCardFrame>
  );
};
