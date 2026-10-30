/**
 * A countdown that can pause, as plain values: no timers inside, so the
 * component owns the clock and tests can pass any `now`. `since` is when it
 * last started running, or null while paused.
 */
export type Countdown = Readonly<{ remaining: number; since: number | null }>;

export const startCountdown = (total: number, now: number): Countdown => ({
  remaining: Math.max(0, total),
  since: now,
});

export const remainingAt = (countdown: Countdown, now: number): number =>
  countdown.since === null
    ? countdown.remaining
    : Math.max(0, countdown.remaining - (now - countdown.since));

export const pauseCountdown = (countdown: Countdown, now: number): Countdown =>
  countdown.since === null
    ? countdown
    : { remaining: remainingAt(countdown, now), since: null };

export const resumeCountdown = (countdown: Countdown, now: number): Countdown =>
  countdown.since === null ? { remaining: countdown.remaining, since: now } : countdown;

/** Paused when any reason holds: a hovering mouse that came back, or a hidden tab. */
export const pausedBy = (reasons: Readonly<{ hovered: boolean; hidden: boolean }>) =>
  reasons.hovered || reasons.hidden;
