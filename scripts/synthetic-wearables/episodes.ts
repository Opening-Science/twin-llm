/**
 * The generic episode of generator v3: a few days of raised resting heart
 * rate, lower RMSSD and faster breathing, as after a short illness or a hard
 * week. Not tied to any condition.
 *
 * Episodes are anchored to calendar days, not to the series window: whether a
 * day starts an episode comes from a hash of the subject key and the day, so
 * the same subject has the same episodes whichever window is generated, and an
 * episode is as likely before an onset as after it. v2 placed its one episode
 * in the last 30 days of the window (`series.ts`, kept for v2 only).
 *
 * Pure: no I/O, no clock.
 */
import { addDays, draw } from "./conditions";

/** Assumption: about one episode per person-year, so one day in 365 starts one. */
export const EPISODE_STARTS_PER_DAY = 1 / 365;
/** Assumption: an episode lasts 4 to 6 days, as the v2 one did. */
export const EPISODE_MIN_DAYS = 4;
export const EPISODE_MAX_DAYS = 6;

/** Days the episode starting on `start` lasts, or 0 when no episode starts that day. */
const episodeLengthFrom = (key: string, start: string): number =>
  draw(key, "episode-start", start) < EPISODE_STARTS_PER_DAY
    ? EPISODE_MIN_DAYS +
      Math.floor(
        draw(key, "episode-length", start) * (EPISODE_MAX_DAYS - EPISODE_MIN_DAYS + 1),
      )
    : 0;

/** Whether `day` (YYYY-MM-DD) falls in one of the subject's generic episodes. */
export const inGenericEpisode = (key: string, day: string): boolean =>
  Array.from({ length: EPISODE_MAX_DAYS }, (_, back) => back).some(
    (back) => episodeLengthFrom(key, addDays(day, -back)) > back,
  );
