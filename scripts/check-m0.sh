#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -P -- "$(dirname -- "$0")" && pwd)"
node "$script_dir/validate_contracts.mjs"
npm test --prefix "$(dirname "$script_dir")"
shellcheck "$script_dir/check-m0.sh"
npm run check:key-isolation --prefix "$(dirname "$script_dir")"
echo "PASS M0: contracts, semantic rejection tests, mock environment, and shell lint"
