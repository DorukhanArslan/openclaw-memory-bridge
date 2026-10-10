#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ $# -gt 1 || ($# -eq 1 && "$1" != "--client-only") ]]; then
  echo "Usage: bash scripts/install.sh [--client-only]" >&2
  exit 2
fi
mkdir -p .bootstrap
touch .bootstrap/user.npmrc .bootstrap/global.npmrc
# Never change the system Node or load the user's npm credential files.
npm install node@24.16.0 --prefix .bootstrap --no-audit --no-fund \
  --registry https://registry.npmjs.org/ --cache .npm-cache \
  --userconfig "$PWD/.bootstrap/user.npmrc" --globalconfig "$PWD/.bootstrap/global.npmrc"
if [[ "${1:-}" == "--client-only" ]]; then
  .bootstrap/node_modules/node/bin/node --version
  exit 0
fi
PATH="$PWD/.bootstrap/node_modules/node/bin:$PATH" npm ci \
  --registry https://registry.npmjs.org/ --cache .npm-cache \
  --userconfig "$PWD/.bootstrap/user.npmrc" --globalconfig "$PWD/.bootstrap/global.npmrc"
node_modules/node/bin/node --version
node_modules/node/bin/node node_modules/openclaw/openclaw.mjs --version
