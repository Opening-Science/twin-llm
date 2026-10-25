/**
 * The three small marks the compare screen draws: send, a failed answer, and
 * remove. Decorative only; the button or sentence beside each carries the
 * meaning. They inherit `currentColor` and the caller's size.
 */
const MARK = {
  send: <path d="M10 16V4M5 9l5-5 5 5" />,
  alert: (
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6v4.5M10 13.6v.1" />
    </>
  ),
  remove: <path d="m6 6 8 8M14 6l-8 8" />,
} as const;

export const Mark = ({
  name,
  className = "size-4",
}: Readonly<{ name: keyof typeof MARK; className?: string }>) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    {MARK[name]}
  </svg>
);
