#!/usr/bin/env bash
# 2140.wtf pre-merge verification checklist (AGENTS.md section 8).
# Usage: bash e2e/verify-merge.sh
# Runs the exact gates AGENTS.md requires, in order, and prints a PASS/FAIL
# summary. Fails fast on the first gate that fails.
set -uo pipefail
cd "$(dirname "$0")/.."

overall=0
declare -a names=() statuses=()

run_gate() {
  local name="$1"; shift
  names+=("$name")
  echo ""
  echo "=== GATE: $name ==="
  if "$@"; then
    statuses+=("PASS")
    echo "--- PASS: $name"
  else
    statuses+=("FAIL")
    echo "--- FAIL: $name"
    overall=1
  fi
}

run_gate "git clean tree" bash -c '[ -z "$(git status --porcelain -uall)" ]'
run_gate "tsc" npx tsc --noEmit --incremental false
run_gate "eslint" npx eslint .
run_gate "vitest" npx vitest run --reporter=dot --silent
run_gate "build" npm run build

echo ""
echo "===================="
for i in "${!names[@]}"; do
  printf '%-18s %s\n' "${names[$i]}" "${statuses[$i]}"
done
exit $overall
