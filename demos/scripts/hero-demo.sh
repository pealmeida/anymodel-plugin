#!/usr/bin/env bash
# Hero demo script — recorded with asciinema, converted to GIF with agg.
# Runs real anymodel-plugin commands (no API keys needed for setup/models/help/status).

set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
COMPANION="$REPO/plugins/anymodel/scripts/companion.mjs"
MCP="$REPO/plugins/anymodel/scripts/mcp-server.mjs"

# Simulate a clean prompt
PS1='$ '
export PS1

type_line() {
  local text="$1"
  local delay="${2:-0.03}"
  printf '%s' "$text"
  sleep "$delay"
}

run_cmd() {
  local cmd="$1"
  local label="$2"
  echo ""
  echo -n "$PS1"
  type_line "$cmd" 0.02
  echo ""
  sleep 0.3
  eval "$cmd" 2>&1 || true
  sleep 0.8
}

clear
echo "# Any Model Plugin — vendor-agnostic AI orchestration"
echo "# https://github.com/pealmeida/anymodel-plugin"
echo ""

# 1. Setup
run_cmd "node $COMPANION setup" ""

# 2. Models
run_cmd "node $COMPANION models" ""

# 3. Delegate help
run_cmd "node $COMPANION delegate --help" ""

# 4. Adversarial review help
run_cmd "node $COMPANION adversarial-review --help" ""

# 5. Status
run_cmd "node $COMPANION status" ""

# 6. Setup --json (machine-readable)
run_cmd "node $COMPANION setup --json" ""

echo ""
echo "# 11 slash commands · 8 MCP tools · 3 engines · 3 providers"
echo "# Zero dependencies. Clone and go."
sleep 1
