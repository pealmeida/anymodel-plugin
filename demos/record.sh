#!/usr/bin/env bash
set -euo pipefail

NAME="${1:-demo}"
OUTDIR="$(dirname "$0")/output"
mkdir -p "$OUTDIR"

CAST="$OUTDIR/$NAME.cast"
GIF="$OUTDIR/$NAME.gif"

echo "Recording → $CAST"
echo "Type your demo, then exit or Ctrl-D to stop."
echo "---"

asciinema rec "$CAST" --overwrite

echo "---"
echo "Converting → $GIF"
agg "$CAST" "$GIF" --font-size 14 --theme "Monokai Extended"

echo "Done: $GIF"
