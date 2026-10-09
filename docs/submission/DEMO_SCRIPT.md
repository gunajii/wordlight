# Demo video script (target 2:45, hard limit 3:00)

The product must be understood before 2:00. Show WordLight first, AWS later.

## Setup (deterministic, rehearsable)
- `bash tools/demo/real-demo.sh` — restarts the Vega Virtual Device (its clock drifts), starts the AWS server, checks
  health (TLS, real Transcribe, no tunnel), builds and launches the TV app, and stops the server at the end.
- **Path:** phone → AWS (HTTPS/WSS) → Amazon Transcribe → reading engine → Vega Virtual Device. No simulated speech:
  the TV shows no SIMULATED badge on this path. Say “Vega Virtual Device” in the video (no physical Fire TV tested).
- **Story:** *Busy Ants* (English; credits on the end card). Optional 10 s cut of *व्यस्त चींटियाँ* to show Hindi.
- **Reader:** an **adult** reading in a child's place (no child's voice or face without written guardian permission);
  profile name “Riya”.
- **Planned moments:** turn 1 — read it back cleanly; turn 2 — stutter on a word (“s… s…”), go quiet, let the TV help,
  then **say the word back** (✓) and finish; turn 3 — one deliberate wrong word, then correct it (it lights only when
  right).
- Hide the diagnostics panel (↑ toggles it). Phone: Do Not Disturb, brightness up, page open on the consent card.
- Record the Mac screen with system audio (TV window) and the phone screen separately; cut together.

## Timeline
| Time | Picture | Voiceover (approx.) |
|---|---|---|
| 0:00–0:12 | TV shelf with *Busy Ants*; a child-sized chair (no face) | “Kids already see words on TV. WordLight helps them read them.” |
| 0:12–0:27 | Phone: scan QR → consent (“mic only during reading turns, voice not stored”) → Riya, 7, English | “Pair a phone in seconds — no app. A parent agrees once; the mic only turns on for a reading turn.” |
| 0:27–0:50 | Story plays; words light as narrated (close-up) | “Every word lights up as it's read — Amazon Polly narration, timed word by word on Fire TV.” |
| 0:50–1:20 | “Riya, now you say it” · mic ● listening · words turn green as she repeats | “Then it's her turn. She says the line back; Amazon Transcribe hears her, and our reading engine lights only the words she actually says.” |
| 1:20–1:42 | Stutter → pause → TV says “see”, amber → “Now you say it: see” → she says it → ✓ → line finishes | “Stuck? The TV waits while she's trying, then helps — and gives her the chance to say it herself. Never ‘wrong’.” |
| 1:42–1:55 | Wrong word stays white → corrected → green | “A wrong word simply doesn't light until she gets it.” |
| 1:55–2:08 | “Well read!” end card + phone summary | “Parents see what really happened: words on her own, words with a little help.” |
| 2:08–2:35 | Architecture + measured numbers (from MEASURED_RESULTS only) | “Vega, a phone mic, Transcribe streaming, Polly narration on AWS. We measured everything: recognition takes about a second, so we built guided echo reading around it.” |
| 2:35–2:50 | `karaoke-vega` README on GitHub | “The word-timing layer is open source for any Vega developer.” |
| 2:50–3:00 | Logo + tagline | “The TV already has the words. WordLight teaches your child to read them.” |

Allowed numbers on screen: highlight sync −1.0 ms median (VVD) · word lit a median 1.08 s after spoken (76 words,
adult tester) · 0 microphone violations in 790 reports · 169-line recognition test (95 % recognised, 51 % within 1 s).

## Rehearsal checklist
- [ ] 3 clean full runs in a row with real-demo.sh
- [ ] Help fires at the planned word; the say-back ✓ appears
- [ ] End-card counts match what happened; phone shows “Microphone off” after each turn
- [ ] No diagnostics, no SIMULATED badge, no private URLs or keys on screen
- [ ] Final cut < 3:00; uploaded public; link tested in a private window

## If something fails on the day
- Transcribe error → the turn ends (“Let's listen together”), narration continues: re-record the take.
- Phone drops → the turn cancels automatically: re-scan and re-record.
- Server will not start (EC2 capacity) → the start script switches size automatically; if AWS is down, postpone —
  do not record the local simulation as if it were real.
