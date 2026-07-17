#!/bin/sh
# Verify a MoonBit snippet against the LOCAL toolchain without needing a
# project. Reads MoonBit source on stdin (or a file argument), wraps it in
# a scratch standalone document, and runs moon check + moon test on it.
#
# Usage:
#   scripts/verify_snippet.sh < snippet.mbt
#   scripts/verify_snippet.sh snippet.mbt
#
# The snippet may contain top-level declarations and `test { }` blocks.
# Exit code is moon's: 0 = the snippet compiles (and its tests pass).
set -eu

workdir=$(mktemp -d "${TMPDIR:-/tmp}/mbt-snippet.XXXXXX")
trap 'rm -rf "$workdir"' EXIT

doc="$workdir/snippet.mbt.md"
{
  printf '# snippet verification\n\n```mbt check\n'
  if [ "$#" -ge 1 ]; then cat "$1"; else cat; fi
  printf '\n```\n'
} > "$doc"

moon version --all --no-path
echo "--- moon check ---"
moon check "$doc"
echo "--- moon test ---"
moon test "$doc"
