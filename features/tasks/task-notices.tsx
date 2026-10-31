"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/infrastructure/ui-kit/button";
import { BellIcon } from "@/infrastructure/ui-kit/icons";

import {
  badgeLabel,
  NO_NOTICE,
  noticeSentence,
  readNotice,
  type TaskNoticeState,
  toastIsDue,
} from "./task-notice-model";

/**
 * In-app notices of scheduled runs (#54): one poll of `/api/tasks/notice`
 * for the whole shell, a badge beside Customize in the sidebar, and a toast
 * when a new result arrives. Only tasks whose bell is on are counted. There
 * is no OS, email or push notification.
 */

const POLL_MS = 30_000;

const store = {
  state: NO_NOTICE as TaskNoticeState,
  listeners: new Set<() => void>(),
};

const publish = (next: TaskNoticeState): void => {
  Object.assign(store, { state: next });
  store.listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  store.listeners.add(listener);
  return () => {
    store.listeners.delete(listener);
  };
};

const useNotice = (): TaskNoticeState =>
  useSyncExternalStore(
    subscribe,
    () => store.state,
    () => NO_NOTICE,
  );

/** Clears the badge and toast at once, after the Tasks panel marked everything seen. */
export const clearTaskNotices = (): void => publish(NO_NOTICE);

/** The sidebar's badge: a count, read out as words. Nothing while there is none. */
export const TaskNoticeBadge = () => {
  const { unseen } = useNotice();
  if (unseen === 0) return null;
  return (
    <span className="task-notice-badge ml-auto">
      <span aria-hidden="true">{unseen}</span>
      <span className="sr-only">{`, ${badgeLabel(unseen)}`}</span>
    </span>
  );
};

/** The poller and the toast; mounted once in the shell. */
export const TaskNotices = ({
  markSeen,
}: Readonly<{ markSeen: () => Promise<void> }>) => {
  const notice = useNotice();
  const path = usePathname();
  const [shownAt, setShownAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const poll = async () => {
      const response = await fetch("/api/tasks/notice", { cache: "no-store" }).catch(
        () => null,
      );
      if (response === null || !response.ok) return;
      publish(readNotice(await response.json().catch(() => null)));
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [path]);

  const due = toastIsDue(notice, shownAt);
  if (due && notice.latest !== null) {
    // Settles in the same render: the toast opens once per new result.
    setShownAt(notice.latest.at);
    setOpen(true);
  }

  const threadId = notice.latest?.threadId ?? null;
  return (
    <div role="status" aria-live="polite" className="task-toast-region">
      {open && notice.unseen > 0 && (
        <div className="task-toast surface">
          <BellIcon className="size-4" />
          <p className="text-sm">{noticeSentence(notice)}</p>
          <span className="flex gap-2">
            {threadId !== null && (
              <Link
                href={`/t/${threadId}`}
                className="chip"
                onClick={() => {
                  setOpen(false);
                  publish(NO_NOTICE);
                  void markSeen();
                }}
              >
                Open thread
              </Link>
            )}
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Dismiss
            </Button>
          </span>
        </div>
      )}
    </div>
  );
};
