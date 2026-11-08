#!/bin/sh
set -eu
script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
cd "$script_dir/.."
exec node "$script_dir/agent-matrix.mjs" "$@"
