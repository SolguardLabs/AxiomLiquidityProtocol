#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"

if command -v node.exe >/dev/null 2>&1 && node.exe --version >/dev/null 2>&1; then
  NODE_BIN="node.exe"
elif ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node.js 24 or newer is required." >&2
  exit 1
fi

cd "$ROOT_DIR"
"$NODE_BIN" --test --experimental-strip-types "tests/node/*.test.ts"
