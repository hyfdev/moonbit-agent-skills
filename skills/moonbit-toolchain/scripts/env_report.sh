#!/bin/sh
# Report the local MoonBit environment before giving toolchain advice:
# component versions, install location, and which backends can actually
# run here (native needs a C compiler; js/wasm need moonrun, which ships
# with the toolchain).
#
# Usage: scripts/env_report.sh
set -eu

echo "--- moon version --all ---"
moon version --all

echo "--- install ---"
command -v moon
command -v moonrun || echo "moonrun: NOT FOUND"

echo "--- native backend prerequisites ---"
if command -v cc >/dev/null 2>&1; then
  printf 'cc: '
  cc --version 2>/dev/null | head -1
else
  echo "cc: NOT FOUND (moon --target native will not link)"
fi

echo "--- os/arch ---"
uname -sm
