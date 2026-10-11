#!/usr/bin/env bash
set -uo pipefail
set +x
cd "$(dirname "$0")/.."
if [[ $# -ne 0 ]]; then
  echo 'Usage: bash scripts/bounded-smoke.sh' >&2
  exit 2
fi
echo 'Current native real smoke is blocked: isolated completion drops price routing.'
echo 'This command can inspect native quota only; it will make zero inference requests.'
echo 'Provider key cap: 50 USD. Separate test budget: 5 USD.'
trap 'unset OPENROUTER_API_KEY' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
IFS= read -r -s -p 'OpenRouter test key (hidden): ' OPENROUTER_API_KEY
printf '\n'
[[ -n "$OPENROUTER_API_KEY" ]] || exit 2
export OPENROUTER_API_KEY
node_modules/node/bin/node examples/budget_preflight.ts --key-limit-confirmed --provider-limit=50
smoke_result=$?
unset OPENROUTER_API_KEY
exit "$smoke_result"
