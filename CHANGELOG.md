# Changelog

Notable changes to TwinLLM. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The Body twin can walk: Walk and Idle in the 3D toolbar play a generic, computed walk cycle (in place) and a standing breath with sway on a BodyLoop scan's skeleton or on a rigged demo body. No motion-capture data; the lines beside the view say it is not this person's gait. Anatomy layers fade out while the body moves, and reduced motion or a body without a skeleton disables both, with the reason.
- `bun run anatomy:bake-rigged` bakes the ANNY demo bodies with their skeleton and skin weights from the pinned `anny` Python package (via uv) and installs them only when they match their SHA-256 pins; the viewer prefers them over the static bodies.
- Training conversations ask in several styles with typos, varied dates and units, add no-data families (measures no tool can read, vendor keys, periods outside the record, odd refs, similar-sounding measures) and unit families (mixed units, conversions), use the chat's twelve tools and system prompt, and write stats. `training:split` holds out whole template groups and LOINC codes for validation.
- Skill format: `skills/<name>/SKILL.md` lists the tools, sources, providers (local only by default) and views a skill may use, and `evals/` holds its cases. `bun run skills:check` and `bun test` validate every skill and run its cases against a scripted model, so a failing case fails CI. A skill cannot widen the data-mode policy. `skills/sleep` is the first. See `docs/skills.md`.
- Charts in answers: the model calls `show_view` with a measure (a LOINC code with a synthetic subject, or a wearable key such as `sleep.score`) and a window; the server reads the rows under the turn's scope, audits the read, and streams a `data-view` part drawn inline in the answer. The model never writes a point, a window with no readings says so instead of drawing, and a reloaded thread draws the same chart from its stored tool parts.
- `training:batches --skip-rejected` continues past bundles the importer rejects, lists them per batch, and still stops above a 1% rejection share.

### Changed

- Evaluation items are spread across subjects: an item that needs another subject, or shares one with more than 3 items, goes to the qualifying subject with the fewest items (ties to the lowest `subject_ref`), so no subject answers more than 3 items (16 before). `bun run eval:spread-subjects` applies the rule from the warehouse; 30 items moved and the answer key was rebuilt from the same cohort (`f4941fab…`), so results scored against the earlier key do not compare item by item.
- Models get slimmer query-tool definitions: no regex patterns or formats, window bounds as plain strings. With the Qwen3 chat template the nine tools take about 2,200 tokens instead of 12,000 in chat and 8,600 in the training data; the server still validates every call as strictly as before, and the MCP manifest is unchanged.
- Repository admins can bypass the `main` rules only through a pull request; nobody pushes to `main` directly.
- Personal data reaches Exoscale only with `EXOSCALE_PERSONAL_DATA=consented-pilot`, each such request is audited, and Infomaniak is synthetic-only.

### Removed

- The schematic four-chamber heart panel beside the live twin (#53): it looked crude and could not be closed. Live vitals still pulse the atlas heart.

### Fixed

- The evaluation cohort and its answer key can be regenerated: `synthea-v4-seed42` was generated again with fixed dates (37 bundles, checksum `f4941fab…`, the same under another time zone) and the key rebuilt from it. The key records the dates and checksum, and the tests check them. 13 items got another subject by the rule in `docs/evaluation/question-set.md`, so results scored against the old key do not compare with new ones.
- The evaluation's hallucination scorer fails an answer that reports a measure with another code's value (skin temperature from systolic blood pressure, eGFR from HbA1c) or with a value from outside the asked years, and names the code it came from. A LOINC code at a sentence end is no longer read as a stated number.

### Security

- `next` and `eslint-config-next` 16.2.12 → 16.4.1, and `zod` 4.4.3 → 4.6.6, for published security advisories; an `overrides` entry keeps every transitive zod on 4.6.6. Query-tool window bounds still accept a UTC datetime without seconds.

## [0.1.0] - 2026-10-25

First public release.

### Added

- Chat over coded health data, with up to three open models answering side by side, each
  with its reasoning, cited values and uncertainty.
- Closed, audited query tools over coded FHIR R4 observations: latest value, trend,
  baseline deviation, coverage and window comparison.
- Digital Twin: a 3D body with reference anatomy, live vitals and biomarkers by organ
  system.
- Data explorer for synthetic cohorts and the training conversations made from them.
- First-run flow for roles, data sources, knowledge sources and data residency.
- Connectors for Oura, Whoop, Google Health and BodyLoop body scans.
- Evaluation harness with 81 questions over a synthetic cohort, and tooling to build
  tool-use training data from Synthea cohorts.

[Unreleased]: https://github.com/Opening-Science/twin-llm/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Opening-Science/twin-llm/releases/tag/v0.1.0
