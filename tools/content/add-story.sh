#!/usr/bin/env bash
# Add one StoryWeaver story (English) next to the existing ones — nothing else is rebuilt or deployed.
#   cd ~/Projects/wordlight && bash tools/content/add-story.sh <download.zip> <id> <storyweaver-url> [--max-pages N]
#   e.g. bash tools/content/add-story.sh ~/Downloads/1067-naughty-dog.zip naughty-dog https://storyweaver.org.in/en/stories/1067-naughty-dog
# 1. import the ZIP (PDF + StoryWeaver's attribution file; CC BY 4.0 / CC BY-SA 4.0 only) → content/sources/<id>/
# 2. build it like Busy Ants: expressive Polly voice timed by Transcribe, help-word clips, reading turns (≈ USD 0.05)
# 3. validate ALL stories (the server shelf only lists stories that pass), print the new story's pages and turns
# Deploy separately after review: bash infra/aws/deploy.sh. Log: .dev/aws/add-story-<id>-<stamp>.log
set -uo pipefail
cd "$(dirname "$0")/../.."
[ $# -ge 3 ] || { sed -n 2,4p "$0"; exit 2; }
ZIP="$1"; ID="$2"; URL="$3"; shift 3
case "$ID" in busy-ants|busy-ants-hi|wl-test-kite|s1-timing) echo "refusing to overwrite the existing story '$ID'"; exit 2;; esac
export AWS_REGION="${AWS_REGION:-ap-south-1}" AWS_PAGER="" USAGE_FILE="$PWD/.dev/usage.json"
mkdir -p .dev/aws; LOG=".dev/aws/add-story-$ID-$(date -u +%Y%m%dT%H%M%SZ).log"
exec > >(tee -a "$LOG") 2>&1
fail() { echo; echo "ADD-STORY STOPPED: $*"; echo "log: $LOG — tell Claude \"story stopped\""; exit 1; }
[ -f "$ZIP" ] || fail "no file $ZIP"
aws sts get-caller-identity --query Account --output text >/dev/null || fail "no AWS credentials in this terminal (aws login)"
if [ -f "content/sources/$ID/source.json" ] && [ "${REIMPORT:-0}" != 1 ]; then
  echo "== 1. import: already imported (content/sources/$ID/source.json) — REIMPORT=1 to import again"
else
  echo "== 1. import"
  command -v pdfinfo >/dev/null || fail "the PDF tools are missing: brew install poppler (or let Claude import it)"
  python3 tools/content/import-storyweaver-pdf.py "$ZIP" "$ID" --lang en-IN --level 1 --url "$URL" "$@" || fail "import failed"
fi
echo "== 2. build (expressive English voice, as Busy Ants)"
node tools/content/build-story.ts "$ID" --narration generative || fail "build failed"
echo "== 3. validate all stories"
node tools/content/validate-story.ts || fail "validation failed (the shelf would hide the failing story)"
node -e '
const s=require("./content/stories/'"$ID"'/story.json");
console.log(`\n${s.title} · ${s.pages.length} pages · ${s.credits.license}\n${s.credits.attribution}\n`);
s.pages.forEach((p,i)=>p.lines.forEach(l=>console.log(`p${i+1}${l.turn?" TURN":"     "} ${l.text}`)));'
echo; echo "Built, not deployed. Log: $LOG — tell Claude \"story built\""
