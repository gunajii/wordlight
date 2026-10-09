# Help recovery on the real recogniser (adult synthetic voice)

- 2026-10-09T11:47:12.194Z · Amazon Transcribe Streaming ap-south-1 · Polly Kajal neural (adult) · 10 turn lines from the shipped stories × pauses 600/1500 ms × configs before/after
- Reader: words before the stuck word, then "um… um…" (en) / "अ… अ…" (hi), then quiet until the TV helps. The help word plays (start latency 300 ms INFERRED, also leaking into the mic at 30 % amplitude), the reader reacts 500 ms after it ends (INFERRED), repeats the helped word, pauses (600 ms normal / 1500 ms slow), then reads the rest.
- "before" = driver as deployed until 2026-10-09 (no voice activity; clock restarts at the help event). "after" = voice activity + clock restarts when the TV reports the help word finished.

| config | runs | next word read | next word helped too early | line completed | recovery median (help word end → next word lit) | help after hesitation ended (median) |
|---|---|---|---|---|---|---|
| before | 20 | 19 | 1 | 20 | 3563 ms | 3576 ms |
| before pause 600 | 10 | 10 | 0 | 10 | 2827 ms | 3574 ms |
| before pause 1500 | 10 | 9 | 1 | 10 | 3692 ms | 3618 ms |
| after | 20 | 19 | 0 | 20 | 3374 ms | 3618 ms |
| after pause 600 | 10 | 10 | 0 | 10 | 2793 ms | 3618 ms |
| after pause 1500 | 10 | 9 | 0 | 10 | 3638 ms | 3768 ms |

MEASURED with an adult synthetic voice and the constants above; a child's timing is UNKNOWN.
