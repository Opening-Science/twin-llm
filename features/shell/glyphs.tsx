import type { ReactNode } from "react";

/**
 * The handful of line glyphs the shell needs, drawn here rather than taken from
 * an icon package that ships hundreds. They inherit `currentColor` and take
 * their size from the caller, so an icon never decides a colour or a size, and
 * they are always decorative: the text beside them carries the meaning.
 */
type GlyphProps = Readonly<{ className?: string }>;

const Svg = ({
  className = "size-4",
  children,
}: GlyphProps & { children: ReactNode }) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    {children}
  </svg>
);

/** Side-by-side answers: two speech panes. */
export const CompareGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <rect x="2.5" y="4" width="6.5" height="10" rx="1.5" />
      <rect x="11" y="4" width="6.5" height="10" rx="1.5" />
      <path d="M5 17h10" />
    </>
  </Svg>
);

/** A plug. */
export const ConnectorsGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <path d="M7.5 2.5v4M12.5 2.5v4" />
      <path d="M5 6.5h10v3a5 5 0 0 1-10 0z" />
      <path d="M10 14.5v3" />
    </>
  </Svg>
);

/** A head and shoulders. */
export const TwinGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <circle cx="10" cy="6" r="3" />
      <path d="M4 17.5c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5" />
    </>
  </Svg>
);

/** A chip with pins. */
export const ModelsGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <rect x="5" y="5" width="10" height="10" rx="1.5" />
      <path d="M8 2.5v2.5M12 2.5v2.5M8 15v2.5M12 15v2.5M2.5 8H5M2.5 12H5M15 8h2.5M15 12h2.5" />
    </>
  </Svg>
);

/** A compass needle: where to begin. */
export const StartGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <circle cx="10" cy="10" r="7.5" />
      <path d="m12.8 7.2-1.7 3.9-3.9 1.7 1.7-3.9z" />
    </>
  </Svg>
);

/** A flask: checks you can repeat. */
export const LabGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <path d="M8 2.5h4M8.5 2.5v5L4 16a1 1 0 0 0 .9 1.5h10.2A1 1 0 0 0 16 16l-4.5-8.5v-5" />
      <path d="M6 12.5h8" />
    </>
  </Svg>
);

/** A page with lines of text. */
export const DocsGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <path d="M5.5 2.5h6l3 3v12h-9z" />
      <path d="M11.5 2.5v3h3M8 9h4M8 12h4M8 15h3" />
    </>
  </Svg>
);

export const PlusGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Svg>
);

/** A window with a side column: show or pin the sidebar. */
export const SidebarGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path d="M7.5 3.5v13" />
    </>
  </Svg>
);

/** A magnifying glass: search. */
export const SearchGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <circle cx="8.75" cy="8.75" r="5.25" />
      <path d="m12.75 12.75 4 4" />
    </>
  </Svg>
);

/** A speech bubble: a thread. */
export const ThreadGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v6.5A1.5 1.5 0 0 1 16 14H9l-3.5 3v-3H4A1.5 1.5 0 0 1 2.5 12.5V6A1.5 1.5 0 0 1 4 4.5Z" />
  </Svg>
);

/** A slash in a box: a command. */
export const CommandGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
      <path d="m11.5 6.5-3 7" />
    </>
  </Svg>
);

export const CrossGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <path d="m5 5 10 10M15 5 5 15" />
  </Svg>
);

/** Two overlapping sheets: copy. */
export const CopyGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <>
      <rect x="7" y="7" width="9.5" height="9.5" rx="1.5" />
      <path d="M13 4.5V4a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 3 4v7a1.5 1.5 0 0 0 1.5 1.5H5" />
    </>
  </Svg>
);

export const DownloadGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <path d="M10 3v9.5M6 9l4 4 4-4M4 16.5h12" />
  </Svg>
);

export const TickGlyph = (props: GlyphProps) => (
  <Svg {...props}>
    <path d="m4 10.5 4 4 8-9" />
  </Svg>
);
