"use client";

import { useState, type FormEvent } from "react";

import {
  ConnectorCard,
  ConnectorCardSkeleton,
  ConnectorCardUnavailable,
} from "@/features/connectors/connector-card";
import { setupGap, type ConnectorSetupView } from "@/features/connectors/connector-setup";
import { connectorBadge, syncDetail } from "@/features/connectors/connector-status";
import { SetupDisclosure } from "@/features/connectors/setup-disclosure";
import {
  useConnectorStatus,
  type StatusPreview,
} from "@/features/connectors/use-connector-status";
import { Button } from "@/infrastructure/ui-kit/button";
import { Field } from "@/infrastructure/ui-kit/field";

import {
  isVitronicStatusPayload,
  type VitronicStatusPayload,
} from "./vitronic-status-view";

type VitronicCardProps = {
  readonly setup: ConnectorSetupView;
  readonly preview?: StatusPreview<VitronicStatusPayload>;
};

const detailFor = (payload: VitronicStatusPayload): string | null => {
  if (payload.connected) {
    const sync = syncDetail(payload.lastSyncAt);
    return payload.tlsFingerprintPrefix
      ? `${sync} · TLS pin ${payload.tlsFingerprintPrefix}`
      : sync;
  }
  return payload.configured && payload.hasAvatar ? "Scan on file" : null;
};

/**
 * Connectors inventory for BodyLoop scan measurements.
 * Status names only — no mesh, no person-level claim.
 */
const PURPOSE =
  "BodyLoop scan measurements. Not a statement about a person. The 3D mesh stays on Digital Twin.";

export const VitronicCard = ({ setup, preview }: VitronicCardProps) => {
  const [status, setPayload] = useConnectorStatus(
    "/api/vitronic/status",
    isVitronicStatusPayload,
    preview,
  );
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const onConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setFlash(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/vitronic/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          baseUrl: String(form.get("baseUrl") ?? ""),
          apiToken: String(form.get("apiToken") ?? ""),
          probandId: Number(form.get("probandId")),
          uploadSecret: String(form.get("uploadSecret") ?? ""),
          apiTokenName: String(form.get("apiTokenName") ?? "") || undefined,
        }),
      });
      if (!response.ok) {
        setFlash("Could not store BodyLoop connection.");
        return;
      }
      event.currentTarget.reset();
      const status = await fetch("/api/vitronic/status");
      const value: unknown = status.ok ? await status.json() : null;
      if (isVitronicStatusPayload(value)) setPayload(value);
    } catch {
      setFlash("Could not store BodyLoop connection.");
    } finally {
      setBusy(false);
    }
  };

  if (status.state === "loading") return <ConnectorCardSkeleton name="BodyLoop" />;
  if (status.state === "failed") {
    return (
      <ConnectorCardUnavailable
        name="BodyLoop"
        purpose={PURPOSE}
        setup={<SetupDisclosure setup={setup} />}
      />
    );
  }
  const payload = status.payload;

  const configured = payload.configured;
  return (
    <ConnectorCard
      name="BodyLoop"
      purpose={PURPOSE}
      badge={connectorBadge({
        configured,
        connected: payload.connected,
        failed: flash !== null,
      })}
      detail={configured ? detailFor(payload) : setupGap(setup)}
      notice={flash ? { text: flash, tone: "warn" } : null}
      actions={
        configured && payload.connected ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setFlash(null);
              void fetch("/api/vitronic/sync", { method: "POST" })
                .then(async (response) => {
                  if (!response.ok) {
                    setFlash("Could not sync BodyLoop.");
                    return;
                  }
                  const status = await fetch("/api/vitronic/status");
                  const value: unknown = status.ok ? await status.json() : null;
                  if (isVitronicStatusPayload(value)) setPayload(value);
                })
                .catch(() => {
                  setFlash("Could not sync BodyLoop.");
                })
                .finally(() => {
                  setBusy(false);
                });
            }}
          >
            Sync scan
          </Button>
        ) : null
      }
      setup={<SetupDisclosure setup={setup} />}
    >
      {configured && !payload.connected && (
        <details className="setup-disclosure mt-3">
          <summary>Connect a scanner</summary>
          <form className="mt-3 space-y-3" onSubmit={(event) => void onConnect(event)}>
            <Field
              label="Scanner URL"
              name="baseUrl"
              type="url"
              required
              placeholder="https://scanner.example"
            />
            <Field
              label="API token"
              name="apiToken"
              type="password"
              required
              autoComplete="off"
            />
            <Field
              label="Scan key"
              name="probandId"
              type="number"
              required
              min={1}
              step={1}
            />
            <Field label="Token name" hint="Optional." name="apiTokenName" type="text" />
            <Field
              label="Upload secret"
              name="uploadSecret"
              type="password"
              required
              autoComplete="off"
            />
            <Button type="submit" disabled={busy}>
              Save connection
            </Button>
          </form>
        </details>
      )}
    </ConnectorCard>
  );
};
