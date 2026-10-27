/**
 * The small marks the compare screen draws: send, a failed answer, remove,
 * and the incognito toggle (a hat and glasses). Decorative only; the button or sentence beside each carries the
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
  incognito: (
    <>
      <path d="M2.5 9.5h15M5 9.5 6.5 4.5h7L15 9.5" />
      <circle cx="6.5" cy="13.5" r="2.25" />
      <circle cx="13.5" cy="13.5" r="2.25" />
      <path d="M8.75 13.5h2.5" />
    </>
  ),
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
