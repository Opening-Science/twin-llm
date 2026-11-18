"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { setupGap, type ConnectorSetupView } from "@/features/connectors/connector-setup";
import { deviceRow } from "@/features/connectors/device-rows";
import { DeviceList } from "@/infrastructure/charts/kit";
import { formatDate, isoLocalDate } from "@/infrastructure/format-measure";
import { buttonClassName } from "@/infrastructure/ui-kit/button";
import { SegmentedControl } from "@/infrastructure/ui-kit/segmented-control";

import { heroEyebrow, SOURCE_LABEL, type WearableSource } from "./dashboard-headings";
import { defaultDateRange, type DateRangeValue } from "./date-range-bar";
import { kitSections, type KitSection } from "./kit-cards";
import { KitDashboard } from "./kit-dashboard";
import { firstLinkedSource, linkedSources, WEARABLE_ORDER } from "./linked-source";
import { filterMetricsByRange, type Summary } from "./metric-utils";
import {
  OVERVIEW_LINK,
  OVERVIEW_PERIOD_LABEL,
  OVERVIEW_SOURCE_LABEL,
  overviewEmptyText,
  overviewNoSnapshotText,
} from "./overview-copy";
import { useWearableDetail } from "./use-wearable-detail";
import type { ConnectorStatus } from "./wearables-screen";

/**
 * The wearables part of the Dashboard page: the same Sources list, eyebrow
 * and chart-kit cards as Customize · Connectors (`KitDashboard`, `kitSections`),
 * over the same default window, one period at a time. Every card's numbers
 * come from the source named above them and in the Data sources list; this
 * file computes no value. Linking, syncing and the full metric tables stay on
 * Connectors.
 */

type Props = Readonly<{
  statuses: Readonly<Record<WearableSource, ConnectorStatus>>;
  summaries: Readonly<Record<WearableSource, Summary | null>>;
  setups: Readonly<Record<WearableSource, ConnectorSetupView>>;
}>;

const PERIODS: readonly KitSection["id"][] = ["daily", "weekly", "monthly"];
const PERIOD_LABEL: Readonly<Record<KitSection["id"], string>> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const Body = ({ children }: Readonly<{ children: string }>) => (
  <p className="text-muted-foreground max-w-xl text-[15px] leading-relaxed">{children}</p>
);

const LinkedView = ({
  source,
  summary,
}: Readonly<{ source: WearableSource; summary: Summary }>) => {
  const [range] = useState<DateRangeValue>(defaultDateRange);
  const [period, setPeriod] = useState<KitSection["id"]>("daily");
  const metrics = useMemo(
    () => filterMetricsByRange(summary.metrics, range.startDate, range.endDate),
    [summary, range],
  );
  const detail = useWearableDetail(source, range, summary);
  const sections = useMemo(() => {
    const now = new Date();
    return kitSections({
      source,
      metrics,
      today: isoLocalDate(now),
      detail,
      nowMinutes: now.getHours() * 60 + now.getMinutes(),
    });
  }, [metrics, source, detail]);
  const shown = sections.filter((section) => section.id === period);
  const options = PERIODS.filter((id) => sections.some((section) => section.id === id));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-eyebrow">
            {heroEyebrow(source, range.startDate, range.endDate)}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            {`Last sync window ${formatDate(summary.window.startDate)} → ${formatDate(summary.window.endDate)}`}
          </p>
        </div>
        {options.length > 1 && (
          <SegmentedControl
            label={OVERVIEW_PERIOD_LABEL}
            options={options.map((id) => ({ value: id, label: PERIOD_LABEL[id] }))}
            value={period}
            onChange={setPeriod}
          />
        )}
      </div>
      <KitDashboard sections={shown} source={source} />
    </div>
  );
};

export const WearablesOverview = ({ statuses, summaries, setups }: Props) => {
  const connected = {
    oura: statuses.oura.connected,
    whoop: statuses.whoop.connected,
    "google-health": statuses["google-health"].connected,
  };
  const linked = linkedSources(connected);
  const [source, setSource] = useState<WearableSource>(() =>
    firstLinkedSource(connected, "oura"),
  );
  const rowFor = (id: WearableSource) =>
    deviceRow({
      source: id,
      configured: statuses[id].configured,
      connected: statuses[id].connected,
      lastSyncAt: statuses[id].lastSyncAt,
      failed: false,
      idleDetail: statuses[id].configured ? null : setupGap(setups[id]),
    });

  if (linked.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Body>
          {overviewEmptyText({
            anyConfigured: WEARABLE_ORDER.some((id) => statuses[id].configured),
          })}
        </Body>
        <div className="max-w-2xl">
          <DeviceList
            category="vitals"
            title="Sources"
            rows={WEARABLE_ORDER.map(rowFor)}
          />
        </div>
        <Link
          href={OVERVIEW_LINK.href}
          className={buttonClassName({ variant: "primary", className: "self-start" })}
        >
          {OVERVIEW_LINK.label}
        </Link>
      </div>
    );
  }

  const shown = linked.includes(source) ? source : linked[0]!;
  const summary = summaries[shown];
  return (
    <div className="flex flex-col gap-6">
      {linked.length > 1 && (
        <SegmentedControl
          label={OVERVIEW_SOURCE_LABEL}
          options={linked.map((id) => ({ value: id, label: SOURCE_LABEL[id] }))}
          value={shown}
          onChange={setSource}
        />
      )}
      {summary ? (
        <LinkedView key={shown} source={shown} summary={summary} />
      ) : (
        <Body>{overviewNoSnapshotText(shown)}</Body>
      )}
      <div className="max-w-2xl">
        <DeviceList category="vitals" title="Data sources" rows={linked.map(rowFor)} />
      </div>
    </div>
  );
};
