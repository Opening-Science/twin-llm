#!/usr/bin/env bash
# Merge PRs one at a time, only when everything is green.
# Usage: scripts/merge-green.sh <pr> [<pr> ...]
#
# For each PR, in order, all of these must hold or the script stops:
#   1. it targets main and GitHub says it can merge cleanly;
#   2. it is up to date with main (not behind);
#   3. every check on its current head commit ran and passed
#      (CodeRabbit's "skipping" is the only allowed non-pass);
#   4. main's latest CI run finished green.
# It then squash-merges and waits for main's CI on the new commit to finish
# green before the next PR. Nothing is force-pushed or retried.
set -euo pipefail

REPO=${REPO:-Opening-Science/twin-llm}
ALLOWED_SKIP=${ALLOWED_SKIP:-CodeRabbit}
POLL=${POLL:-20}

die() { echo "STOP: $*" >&2; exit 1; }
gh_retry() { # retries flaky network calls, nothing else
  local i out
  for i in 1 2 3 4 5; do
    if out=$(gh "$@" 2>&1); then printf '%s' "$out"; return 0; fi
    grep -qiE 'timeout|EOF|connection|i/o|502|503' <<<"$out" || { printf '%s' "$out" >&2; return 1; }
    sleep $((i * 5))
  done
  printf '%s' "$out" >&2; return 1
}

main_ci_green() { # sha (optional): waits until main's CI run for sha (or the latest) is done
  local sha=${1:-} run status concl
  while :; do
    if [[ -n $sha ]]; then
      run=$(gh_retry run list -R "$REPO" --branch main --workflow CI --limit 20 \
        --json headSha,status,conclusion -q "[.[] | select(.headSha==\"$sha\")][0] | \"\(.status) \(.conclusion)\"")
    else
      run=$(gh_retry run list -R "$REPO" --branch main --workflow CI --limit 1 \
        --json status,conclusion -q '.[0] | "\(.status) \(.conclusion)"')
    fi
    read -r status concl <<<"$run"
    if [[ -z $status || $status == null ]]; then echo "  waiting for main's CI run to start…"; sleep "$POLL"; continue; fi
    if [[ $status != completed ]]; then echo "  main CI: $status…"; sleep "$POLL"; continue; fi
    [[ $concl == success ]] || die "main's CI finished '$concl'${sha:+ for ${sha:0:7}}; fix main before merging anything else."
    return 0
  done
}

[[ $# -ge 1 ]] || die "usage: $0 <pr> [<pr> ...]"
echo "Checking main first…"
main_ci_green

for pr in "$@"; do
  echo "== #$pr"
  read -r base mergeable state head <<<"$(gh_retry pr view "$pr" -R "$REPO" \
    --json baseRefName,mergeable,mergeStateStatus,headRefOid -q '"\(.baseRefName) \(.mergeable) \(.mergeStateStatus) \(.headRefOid)"')"
  [[ $base == main ]] || die "#$pr targets '$base', not main."
  [[ $mergeable == MERGEABLE ]] || die "#$pr is $mergeable ($state); update the branch first."
  behind=$(gh_retry api "repos/$REPO/compare/main...$head" -q .behind_by)
  [[ $behind == 0 ]] || die "#$pr is $behind commit(s) behind main; merge main into it and let its checks rerun."

  checks=$(gh_retry pr checks "$pr" -R "$REPO" --json name,bucket -q '.[] | "\(.bucket) \(.name)"' || true)
  [[ -n $checks ]] || die "#$pr has no checks on ${head:0:7}; CI did not run."
  bad=$(awk -v skip="$ALLOWED_SKIP" '$1!="pass" && !($1=="skipping" && $2==skip)' <<<"$checks")
  [[ -z $bad ]] || die "#$pr is not all green on ${head:0:7}:"$'\n'"$bad"
  n=$(grep -c '^pass ' <<<"$checks")
  echo "  $n checks passed on ${head:0:7}, up to date with main"

  gh_retry pr merge "$pr" -R "$REPO" --squash --admin --delete-branch >/dev/null
  sha=$(gh_retry pr view "$pr" -R "$REPO" --json mergeCommit -q .mergeCommit.oid)
  echo "  merged as ${sha:0:7}; waiting for main's CI…"
  main_ci_green "$sha"
  echo "  main green on ${sha:0:7}"
done
echo "All merged, main green."
