#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  if command -v node.exe >/dev/null 2>&1 && node.exe --version >/dev/null 2>&1; then
    NODE_BIN="node.exe"
  elif command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
    POWERSHELL_BIN="$(command -v powershell.exe)"
    if [[ -x /init ]]; then
      exec /init "$POWERSHELL_BIN" -NoProfile -ExecutionPolicy Bypass \
        -File "$(wslpath -w "$ROOT_DIR/scripts/tests.ps1")"
    fi
    exec "$POWERSHELL_BIN" -NoProfile -ExecutionPolicy Bypass \
      -File "$(wslpath -w "$ROOT_DIR/scripts/tests.ps1")"
  fi
fi

cd "$ROOT_DIR"
"$NODE_BIN" --test --experimental-strip-types "tests/node/*.test.ts"
