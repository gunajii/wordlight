#!/usr/bin/env bash
# Turn a narrator's takes (from record.html) into the files the build uses:
#   content/sources/<id>/narration/p<N>.wav  16 kHz mono PCM16 (Transcribe alignment, help clips)
#   content/sources/<id>/narration/p<N>.mp3  the same audio for the TV
# Silence at both ends is trimmed and loudness is normalised (-18 LUFS). Needs ffmpeg (brew install ffmpeg).
#   bash tools/content/prepare-recordings.sh <id> <folder with the takes, e.g. ~/Downloads> "<narrator name>"
# For each page the NEWEST take named <id>-p<N>.(webm|m4a|wav|mp3) — including "… (1).webm" copies — is used.
set -euo pipefail
cd "$(dirname "$0")/../.."
ID="${1:?id}"; IN="${2:?folder with takes}"; WHO="${3:?narrator name}"
command -v ffmpeg >/dev/null || { echo "ffmpeg is missing: brew install ffmpeg (or ask Claude to prepare the recordings)"; exit 1; }
SRC="content/sources/$ID"; OUT="$SRC/narration"; mkdir -p "$OUT"
N=$(python3 -c "import json;print(len(json.load(open('$SRC/source.json'))['pages']))")
TRIM="silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.25,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.45,areverse,loudnorm=I=-18:TP=-2:LRA=11"
for p in $(seq 1 "$N"); do
  TAKE=$(ls -t "$IN"/"$ID"-p"$p".* "$IN"/"$ID"-p"$p"\ \(*\).* 2>/dev/null | grep -E '\.(webm|m4a|wav|mp3)$' | head -1 || true)
  [ -n "$TAKE" ] || { echo "page $p: no take named $ID-p$p.* in $IN"; exit 1; }
  ffmpeg -v error -y -i "$TAKE" -af "$TRIM" -ac 1 -ar 16000 -c:a pcm_s16le "$OUT/p$p.wav"
  ffmpeg -v error -y -i "$OUT/p$p.wav" -ar 24000 -ac 1 -b:a 64k "$OUT/p$p.mp3"
  printf 'page %2d  %-40s → %.1f s\n' "$p" "$(basename "$TAKE")" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/p$p.wav")"
done
python3 - "$SRC/source.json" "$WHO" <<'PY'
import json, sys
p, who = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d.setdefault('narration', {})['engine'] = 'recorded'; d['narration']['narrator'] = who
a = d['credits']['attribution']; marker = ' Narration recorded for WordLight by '
d['credits']['attribution'] = (a.split(marker)[0] if marker in a else a) + marker + who + '.'
json.dump(d, open(p, 'w'), ensure_ascii=False, indent=1); open(p, 'a').write('\n')
PY
echo "prepared $N pages in $OUT (narrator: $WHO). Next: node tools/content/build-story.ts $ID"
