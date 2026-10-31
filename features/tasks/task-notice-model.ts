/**
 * The in-app notice of scheduled runs (#54), as plain values: what the shell
 * polls and when a new toast is due. Notices never leave TwinLLM: no OS,
 * email or push notification exists.
 */

export type TaskNoticeState = Readonly<{
  unseen: number;
  latest: Readonly<{ skill: string; threadId: string | null; at: string }> | null;
}>;

export const NO_NOTICE: TaskNoticeState = { unseen: 0, latest: null };

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

/** The route's body, or no notice when it is not the expected shape. */
export const readNotice = (body: unknown): TaskNoticeState => {
  if (!isRecord(body) || typeof body.unseen !== "number" || body.unseen < 0) {
    return NO_NOTICE;
  }
  const latest = body.latest;
  if (
    !isRecord(latest) ||
    typeof latest.skill !== "string" ||
    typeof latest.at !== "string" ||
    !(typeof latest.threadId === "string" || latest.threadId === null)
  ) {
    return { unseen: Math.floor(body.unseen), latest: null };
  }
  return {
    unseen: Math.floor(body.unseen),
    latest: { skill: latest.skill, threadId: latest.threadId, at: latest.at },
  };
};

/** A toast is due when there is an unseen result newer than the last one shown. */
export const toastIsDue = (current: TaskNoticeState, shownAt: string | null): boolean =>
  current.unseen > 0 && current.latest !== null && current.latest.at !== shownAt;

/** The toast's sentence. */
export const noticeSentence = (current: TaskNoticeState): string => {
  if (current.latest === null) return "";
  const first = `Scheduled /${current.latest.skill} finished.`;
  return current.unseen > 1
    ? `${first} ${String(current.unseen - 1)} more unseen on Customize · Tasks.`
    : first;
};

/** The badge's words for screen readers. */
export const badgeLabel = (unseen: number): string =>
  unseen === 1 ? "1 unseen scheduled run" : `${String(unseen)} unseen scheduled runs`;
