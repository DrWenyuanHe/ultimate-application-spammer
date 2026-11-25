#!/bin/sh
# Double-click (macOS) or run (Linux) to open your job dashboard.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js is not installed yet. Open this folder in Codex or Claude and say "set me up".'
  exit 1
fi
node app/cli.mjs start
