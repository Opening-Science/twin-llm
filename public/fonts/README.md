# Fonts supplied separately

Selecta (Maxitype) and ABC Diatype Semi Mono (Dinamo Typefaces) are licensed
to the Open Science Foundation. They are not in git and must never be
force-added. This folder ignores everything except this file.

Install them with `bun run fonts:install`. It reads the folder in
`BRAND_FONTS_DIR`, or `~/Developer/osf-brand/fonts`, or a folder you pass as
the first argument, checks each file against its pinned SHA-256 and copies it
here. Without them the app uses system fonts. See `docs/brand.md`.
