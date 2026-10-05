#!/usr/bin/env bash
# Copy the WordLight TV sources into the generated Vega project and vendor the shared packages.
# No npm install, no config rewrite: run this after changing apps/vega-tv/overlay or packages/*, then rebuild.
#   bash apps/vega-tv/sync.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../.." && pwd)"; APP="$HERE/WordLightTV"
[ -d "$APP/src" ] || { echo "Run apps/vega-tv/setup.sh first (generates $APP)"; exit 1; }
cd "$APP"
for f in "$HERE"/overlay/src/*.ts "$HERE"/overlay/src/*.tsx; do
  case "$(basename "$f")" in fonts.ts|fonts.fallback.ts) continue;; esac   # setup.sh chooses the fonts module
  cp "$f" src/
done
vendor_ts() { # $1 package dir name
  rm -rf "src/vendor/$1" && mkdir -p "src/vendor/$1"
  for f in "$ROOT/packages/$1/src/"*.ts; do sed -E "s#(from '\./[a-z-]+)\.ts'#\1'#g" "$f" > "src/vendor/$1/$(basename "$f")"; done
}
# karaoke-core in the app = the open-source package oss/karaoke-vega (core + <KaraokeLine>)
rm -rf src/vendor/karaoke-core && mkdir -p src/vendor/karaoke-core
for f in "$ROOT"/oss/karaoke-vega/src/*.ts "$ROOT"/oss/karaoke-vega/src/*.tsx; do sed -E "s#(from '\./[A-Za-z-]+)\.tsx?'#\1'#g" "$f" > "src/vendor/karaoke-core/$(basename "$f")"; done
vendor_ts tv-core
rm -rf src/vendor/session-client && mkdir -p src/vendor/session-client && for f in "$ROOT"/packages/session-client/src/*.js; do sed '/@ts-check/d' "$f" > "src/vendor/session-client/$(basename "$f")"; done  # JS; not type-checked in the app
echo "synced overlay + vendor (karaoke-vega as karaoke-core, tv-core, session-client) into $APP/src"
