# WordLight

> **The TV already has the words. WordLight teaches your child to read them.**

WordLight is a Fire TV (Vega OS) reading app for children aged about 6–10. The family watches a short illustrated story; every word lights up as it is narrated. At marked **your turn** lines the narrator stops, the child reads the line aloud into a paired phone, and the words light up on the TV as the child says them. If the child stalls, the TV says the next word and carries on. Nothing is ever marked wrong.

WordLight is designed around a proven same-language-subtitling approach ([UNESCO LitBase](https://www.uil.unesco.org/en/litbase/reading-billion-same-language-subtitling-india)). **We are not claiming that this prototype itself has demonstrated a reading improvement.**

**Status (2026-09-29): day 1.** Pure logic is built and tested. Nothing has run on Vega yet: spike S1 is ready to run. See [docs/SPIKES.md](docs/SPIKES.md).

## Repository

| Path | What | State |
|---|---|---|
| `packages/shared-protocol` | Live event types, validator, binary audio frames | tested |
| `packages/reading-engine` | Deterministic matcher: normalisation, strict fuzzy match, skip/stall/help state machine | tested (no real speech yet) |
| `packages/karaoke-core` | PlayheadSampler, word timing lookup, WebVTT word timestamps (future open-source package) | tested |
| `packages/story-package` | Story format, validator, Polly speech-mark mapping (UTF-8 byte offsets), turn-line selection | tested |
| `packages/session-client` | WebSocket client + clock sync, reused unchanged from Earshot | tested |
| `server/` | Session server: pairing, event routing, heartbeat, content, QR | tested |
| `apps/vega-tv/` | Vega TV app overlay + `setup.sh` (S1 spike build) | **not yet run on Vega** |
| `web/phone/` | Phone web page | not started |
| `tools/s1-media` | Generates the S1 timing-test story (clicks at known word times) | used |
| `tools/audio-analysis` | `av_offset.py`: highlight-vs-audio offset from a recording; validated on synthetic recordings | validated offline |
| `docs/` | Architecture, spikes, test plan, privacy, content, friction log, reuse record | |

## Quick start (development)

Needs Node ≥ 22.18 (runs TypeScript directly), npm, and for the TV app the Vega SDK (macOS/Ubuntu).

```bash
npm install
npm test          # all unit + integration tests
npm run typecheck
npm start         # session server on :8787 (prints the LAN URL the TV and phones use)
bash apps/vega-tv/setup.sh   # generate/refresh the Vega app (S1 build)
```

## Privacy (summary)

The phone microphone opens only during a reading turn, after a parent's explicit consent. Audio is streamed for recognition and not stored; only per-word outcomes are kept. Details and open verifications: [docs/PRIVACY.md](docs/PRIVACY.md).

## Attribution

Story sources and licences: [docs/CONTENT.md](docs/CONTENT.md). Noto Sans Devanagari: SIL Open Font License (`apps/vega-tv/overlay/assets/fonts/OFL.txt`). Code reused from the author's earlier Earshot project: [docs/REUSED.md](docs/REUSED.md).

## Licence

MIT
