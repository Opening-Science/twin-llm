"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import type { OuraSummary } from "@/infrastructure/oura-types";
import type { WhoopSummary } from "@/infrastructure/whoop-types";
import type { GoogleHealthSummary } from "@/infrastructure/google-health-types";
import type { LiveSourceId } from "@/infrastructure/live-sources";
import { ArkCard } from "@/features/connectors/ark-card";
import { ConnectorCard } from "@/features/connectors/connector-card";
import {
  RETURN_SOURCES,
  type ConnectorReturnNotice,
} from "@/features/connectors/connector-return";
import {
  setupGap,
  type ConnectorId,
  type ConnectorSetupView,
} from "@/features/connectors/connector-setup";
import {
  connectorBadge,
  loopbackHostHint,
  syncDetail,
} from "@/features/connectors/connector-status";
import { GbdCard } from "@/features/connectors/gbd-card";
import { GuidelinesCard } from "@/features/connectors/guidelines-card";
import { LiveSourceCards } from "@/features/connectors/live-sources-card";
import type { GuidelineCorpusStatus } from "@/features/connectors/guideline-status-view";
import { SetupDisclosure } from "@/features/connectors/setup-disclosure";
import { VitronicCard } from "@/features/vitronic/vitronic-card";
import { Button, buttonClassName } from "@/infrastructure/ui-kit/button";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import { SOURCE_LABEL, type WearableSource } from "./dashboard-headings";
import { DateRangeBar, defaultDateRange, type DateRangeValue } from "./date-range-bar";
import { WearablesDashboard } from "./wearables-dashboard";

export type { WearableSource } from "./dashboard-headings";

export type ConnectorStatus = Readonly<{
  configured: boolean;
  connected: boolean;
  linkedAt: string | null;
  lastSyncAt: string | null;
}>;

type ViewMode = "single" | "compare";

const VIEW_OPTIONS = [
  { value: "single", label: "Single" },
  { value: "compare", label: "Compare" },
] as const satisfies readonly { value: ViewMode; label: string }[];

type WearablesScreenProps = {
  readonly ouraStatus: ConnectorStatus;
  readonly whoopStatus: ConnectorStatus;
  readonly googleHealthStatus: ConnectorStatus;
  readonly ouraSummary: OuraSummary | null;
  readonly whoopSummary: WhoopSummary | null;
  readonly googleHealthSummary: GoogleHealthSummary | null;
  readonly initialSource: WearableSource;
  /** Env names and booleans per connector, built on the server. */
  readonly setups: Readonly<Record<ConnectorId, ConnectorSetupView>>;
  /** What `/connectors?oura=…` said, parsed on the server. */
  readonly returnNotice: ConnectorReturnNotice | null;
  readonly guidelineStatus: GuidelineCorpusStatus;
  /** Live public lookups (#6): the person's switches, off by default. */
  readonly liveSources: Readonly<{
    enabled: readonly LiveSourceId[];
    localOnly: boolean;
    canSave: boolean;
  }>;
};

type CardNotice = Readonly<{
  source: WearableSource;
  text: string;
  failed: boolean;
  retry: boolean;
}>;

const WEARABLES: readonly Readonly<{
  id: WearableSource;
  name: string;
  purpose: string;
}>[] = [
  {
    id: "oura",
    name: "Oura Ring",
    purpose: "Sleep, readiness and activity for personalised answers.",
  },
  {
    id: "whoop",
    name: "Whoop",
    purpose: "Recovery, strain and sleep for personalised answers.",
  },
  {
    id: "google-health",
    name: "Google Health",
    purpose: "Steps, sleep, HRV and activity from a Fitbit-linked Google account.",
  },
];

const UPCOMING = [
  {
    name: "Apple Watch",
    blurb: "HealthKit bridge — sleep, HR, activity. Native companion required for web.",
  },
  {
    name: "Dyson",
    blurb: "Purifiers and fans — air quality, temperature, and room climate context.",
  },
  {
    name: "Smart home",
    blurb: "Lights, HVAC, and environment sensors that shape recovery and sleep.",
  },
  {
    name: "Home Assistant",
    blurb: "Local hub bridge for the devices already on your network.",
  },
] as const;

