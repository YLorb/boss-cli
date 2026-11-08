#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
cd "$script_dir/.."
node node_modules/typescript/bin/tsc
exec node scripts/run-offline-regression.mjs "$@"
