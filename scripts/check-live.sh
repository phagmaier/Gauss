#!/usr/bin/env bash
set -eu

if (( $# == 0 )); then
  set -- pnpm dev
fi
scratch=$(mktemp -d)
exec env -u ANTHROPIC_API_KEY GAUSS_LIVE_CHECK=1 GAUSS_DATA_ROOT="$scratch" "$@"
