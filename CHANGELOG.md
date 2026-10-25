# Changelog

Notable changes to TwinLLM. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- Repository admins can bypass the `main` rules only through a pull request; nobody pushes to `main` directly.
- Personal data reaches Exoscale only with `EXOSCALE_PERSONAL_DATA=consented-pilot`, each such request is audited, and Infomaniak is synthetic-only.

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
