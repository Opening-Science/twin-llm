# Brand

TwinLLM uses the Open Science Foundation brand: its colours, its two
typefaces and, in the sidebar, its logo as attribution. The source is the
foundation's brand guide, `Opening-Science/Open-Science-Foundation-brand-guide`
(tokens in `tokens/tokens.css`, rules in `docs/brand-guide.md`). Decided with
Peter on 23 Oct 2026.

Write "Open Science Foundation" in full. Never "OSF": search engines read it as
the Open Science Framework.

## Colour

All tokens live in `app/globals.css` as OKLCH, with the brand hex beside each
one. `infrastructure/ui-kit/brand-tokens.test.ts` checks that each brand token
renders as its hex and that every pairing below clears WCAG AA (4.5:1 for text,
3:1 for control edges and chart marks). `chart-tokens.test.ts` checks the
chart series.

Light follows the guide's "Open editorial" option, and dark follows "Evening stage".

| Token                    | Light                                             | Dark                                              | Job                           |
| ------------------------ | ------------------------------------------------- | ------------------------------------------------- | ----------------------------- |
| background               | `#f8f8f4` cream-light                             | `#1d1d1d` black                                   | page                          |
| card                     | `#ffffff` white                                   | `#242424`                                         | framed blocks                 |
| popover                  | `#ffffff`                                         | `#2b2b2b`                                         | menus                         |
| foreground               | `#1d1d1d` black                                   | `#f8f8f4` cream-light                             | body text                     |
| muted-foreground         | `#646363` gray                                    | `#c0beb2` cream-dark                              | quiet text                    |
| muted, accent, secondary | `#efeee7` cream                                   | `#323232` button                                  | hover and chip fills          |
| border                   | `#d9d8cf`                                         | `#404040`                                         | dividers                      |
| input                    | `#6f6e66` cream-darker                            | `#828178`                                         | control edges                 |
| primary                  | `#323232` button                                  | `#73adff` blue                                    | the one interactive accent    |
| primary-foreground       | `#ffffff`                                         | `#1d1d1d`                                         | label on primary              |
| ring                     | `#1c4e8f` blue-ink                                | `#73adff` blue                                    | focus outline                 |
| winner                   | `#197037`                                         | `#5cb572`                                         | TwinLLM's own, marks success  |
| destructive              | `#b7162d`                                         | `#f8767a`                                         | TwinLLM's own, marks an error |
| chart-1 to chart-5       | `#1e7777` `#926e10` `#974391` `#6a51a4` `#6f6e66` | `#50bfbe` `#dbb155` `#d285cb` `#aa95e8` `#c0beb2` | data series only              |

Measured contrast, light and dark:

| Pair                           |      Light |       Dark |
| ------------------------------ | ---------: | ---------: |
| foreground on background       |       15.8 |       15.8 |
| foreground on card             |       16.9 |       14.6 |
| muted-foreground on background |        5.6 |        9.0 |
| muted-foreground on card       |        6.0 |        8.3 |
| muted-foreground on muted      |        5.1 |        6.9 |
| primary-foreground on primary  |       12.8 |        7.3 |
| primary on background          |       12.0 |        7.3 |
| ring on background             |        7.8 |        7.3 |
| input on card                  |        5.1 |        3.9 |
| winner on card                 |        6.2 |        6.1 |
| destructive on card            |        6.6 |        5.8 |
| chart-1 to chart-5 on card     | 4.7 to 6.3 | 5.9 to 8.3 |

Rules carried over from the guide:

- The brand blue `#73adff` is 2.3:1 on white, so in light mode it is never text
  or the accent. Use blue-ink `#1c4e8f` for readable blue.
- No gradients, shadows or new accent colours. Yellow and the OpenTwin red are
  not used.
- The guide has no status colours, so `winner` and `destructive` stay TwinLLM's
  own. Colour is never the only signal: a status always carries a word.
- Chart hues keep away from the brand blue, the winner green and the error red,
  so a data line never reads as a link, a verdict or an error.

The border tone and the dark card and popover steps are not guide colours. The
guide has no dark theme and no divider tone between cream and cream-dark, so
these are neutral steps on the same hues.

## Type

| Role                                          | Face                                              | Where                                               |
| --------------------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| Titles and body (`font-sans`, `font-display`) | Selecta Regular; Medium or Bold only for emphasis | everything by default, `.text-display`              |
| Labels, metadata, numbers (`font-mono`)       | ABC Diatype Semi Mono Regular and Bold            | `.text-eyebrow`, `.metric`, `.text-readout`, tables |

Sizes are unchanged from before the rebrand. Every `font-mono` figure keeps
`tabular-nums`.

Diatype has no Medium, so mono text never uses `font-medium`. The rule:
`.metric-value` and the wearables headline numbers are
`font-bold`; `.text-readout` and chart labels are `font-normal`.

## Fonts: where they come from

Selecta (Maxitype) and ABC Diatype Semi Mono (Dinamo Typefaces) are commercial
fonts licensed to the foundation. Peter and Martin hold the licences. Rules:

- The files never go into git. `public/fonts/*` is ignored except its README.
- Only the WOFF2 web files are served. The OTF and TTF desktop files are never
  served or converted.
- They are self-hosted from `public/fonts/` and declared with `@font-face` and
  `font-display: swap` in `globals.css`. `next/font/local` is not used because
  it fails the build when the files are missing.
- Without the files the app falls back to `ui-sans-serif, system-ui` and
  `ui-monospace`. CI (typecheck, lint, tests) runs without them, and
  `bun run build` was checked without them on 23 Oct 2026. CI does not run
  `next build`.

Install them:

```sh
bun run fonts:install                 # from BRAND_FONTS_DIR or ~/Developer/osf-brand/fonts
bun run fonts:install /path/to/fonts  # from another folder
bun run fonts:install --check         # report only
```

The script checks each file against a SHA-256 pinned in
`scripts/fonts/install.ts` and refuses anything else. A test checks that the
pinned list matches the files `globals.css` asks for. Run it once in every
worktree you take screenshots from.

## Logo

The logo uses the guide's unmodified files: the positive
lockup on light, the negative on dark. It sits in the sidebar as "by Open
Science Foundation" attribution, and "TwinLLM" stays the product name. Do not
recolour, crop, redraw or re-typeset it. Keep one mark-width of clear space.
The artwork is under the foundation's Brand Assets Permission, not Apache-2.0. The
favicon stays TwinLLM's own.
