# Repository settings

Target GitHub settings for the public release of `Opening-Science/twin-llm`. Merging
this file changes nothing: a repository admin applies each item once and ticks it off
here in a follow-up PR. Items marked **done** already match.

Commands use the GitHub CLI as a repository admin. Run them from the repository root.

```sh
R=Opening-Science/twin-llm
```

## Order

1. Merge the hardening PR first, so `.github/CODEOWNERS` exists before the ruleset
   requires code-owner review.
2. Make sure every CODEOWNERS path has **at least two owners**. GitHub never lets a pull
   request's author approve it, so a path owned by one person blocks that person's own
   PRs. Today `*` is owned by `@CPD9` alone and nearly every PR is his.
3. Apply the rulesets, check that a test PR merges, then delete the classic branch
   protection.
4. Apply the rest in any order. Items under "Before going public" come last.

## Rulesets

The JSON files in `.github/rulesets/` use GitHub's import format: Settings → Rules →
Rulesets → New ruleset → Import a ruleset, or the API.

### `main` — `.github/rulesets/main.json`

Builds on open-twin's "Protect main" ruleset (one approval, signed commits, no deletion,
no force push, no bypass) and adds:

- [ ] Squash merge only; linear history.
- [ ] Code-owner approval; stale approvals dismissed on push; the last push approved by
      someone other than its author.
- [ ] Review threads resolved before merge.
- [ ] Required checks, up to date with `main`: `typecheck`, `lint`, `lint-claims`, `test`,
      `test-isolation`, `prisma`, `gitleaks`, `ark-app`. The classic protection lacks
      `test-isolation` and `ark-app`.
- [ ] Signed commits on `main`. Squash merges made on GitHub are signed by GitHub; 24 of
      the last 30 commits on `main` already verify.
- [ ] No bypass actors: admins follow the same rules (the classic protection already
      enforces this for admins).

```sh
gh api -X POST "repos/$R/rulesets" --input .github/rulesets/main.json
```

### Release tags — `.github/rulesets/tags.json`

- [ ] `v*` tags cannot be deleted, moved or force-updated. Creating them stays allowed.

```sh
gh api -X POST "repos/$R/rulesets" --input .github/rulesets/tags.json
```

### Retire the classic branch protection

- [ ] After a test PR merges under the new ruleset:

```sh
gh api -X DELETE "repos/$R/branches/main/protection"
```

Check: `gh api "repos/$R/rulesets" --jq '.[].name'` lists both rulesets.

## Repository

- [ ] Squash merging only; delete head branches after merge; sign-off required on commits
      made in the web editor; wiki and projects off (unused).

```sh
gh api -X PATCH "repos/$R" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F web_commit_signoff_required=true \
  -F has_wiki=false -F has_projects=false
```

## Code security

- [ ] Private vulnerability reporting (`SECURITY.md` points to it).

```sh
gh api -X PUT "repos/$R/private-vulnerability-reporting"
```

- [ ] Dependabot alerts and security updates.

```sh
gh api -X PUT "repos/$R/vulnerability-alerts"
gh api -X PUT "repos/$R/automated-security-fixes"
```

- [ ] Secret scanning and push protection. Free on public repositories; on a private
      repository it needs GitHub Secret Protection.

```sh
gh api -X PATCH "repos/$R" --input - <<'EOF'
{"security_and_analysis": {
  "secret_scanning": {"status": "enabled"},
  "secret_scanning_push_protection": {"status": "enabled"}
}}
EOF
```

- [ ] CodeQL default setup. Free on public repositories; on a private repository it
      needs GitHub Code Security.

```sh
gh api -X PATCH "repos/$R/code-scanning/default-setup" -f state=configured
```

Check: `gh api "repos/$R" --jq .security_and_analysis`.

## Actions

- [ ] Only GitHub-made actions plus the two third-party actions CI uses, pinned to full
      commit SHAs (CI pins them; Dependabot keeps the pins current).

```sh
gh api -X PUT "repos/$R/actions/permissions" \
  -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
gh api -X PUT "repos/$R/actions/permissions/selected-actions" --input - <<'EOF'
{"github_owned_allowed": true, "verified_allowed": false,
 "patterns_allowed": ["oven-sh/setup-bun@*", "dtolnay/rust-toolchain@*"]}
EOF
```

- [x] **done** Default workflow token read-only; Actions cannot approve pull requests.

```sh
gh api "repos/$R/actions/permissions/workflow"
```

- [ ] After going public: workflows from forks wait for approval for every outside
      contributor. GitHub refuses this setting while the repository is private.

```sh
gh api -X PUT "repos/$R/actions/permissions/fork-pr-contributor-approval" \
  -f approval_policy=all_external_contributors
```

## Access

- [ ] Two admins at most. Today there are four: `etzm`, `CPD9`, `PaulMatthiasVUSE`,
      `robin-opening-science`. Give the others `maintain` or `write`:

```sh
gh api -X PUT "repos/$R/collaborators/<login>" -f permission=maintain
```

- [ ] Remove read-only collaborators who no longer need access once the repository is
      public (anyone can read it then). Check whether `pdettinger47-collab` and
      `Dettinger-OSF` are the same person.
- [ ] Organization: require two-factor authentication for all members (organization
      owner, Settings → Authentication security).

Check: `gh api "repos/$R/collaborators?affiliation=all" --jq '.[] | "\(.login) \(.role_name)"'`.

## Before going public

- [ ] Scan the full history of every branch for secrets and real personal data. Push
      protection only covers new pushes.

```sh
gitleaks detect --source . --config .gitleaks.toml --log-opts="--all" --redact
```

- [ ] Review open and closed issues and PRs for internal links, hostnames or personal
      details; they become public with the repository.
- [ ] Then switch visibility (Settings → General → Danger Zone) and apply the
      fork-workflow approval above.
