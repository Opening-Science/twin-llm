/**
 * The small marks the compare screen draws: send, stop, sources, a failed answer, remove,
 * and the incognito toggle (a hat and glasses). Decorative only; the button or sentence beside each carries the
 * meaning. They inherit `currentColor` and the caller's size.
 */
const MARK = {
  send: <path d="M10 16V4M5 9l5-5 5 5" />,
  stop: <rect x="5.5" y="5.5" width="9" height="9" rx="1.5" />,
  sources: (
    <>
      <circle cx="10" cy="10" r="2.75" />
      <path d="M12.75 10v1.25a2.25 2.25 0 0 0 4.5 0V10a7.25 7.25 0 1 0-2.9 5.8" />
    </>
  ),
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
