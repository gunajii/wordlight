#!/usr/bin/env bash
# Publish oss/karaoke-vega as its own public repository (history preserved via git subtree split).
#   1. create an EMPTY public repo github.com/gunajii/karaoke-vega (no README/licence)
#   2. bash tools/oss/publish.sh            (uses your normal git credentials for github.com)
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="${REPO:-https://github.com/gunajii/karaoke-vega.git}"
(cd oss/karaoke-vega && node --test test/*.test.ts) || { echo "package tests fail — not publishing"; exit 1; }
git branch -D karaoke-vega-split 2>/dev/null || true
git subtree split --prefix oss/karaoke-vega -b karaoke-vega-split
git push "$REPO" karaoke-vega-split:main
echo "pushed → ${REPO%.git}"
