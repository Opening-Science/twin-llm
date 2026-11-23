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

  const onSync = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const scanKey = new FormData(event.currentTarget).get("probandId");
    setBusy(true);
    setFlash(null);
    let synced = false;
    try {
      const response = await fetch("/api/vitronic/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(scanKey ? { probandId: Number(scanKey) } : {}),
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        setFlash(
          body &&
            typeof body === "object" &&
            "error" in body &&
            typeof body.error === "string"
            ? body.error
            : "Could not sync BodyLoop.",
        );
        return;
      }
      synced = true;
      const latest = await fetch("/api/vitronic/status");
      const value: unknown = latest.ok ? await latest.json() : null;
      if (!isVitronicStatusPayload(value) || !value.connected) {
        setFlash(
          "BodyLoop synced, but its status could not be refreshed. Reload the page.",
        );
        return;
      }
      setPayload(value);
    } catch {
      setFlash(
        synced
          ? "BodyLoop synced, but its status could not be refreshed. Reload the page."
          : "Could not sync BodyLoop.",
      );
    } finally {
      setBusy(false);
    }
  };

  const onConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setFlash(null);
    let saved = false;
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
      saved = true;
      formElement.reset();
      const status = await fetch("/api/vitronic/status");
      const value: unknown = status.ok ? await status.json() : null;
      if (!isVitronicStatusPayload(value) || !value.connected) {
        setFlash(
          "BodyLoop was saved, but its status could not be refreshed. Reload the page.",
        );
        return;
      }
      setPayload(value);
    } catch {
      setFlash(
        saved
          ? "BodyLoop was saved, but its status could not be refreshed. Reload the page."
          : "Could not store BodyLoop connection.",
      );
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
          <div className="space-y-1">
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => void onSync(event)}
            >
              <Field
                key={`${payload.probandId}:${payload.scanKeyLocked}`}
                className="w-32"
                label="Scan key"
                name="probandId"
                type="number"
                inputMode="numeric"
                min={1}
                max={2_147_483_647}
                step={1}
                defaultValue={payload.probandId ?? ""}
                readOnly={payload.scanKeyLocked || busy}
                required
              />
              <Button type="submit" size="sm" disabled={busy}>
                Sync scan
              </Button>
            </form>
            <p className="text-muted-foreground text-xs">
              {payload.scanKeyLocked
                ? "The scan key is locked because this subject has imported scans."
                : "Enter the subject's proband ID. A successful sync saves the key."}
            </p>
          </div>
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
