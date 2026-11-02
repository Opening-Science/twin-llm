"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { StatusLattice } from "@/infrastructure/ui-kit/status-lattice";

import { anyRunning, type LabJob, liveElapsedMs } from "./lab-jobs";

/**
 * The Lab's long jobs as status lattices (#310). A running job's timer counts
 * on from the start its files give; a finished one shows the time its files
 * span, or none when they give none. While any job runs the page asks the
 * server to look again every few seconds, and stops when the tab is hidden
 * or nothing runs. It never starts a job.
 */

const TICK_MS = 1_000;
const REFRESH_MS = 5_000;

const useNow = (active: boolean): number | null => {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return;
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
};

const useRefreshWhile = (active: boolean) => {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [active, router]);
};

const JobLine = ({ job, now }: Readonly<{ job: LabJob; now: number | null }>) => {
  const elapsed =
    job.state === "working" && job.startedAtMs !== null && now !== null
      ? liveElapsedMs(job.startedAtMs, now)
      : job.elapsedMs;
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <span className="text-muted-foreground text-xs">{job.title}</span>
      {job.state === "none" ? (
        <span className="text-sm">Not run yet</span>
      ) : (
        <StatusLattice
          state={job.state}
          label={job.label}
          elapsedMs={elapsed}
          className="max-w-full font-mono text-xs"
        />
      )}
      <p className="text-muted-foreground text-sm leading-relaxed">{job.detail}</p>
    </li>
  );
};

export const JobLines = ({
  jobs,
  refresh = true,
}: Readonly<{ jobs: readonly LabJob[]; refresh?: boolean }>) => {
  const running = anyRunning(jobs);
  const now = useNow(running);
  useRefreshWhile(refresh && running);
  return (
    <ul className="flex flex-col gap-4">
      {jobs.map((job) => (
        <JobLine key={job.id} job={job} now={now} />
      ))}
    </ul>
  );
};
