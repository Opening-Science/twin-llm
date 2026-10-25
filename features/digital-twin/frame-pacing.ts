/**
 * Auto-rotate is the only thing that keeps the on-demand canvas drawing when
 * nobody touches it. A slow turn reads fine at 30 fps, so it asks for about
 * half the frames a 60 Hz display would draw, and none while the canvas is off
 * screen. Kept pure so the pacing is testable without a renderer or a clock.
 */
export const AUTO_ROTATE_FPS = 30;
export const AUTO_ROTATE_INTERVAL_MS = 1000 / AUTO_ROTATE_FPS;
/**
 * A request only draws on the next display frame after it. Asking half a 60 Hz
 * frame early lands the draw on the 30 fps beat instead of one frame late
 * (which would be 20 fps on a 60 Hz display).
 */
export const VSYNC_SLACK_MS = 8;

/**
 * Milliseconds to wait before asking for the next auto-rotate frame, or null to
 * stop asking (off screen). A frame that is due within a millisecond, or late,
 * is asked for now; timers are millisecond-grained anyway.
 */
export const nextAutoRotateDelay = ({
  lastDrawMs,
  nowMs,
  visible,
  intervalMs = AUTO_ROTATE_INTERVAL_MS,
}: Readonly<{
  lastDrawMs: number;
  nowMs: number;
  visible: boolean;
  intervalMs?: number;
}>): number | null => {
  if (!visible) return null;
  const remaining = lastDrawMs + intervalMs - VSYNC_SLACK_MS - nowMs;
  return remaining < 1 ? 0 : remaining;
};
