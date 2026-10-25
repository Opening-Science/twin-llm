#!/usr/bin/env bash
# Import verification for Opening-Science/twin-llm.
# Six gates + gitleaks. Does NOT run prisma migrate (issue #1b).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Import-safe defaults (no cloud keys). Override with env if needed.
export LOCAL_MVP="${LOCAL_MVP:-true}"
export AUTH_DISABLED="${AUTH_DISABLED:-true}"
export NEXT_PUBLIC_LOCAL_MVP="${NEXT_PUBLIC_LOCAL_MVP:-true}"
export NEXT_PUBLIC_AUTH_DISABLED="${NEXT_PUBLIC_AUTH_DISABLED:-true}"
export DATABASE_URL="${DATABASE_URL:-postgresql://user:pass@localhost:5432/twin_llm}"
export LLM_PROVIDER="${LLM_PROVIDER:-ollama}"
export DATA_MODE="${DATA_MODE:-synthetic}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

RESULTS=()
FAIL=0

record() {
  local name="$1" status="$2"
  RESULTS+=("$name|$status")
  if [[ "$status" != "PASS" ]]; then
    FAIL=1
  fi
}

run_step() {
  local name="$1"
  shift
  echo ""
  echo "=== $name ==="
  if "$@"; then
    record "$name" "PASS"
    echo "OK: $name"
  else
    record "$name" "FAIL"
    echo "FAIL: $name" >&2
    print_summary
    exit 1
  fi
}

print_summary() {
  echo ""
  echo "┌──────────────────────────┬────────┐"
  echo "│ Step                     │ Status │"
  echo "├──────────────────────────┼────────┤"
  for row in "${RESULTS[@]}"; do
    local name="${row%%|*}"
    local status="${row##*|}"
    printf "│ %-24s │ %-6s │\n" "$name" "$status"
  done
  echo "└──────────────────────────┴────────┘"
  if [[ "$FAIL" -eq 0 ]]; then
    echo "verify-import: all steps passed (migrate deferred to #1b)"
  else
    echo "verify-import: failed" >&2
  fi
}

command -v bun >/dev/null 2>&1 || {
  echo "verify-import FAIL: bun not found (need >=1.4.2)" >&2
  exit 1
}

BUN_V="$(bun --version | tr -d '[:space:]')"
# Require 1.4.2 or newer (engines.bun >=1.4.2)
BUN_OK="$(node -e "const [a,b,c]='$BUN_V'.split('.').map(Number); process.exit(a>1||(a===1&&b>4)||(a===1&&b===4&&c>=2)?0:1)" && echo yes || echo no)"
[[ "$BUN_OK" == "yes" ]] || {
  echo "verify-import FAIL: bun $BUN_V (need >=1.4.2)" >&2
  exit 1
}

run_step "bun install" bun install --frozen-lockfile
run_step "prisma generate" bunx prisma generate
run_step "typecheck" bun run typecheck
run_step "lint" bun run lint
run_step "test" bun run test
run_step "build" bun run build

if command -v gitleaks >/dev/null 2>&1; then
  # Git-aware scan with repo .gitleaks.toml (allowlists .next/node_modules/…).
  run_step "gitleaks" gitleaks detect --source . --config .gitleaks.toml --verbose --redact
else
  echo ""
  echo "=== gitleaks ==="
  echo "SKIP: gitleaks not installed"
  record "gitleaks" "SKIP"
fi

print_summary
exit "$FAIL"
