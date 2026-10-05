# Demo video script (target 2:45, hard limit 3:00)

The core loop must be on screen before 2:00. No long intro.

## Setup (deterministic, rehearsable)
- **Server:** the AWS deployment (`READING_MODE` set from the S2 decision). The health check is green.
- If AWS is not ready, the fallback is local demo mode (`npm run demo:local`). In that case the TV shows
  **SIMULATED SPEECH**, and the voiceover must say "simulated recognition" when the reading part is on screen.
  Never present it as Transcribe.
- **TV:** Vega Virtual Device, full screen, recorded with macOS screen recording plus system audio. Use a physical
  Fire TV only if one is available (say which).
- **Story:** the real StoryWeaver story (credits on screen). A known reader: "Riya" profile saved on the phone. The
  reader is an **adult** reading in a child's place, unless a parent has given written permission.
- **The stall:** at the second turn the reader pauses on a chosen word for about 4 s, so help is predictable. At the
  first turn the reader makes one deliberate misread, then corrects it.
- Phone: Do Not Disturb on, brightness up, the page pre-opened on the consent card.

## Timeline
| Time | Picture | Voiceover (approx.) |
|---|---|---|
| 0:00–0:12 | TV shelf; a child-sized chair in front of the TV (no face) | "Kids already see words on TV. They just don't read them. WordLight changes that." |
| 0:12–0:28 | Phone: scan the QR → consent ("mic only during reading turns, voice not stored") → name Riya, age 7 → Start | "Pair a phone in five seconds. No app. The parent agrees once, and the mic only turns on for a reading turn." |
| 0:28–0:55 | Story plays; words light up as narrated (close-up of the subtitle) | "Every word lights up as it is read: Amazon Polly narration, timed word by word on Fire TV." |
| 0:55–1:30 | "Riya, your turn". MIC ON. The reader reads; words turn green one by one; misread → stays white → corrected → green | "Now she reads. Amazon Transcribe hears her, and our reading engine lights only the words she actually reads." |
| 1:30–1:48 | Second turn: pause → the TV says the word, which turns amber → reading continues → "Well read!" → narration resumes | "Stuck? After three seconds the TV helps. Never 'wrong', just help." |
| 1:48–2:05 | End card: on your own / with a little help / turns; phone summary | "Parents see what really happened: words read independently, and words that needed help." |
| 2:05–2:35 | Architecture slide plus measured numbers (MEASURED_RESULTS only) | "Vega, phone mic, Transcribe streaming, Polly speech marks, a strict deterministic engine, privacy by design. Here is what we measured." |
| 2:35–2:50 | `@wordlight/karaoke-vega` README | "The word-timing layer is open source, for any Vega developer." |
| 2:50–3:00 | Logo plus tagline | "The TV already has the words. WordLight teaches your child to read them." |

## Rehearsal checklist
- [ ] 3 clean full runs in a row on the exact setup
- [ ] Words light within about 1 s on the real path (check the diagnostics panel with ↑, then hide it)
- [ ] Help fires once, at the planned word
- [ ] The end card counts match what happened
- [ ] Phone shows MIC OFF after each turn
- [ ] Nothing on screen claims more than MEASURED_RESULTS supports
- [ ] Final cut < 3:00; uploaded public; link tested in a private window

## If something fails on the day
- Transcribe errors → the turn ends ("Let's listen together") and narration continues. Re-record the take.
- The phone drops → the turn is cancelled automatically. Re-scan and re-record.
- AWS unavailable → local demo mode, labelled SIMULATED in the picture and the voiceover.
