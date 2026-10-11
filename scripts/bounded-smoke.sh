#!/usr/bin/env bash
set -uo pipefail
set +x
cd "$(dirname "$0")/.."
if [[ $# -ne 0 ]]; then
  echo 'Usage: bash scripts/bounded-smoke.sh' >&2
  exit 2
fi
echo 'One native chat completion plus one synthetic note/index/semantic query/source read.'
echo 'Provider key cap: 50 USD. Test budget: 5 USD. Conservative estimate: 0.02232704 USD.'
trap 'unset OPENROUTER_API_KEY' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
unset OPENROUTER_API_KEY
IFS= read -r -s -p 'OpenRouter test key (hidden): ' OPENROUTER_API_KEY
printf '\n'
[[ -n "$OPENROUTER_API_KEY" ]] || exit 2
export OPENROUTER_API_KEY
node_modules/node/bin/node examples/bounded_smoke.ts
smoke_result=$?
unset OPENROUTER_API_KEY
exit "$smoke_result"