/** The return word was read on the server; drop it so a reload doesn't repeat it. */
const stripReturnParams = (): void => {
  const params = new URLSearchParams(window.location.search);
  if (!RETURN_SOURCES.some((key) => params.has(key))) return;
  for (const key of RETURN_SOURCES) params.delete(key);
  const query = params.toString();
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${query ? `?${query}` : ""}`,
  );
};

const Group = ({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) => (
  <section className="mt-8" aria-label={title}>
    <h2 className="text-eyebrow">{title}</h2>
    <div className="mt-3 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {children}
    </div>
  </section>
);

const WearableCard = ({
  id,
  name,
  purpose,
  status,
  setup,
  notice,
  selected,
  busy,
  onSelect,
  onSync,
  onDisconnect,
}: {
  readonly id: WearableSource;
  readonly name: string;
  readonly purpose: string;
  readonly status: ConnectorStatus;
  readonly setup: ConnectorSetupView;
  readonly notice: CardNotice | null;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly onSelect: () => void;
  readonly onSync: () => void;
  readonly onDisconnect: () => void;
}) => {
  const linkHref = `/api/${id}/authorize`;
  return (
    <ConnectorCard
      name={name}
      purpose={purpose}
      badge={connectorBadge({
        configured: status.configured,
        connected: status.connected,
        failed: notice?.failed ?? false,
      })}
      detail={
        !status.configured
          ? setupGap(setup)
          : status.connected
            ? syncDetail(status.lastSyncAt)
            : null
      }
      notice={
        notice ? { text: notice.text, tone: notice.failed ? "warn" : "info" } : null
      }
      selected={selected}
      actions={
        !status.configured ? null : status.connected ? (
          <>
            <Button size="sm" disabled={busy} onClick={onSync}>
              Refresh
            </Button>
            <Button variant="pill" size="sm" aria-pressed={selected} onClick={onSelect}>
              {selected ? "Viewing" : "View"}
            </Button>
            <Button variant="ghost" size="sm" disabled={busy} onClick={onDisconnect}>
              Unlink
            </Button>
          </>
        ) : (
          <a href={linkHref} className={buttonClassName({ size: "sm" })}>
            {notice?.retry ? "Try again" : `Link ${SOURCE_LABEL[id]}`}
          </a>
        )
      }
      setup={<SetupDisclosure setup={setup} />}
    />
  );
};

/**
 * Connectors, timeline, single-source dashboard, and multi-source compare.
 */
export const WearablesScreen = ({
  ouraStatus: initialOura,
  whoopStatus: initialWhoop,
  googleHealthStatus: initialGoogleHealth,
  ouraSummary,
  whoopSummary,
  googleHealthSummary,
  initialSource,
  setups,
  returnNotice,
  guidelineStatus,
  liveSources,
}: WearablesScreenProps) => {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cardNotice, setCardNotice] = useState<CardNotice | null>(returnNotice);
  const [hostHint, setHostHint] = useState<string | null>(null);
  const [busy, setBusy] = useState<WearableSource | "both" | null>(null);
  const [ouraStatus, setOuraStatus] = useState(initialOura);
  const [whoopStatus, setWhoopStatus] = useState(initialWhoop);
  const [googleHealthStatus, setGoogleHealthStatus] = useState(initialGoogleHealth);
  const [range, setRange] = useState<DateRangeValue>(defaultDateRange);
  const [view, setView] = useState<ViewMode>("single");
  const [source, setSource] = useState<WearableSource>(() => {
    if (initialSource === "whoop" && initialWhoop.connected) return "whoop";
    if (initialSource === "google-health" && initialGoogleHealth.connected) {
      return "google-health";
    }
    if (initialOura.connected) return "oura";
    if (initialWhoop.connected) return "whoop";
    if (initialGoogleHealth.connected) return "google-health";
    return "oura";
  });

  useEffect(() => {
    setMounted(true);
    stripReturnParams();
    setHostHint(loopbackHostHint(window.location.hostname, window.location.port));
  }, []);

  useEffect(() => {
    setOuraStatus(initialOura);
    setWhoopStatus(initialWhoop);
    setGoogleHealthStatus(initialGoogleHealth);
  }, [initialOura, initialWhoop, initialGoogleHealth]);

  const linkedCount =
    (ouraStatus.connected ? 1 : 0) +
    (whoopStatus.connected ? 1 : 0) +
    (googleHealthStatus.connected ? 1 : 0);
  const canCompare =
    ouraStatus.connected &&
    whoopStatus.connected &&
    Boolean(ouraSummary) &&
    Boolean(whoopSummary);

  useEffect(() => {
    if (view === "compare" && !canCompare) setView("single");
  }, [view, canCompare]);

  const refreshStatus = useCallback(async (id: WearableSource) => {
    const res = await fetch(`/api/${id}/status`);
    if (!res.ok) return;
    const data = (await res.json()) as ConnectorStatus;
    if (id === "oura") setOuraStatus(data);
    else if (id === "whoop") setWhoopStatus(data);
    else setGoogleHealthStatus(data);
  }, []);

  const sync = async (id: WearableSource, window = range) => {
    setBusy(id);
    setMessage(null);
    setCardNotice(null);
    try {
      const res = await fetch(`/api/${id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(window),
      });
      if (res.ok) setMessage("Metrics updated.");
      else {
        setCardNotice({
          source: id,
          text: `Couldn’t refresh ${SOURCE_LABEL[id]} metrics. Try Refresh again.`,
          failed: true,
          retry: false,
        });
      }
      await refreshStatus(id);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const syncWindow = async () => {
    const targets: WearableSource[] = [];
    if (view === "compare") {
      if (ouraStatus.connected) targets.push("oura");
      if (whoopStatus.connected) targets.push("whoop");
    } else if (
      (source === "oura" && ouraStatus.connected) ||
      (source === "whoop" && whoopStatus.connected) ||
      (source === "google-health" && googleHealthStatus.connected)
    ) {
      targets.push(source);
    }
    if (targets.length === 0) return;
    setBusy(targets.length > 1 ? "both" : targets[0]!);
    setMessage(null);
    try {
      const results = await Promise.all(
        targets.map((id) =>
          fetch(`/api/${id}/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(range),
          }),
        ),
      );
      const ok = results.every((r) => r.ok);
      setMessage(ok ? "Window synced." : "Couldn’t sync the full window.");
      await Promise.all(targets.map((id) => refreshStatus(id)));
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (id: WearableSource) => {
    setBusy(id);
    setCardNotice(null);
    try {
      await fetch(`/api/${id}/disconnect`, { method: "DELETE" });
      setMessage(`${SOURCE_LABEL[id]} unlinked.`);
      await refreshStatus(id);
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const statuses: Readonly<Record<WearableSource, ConnectorStatus>> = {
    oura: ouraStatus,
    whoop: whoopStatus,
    "google-health": googleHealthStatus,
  };

  const activeSummary =
    source === "oura"
      ? ouraSummary
      : source === "whoop"
        ? whoopSummary
        : googleHealthSummary;
  const activeConnected =
    source === "oura"
      ? ouraStatus.connected
      : source === "whoop"
        ? whoopStatus.connected
        : googleHealthStatus.connected;

  return (
    <div className="w-full">
      <h2 className="sr-only">Connectors</h2>
      <p className="text-muted-foreground max-w-xl text-[15px] leading-relaxed">
        Link devices and home systems, pick a timeline, and read synced metrics. TwinLLM
        uses the same snapshots. Cross-source interpretation comes later — compare shows
        the numbers side by side first.
      </p>

      {mounted && message && (
        <p className="text-muted-foreground mt-4 text-sm">{message}</p>
      )}

      {hostHint && (
        <p role="status" className="text-foreground mt-4 max-w-xl text-sm font-medium">
          {hostHint}
        </p>
      )}

      <Group title="Wearables">
        {WEARABLES.map((wearable) => {
          const status = statuses[wearable.id];
          return (
            <WearableCard
              key={wearable.id}
              id={wearable.id}
              name={wearable.name}
              purpose={wearable.purpose}
              status={status}
              setup={setups[wearable.id]}
              notice={cardNotice?.source === wearable.id ? cardNotice : null}
              selected={view === "single" && source === wearable.id && status.connected}
              busy={busy === wearable.id || busy === "both"}
              onSelect={() => {
                setView("single");
                setSource(wearable.id);
              }}
              onSync={() => void sync(wearable.id)}
              onDisconnect={() => void disconnect(wearable.id)}
            />
          );
        })}
      </Group>

      <Group title="Body scan">
        <VitronicCard setup={setups.bodyloop} />
      </Group>

      <Group title="Population and knowledge">
        <GbdCard setup={setups.gbd} />
        <GuidelinesCard status={guidelineStatus} setup={setups.guidelines} />
      </Group>

      <Group title="Live public lookups">
        <LiveSourceCards
          initialEnabled={liveSources.enabled}
          localOnly={liveSources.localOnly}
          canSave={liveSources.canSave}
        />
      </Group>

      <Group title="Devices">
        <ArkCard setup={setups.ark} />
      </Group>

      <h2 className="text-eyebrow mt-12">Dashboard</h2>

      {linkedCount > 0 && (
        <DateRangeBar
          value={range}
          onChange={setRange}
          onApplySync={() => void syncWindow()}
          syncing={busy !== null}
          canSync={linkedCount > 0}
        />
      )}

      {canCompare && (
        <SegmentedControl
          label="Dashboard mode"
          className="mt-6"
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
        />
      )}

      <div className="mt-6">
        <WearablesDashboard
          view={view}
          source={source}
          range={range}
          activeConnected={activeConnected}
          activeSummary={activeSummary}
          ouraSummary={ouraSummary}
          whoopSummary={whoopSummary}
          busy={busy !== null}
          onSync={() => void sync(source)}
          linkedSources={WEARABLES.filter(
            (wearable) => statuses[wearable.id].connected,
          ).map((wearable) => ({
            id: wearable.id,
            name: wearable.name,
            detail: syncDetail(statuses[wearable.id].lastSyncAt),
          }))}
        />
      </div>

      <h2 className="text-eyebrow mt-12">Coming next</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {UPCOMING.map((item) => (
          <div
            key={item.name}
            className="border-border rounded-xl border border-dashed px-4 py-4"
          >
            <p className="text-sm font-medium">{item.name}</p>
            <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
              {item.blurb}
            </p>
            <p className="text-eyebrow mt-3">Soon</p>
          </div>
        ))}
      </div>
    </div>
  );
};
