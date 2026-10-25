# Security Policy

## Supported versions

TwinLLM has no versioned releases. Security fixes are made on the current `main` branch
only. Deployments built from older commits are not supported; update to `main`.

## Reporting a vulnerability

Do not report suspected vulnerabilities in public issues, pull requests, discussions or
social media. Report them privately through GitHub:
[**Report a vulnerability**](https://github.com/Opening-Science/twin-llm/security/advisories/new)
(Security tab → Advisories).

Include a clear description of the issue, the affected commit or path, the impact and
steps to reproduce it. Use a minimal, sanitized reproduction.

Do not include health data, wearable records, scan or genome data, patient or participant
identifiers, OAuth tokens, API keys, passwords, cookies, raw vendor API responses or
other sensitive data in a report. Describe the data shape or use the synthetic cohort
(`DATA_MODE=synthetic`) instead.

## Scope

In scope: code in this repository, including the OAuth proxies, token storage, the
`DATA_MODE` and `LOCAL_ONLY` guards that decide where personal data may go, and the CI
workflows.

Out of scope: third-party services (wearable vendors, LLM providers, Clerk, PostHog,
Arcjet), the pinned open-twin packages (report those to
[open-twin](https://github.com/Opening-Science/open-twin/security)) and deployments run
by others.

## What to expect

The maintainers will acknowledge reports within five business days and provide a status
update after initial triage. Valid reports are assessed, remediated and disclosed in
coordination with the reporter when practical. Remediation timing depends on severity,
affected users and the availability of a safe fix.

Please keep the report confidential until a fix or coordinated disclosure is agreed. The
project may publish a GitHub security advisory once users can protect themselves.
