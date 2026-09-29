# Code reused from Earshot

Source: `~/Projects/earshot` (same author, MIT), commit `fe64ce9`. Earshot is unchanged.

| WordLight file | From Earshot | Change |
|---|---|---|
| `packages/session-client/src/{client,clock,pinger}.js` | `packages/vega-sync/src/` | none (header added) |
| `packages/session-client/test/earshot-reused.test.js` | `packages/vega-sync/test/core.test.js` (clock, pinger, client tests) | extracted |
| `packages/karaoke-core/src/sampler.ts` | `packages/vega-sync/src/sampler.js` | TypeScript, `positionAt()` added |
| `server/src/index.ts` | `server/index.js` | HTTP/QR/heartbeat/Range plumbing adapted; WordLight routes |
| `server/src/hub.ts` | `packages/vega-sync/src/session.js` | design only (sessions, hello/welcome, ping, timeline); routing rewritten |
| `apps/vega-tv/setup.sh` | `apps/vega-tv/setup.sh` | adapted (audio player, fonts, vendoring) |

Not reused: the personalised-audio follower, Web Audio engine, TV playhead publisher and simulator.
