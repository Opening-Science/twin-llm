import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/infrastructure/ui";

/**
 * Line icons for the shell and the search box. Each is decorative: hidden
 * from assistive tech, drawn in the text colour and sized by the caller
 * (`size-4` unless told otherwise). The words beside an icon carry its
 * meaning.
 */

type IconProps = Readonly<Omit<ComponentProps<"svg">, "children">>;

const Line = ({ className, children, ...props }: IconProps & { children: ReactNode }) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={cn("size-4 shrink-0", className)}
    {...props}
  >
    {children}
  </svg>
);

export const SidebarIcon = (props: IconProps) => (
  <Line {...props}>
    <rect x="2.5" y="3.5" width="15" height="13" rx="2.5" />
    <path d="M7.5 3.5v13" />
  </Line>
);

export const SearchIcon = (props: IconProps) => (
  <Line {...props}>
    <circle cx="8.75" cy="8.75" r="5.25" />
    <path d="m12.75 12.75 4 4" />
  </Line>
);

export const PlusIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Line>
);

export const ChatIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z" />
  </Line>
);

export const BodyIcon = (props: IconProps) => (
  <Line {...props}>
    <circle cx="10" cy="4.25" r="1.75" />
    <path d="M5 8h10M10 8v4.5M10 12.5l-2.5 5M10 12.5l2.5 5" />
  </Line>
);

export const SlidersIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M4 5.5h7M15 5.5h1M4 14.5h1M9 14.5h7" />
    <circle cx="13" cy="5.5" r="2" />
    <circle cx="7" cy="14.5" r="2" />
  </Line>
);

export const StackIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="m10 3 7 3.5-7 3.5-7-3.5L10 3Z" />
    <path d="m3 10 7 3.5 7-3.5M3 13.5 10 17l7-3.5" />
  </Line>
);

export const FlaskIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M8 2.5h4M8.5 2.5v5L4 15.5A1.5 1.5 0 0 0 5.3 17.5h9.4a1.5 1.5 0 0 0 1.3-2L11.5 7.5v-5" />
    <path d="M6 12.5h8" />
  </Line>
);

export const BookIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M3 4.5c2.5-1 5-1 7 .5 2-1.5 4.5-1.5 7-.5v11c-2.5-1-5-1-7 .5-2-1.5-4.5-1.5-7-.5v-11Z" />
    <path d="M10 5v11" />
  </Line>
);

export const FlagIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M4.5 17.5v-14M4.5 4h9l-2 3.5 2 3.5h-9" />
  </Line>
);

export const DotsIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M5 10h.01M10 10h.01M15 10h.01" strokeWidth={2.6} />
  </Line>
);

export const PrinterIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M5.5 7.5v-4h9v4M5.5 14H4a1.5 1.5 0 0 1-1.5-1.5V9A1.5 1.5 0 0 1 4 7.5h12A1.5 1.5 0 0 1 17.5 9v3.5A1.5 1.5 0 0 1 16 14h-1.5" />
    <path d="M5.5 11.5h9v5h-9z" />
  </Line>
);

export const DownloadIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M10 3v9.5M6 9l4 4 4-4M3.5 16.5h13" />
  </Line>
);

export const LinkIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M8.5 11.5a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L10 5" />
    <path d="M11.5 8.5a3.5 3.5 0 0 0-5 0L4 11a3.5 3.5 0 0 0 5 5l1-1" />
  </Line>
);

export const TrashIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M3.5 5.5h13M8 5.5V3.5h4v2M5 5.5l.75 11h8.5L15 5.5" />
  </Line>
);

export const WarningIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M10 3 2.5 16.5h15L10 3Z" />
    <path d="M10 8.5v3.5M10 14.25h.01" />
  </Line>
);

export const PageIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M5 2.5h6.5l3.5 3.5v11.5H5z" />
    <path d="M11.5 2.5V6H15" />
  </Line>
);

export const SlashIcon = (props: IconProps) => (
  <Line {...props}>
    <rect x="2.5" y="2.5" width="15" height="15" rx="3" />
    <path d="m12 6-4 8" />
  </Line>
);

export const BoltIcon = (props: IconProps) => (
  <Line {...props}>
    <path d="M11 2.5 4.5 11H10l-1 6.5L15.5 9H10l1-6.5Z" />
  </Line>
);
