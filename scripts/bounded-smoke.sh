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
# The same project-root loader serves direct, npm and test entry points.
# Existing environment values win. Missing keys fail before native execution.
exec node_modules/node/bin/node examples/bounded_smoke.ts
