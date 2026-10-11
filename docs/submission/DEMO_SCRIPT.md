# Demo video script — with a child (target 2:50, hard limit 3:00)

The judges should understand WordLight in the first 20 seconds and see a child reading with it before 1:00.
Structure: problem from a real person → the product in use → the parent's verdict → how it's built → what's next.
Everything shown happened as filmed: cut for length, never stage a recognition result.

## Before anything: permission and safety (docs/CHILD_TESTING.md)
- [ ] The parent/guardian has signed the **video permission** (public video; voice / hands / face ticked as agreed;
      first name or a made-up name). Keep the signed sheet; it is not uploaded anywhere.
- [ ] The parent is in the room for the whole session. The child agrees too, and can stop at any time. Keep it short.
- [ ] `bash tools/aws/final-checks.sh` shows the AI services opt-out as **optOut**.
- [ ] The phone's address bar shows the AWS host (`…sslip.io`), never a tunnel.
- [ ] Reader name on the phone = the name the parent ticked (or “Riya” if a made-up name was chosen).
- [ ] Phone and Mac on Do Not Disturb. No other children, addresses, school names or family photos in the frame.

## Equipment and capture
- **Main camera (carries the sound):** a phone on a tripod or a stack of books, filming the child from the side or
  behind, with the screen in view. macOS's built-in screen recorder does not record the app's sound, so the
  camera's microphone is what captures the narration, the help word and the child's voice together.
- **Best look:** connect the Mac to a real TV with HDMI and make the Vega Virtual Device window large. It then looks
  like a living room. Still say “running on the Vega Virtual Device” (no physical Fire TV was tested).
- **Clean screen inserts:** `bash tools/demo/real-demo.sh` records the TV window itself (`.dev/rec/<time>/`, a still
  every 2 s). For moving close-ups, also start ⌘⇧5 → *Record Selected Portion* around the TV window. Put the camera's
  audio under these inserts in the edit.
- **Phone screen:** the phone's own screen recording for the pairing and the parent summary.
- **Story for the child:** *Naughty Dog* (3 turns, common words, a dog — fun for a 6–8 year old). *Busy Ants* also
  works (4 turns). Read the story together once off-camera first, so the child knows how it goes.
- **Stuck moments:** let them happen naturally. If the child never gets stuck, that is fine and honest. Use the
  adult rehearsal take for “stuck → help → say it back”, labelled on screen *“adult tester”*.

## Timeline
| Time | Picture | Words (voiceover = VO; real people speak for themselves) |
|---|---|---|
| 0:00–0:18 | Parent on camera (or voice over the living room) | **The parent, in their own words.** Prompt them off-camera: *“What happens when your child reads at home?”* / *“What do they watch on TV?”* Use one honest sentence or two. Don't write their lines for them. |
| 0:18–0:24 | Title over the living-room shot: **WordLight — a TV that listens to your child read** | VO: “WordLight turns the family TV into a read-along partner.” |
| 0:24–0:38 | Phone: scan the QR on the TV → consent card → reader name, age, English → *Start reading session* | VO: “A parent pairs a phone in seconds, with no app to install. They agree once: the microphone is on only during a reading turn, and the voice is not stored.” |
| 0:38–0:55 | Story plays; words light up yellow as they're read (close-up insert) | VO: “The story is read aloud, and every word lights up as it's spoken.” |
| 0:55–1:25 | **The child's turn.** “*Name*, now you say it” · mic ● listening · words turn green as the child reads | Let the child's voice carry it. VO (short, over the start): “Then it's the child's turn. The TV listens and lights only the words actually read.” |
| 1:25–1:45 | Stuck → the TV waits → helps with one word (amber) → “Now you say it” → the child says it → ✓ → the line goes on | VO: “Stuck? The TV waits while they're still trying, then helps with just that word, and gives them the chance to say it back. Nothing is ever marked wrong.” (If this take is the adult rehearsal, show *“adult tester”* on screen.) |
| 1:45–1:58 | *व्यस्त चींटियाँ*: one Hindi line lighting up and a Hindi turn | VO: “It works in Hindi too.” |
| 1:58–2:10 | “Well read!” end card → the phone's parent summary | VO: “At the end, parents see what really happened: words read on their own, and words with a little help.” |
| 2:10–2:25 | **Parent's verdict**, on camera | Their own words. Prompts: *“What did you notice?”* / *“Would you use it again?”* Keep whatever they really say, including doubts. |
| 2:25–2:45 | Architecture card (below) | VO: “Under the hood: a Vega OS app on Fire TV, a phone microphone over a secure connection, Amazon Transcribe streaming to hear the child, and Amazon Polly to narrate, all on AWS. We measured it: a spoken word lights up in about a second, so the TV reads first and the child repeats, which is guided echo reading.” |
| 2:45–2:55 | GitHub: wordlight + karaoke-vega | VO: “It's open source, and the word-timing component is reusable by any Vega developer. Next: more stories and more Indian languages.” |
| 2:55–3:00 | Icon + name | VO: “WordLight. The TV already has the words; now it helps children read them.” |

**Architecture card (one slide):** Phone mic → HTTPS/WSS → EC2 (Mumbai) → Amazon Transcribe streaming → reading engine
→ Vega OS app (Fire TV). Story narration: Amazon Polly (expressive voice), timed word by word with Transcribe. Session
counts only: DynamoDB. Nothing else.

**Numbers allowed on screen** (all in MEASURED_RESULTS.md; say “adult tester” with them):
- highlight in sync with narration: median −1.0 ms (Vega Virtual Device)
- a spoken word lights a median 1.05 s later (93 words, 5 sessions)
- 0 microphone violations in 891 status reports
- recognition test: 95 % of words recognised, 51 % within 1 s (169 lines)

**Don't say:** that a child's reading improved (one session measures nothing about learning) · “children” if one
child took part · “Fire TV device” for the footage (it's the Vega Virtual Device) · anything about Bedrock.

## Upload (YouTube)
- Title: **WordLight: a Fire TV that listens to your child read (Amazon Developer Hackathon 2026)**
- Audience: **No, it's not made for kids** (it is a demo for judges). Visibility: public (or unlisted if the rules allow).
- English subtitles (YouTube's auto captions, then correct names and Hindi lines by hand).
- On-screen label wherever the child appears: *“A child reading with WordLight, shown with a parent's permission.”*
- Description template:
  ```
  WordLight turns the family TV into a read-along partner: the story is read aloud with every word lighting up, then
  the child reads the line back into a phone; Amazon Transcribe listens, and the TV helps with a word only when the
  child is stuck. English and Hindi. Built on Vega OS (shown on the Vega Virtual Device) and AWS.

  0:00 The problem, from a parent
  0:24 Pairing a phone in seconds
  0:38 The story lights up word by word
  0:55 The child's turn
  1:25 Stuck? Help, then say it back
  1:45 Hindi
  1:58 What the parent sees
  2:10 The parent's verdict
  2:25 How it's built on AWS
  2:45 Open source and what's next

  Code: https://github.com/gunajii/wordlight (MIT) · Word-timing component: https://github.com/gunajii/karaoke-vega
  Stories: “Busy Ants” and “Naughty Dog”, written by Kanchan Bannerjee, illustrated by Deepa Balsavar, published by
  Pratham Books (© Pratham Books, 2015) under a CC BY 4.0 licence on StoryWeaver (storyweaver.org.in).
  “व्यस्त चींटियाँ” is our own unofficial Hindi translation of Busy Ants (CC BY 4.0).
  Narration: Amazon Polly. Shown with a parent's written permission.
  ```

## Recording-day checklist
- [ ] `bash tools/demo/real-demo.sh` (restarts the Virtual Device, starts the server, builds with the icon)
- [ ] Shelf shows the three stories; diagnostics hidden; no SIMULATED badge
- [ ] At the end card: **Enter first**, then Home (otherwise the server results are not saved)
- [ ] Optional: fill the paper sheet for each turn. The session doubles as the first child test; report it as ONE
      child with age, honestly (docs/CHILD_TESTING.md)
- [ ] Afterwards: `bash infra/aws/deploy.sh --stop`; keep raw footage outside the repository (videos never go to Git)
- [ ] Final cut under 3:00; link tested in a private window; the parent has seen the final cut before it goes public

## If something fails on the day
- Recogniser error → the turn ends (“Let's listen together”) and the story carries on: retake.
- Phone drops → the turn cancels by itself: scan again and retake.
- The child is tired or doesn't want to → stop. Use what you have plus the adult rehearsal take (labelled).
- Server won't start (EC2 capacity) → the start script switches size by itself; if AWS is down, postpone. Never record
  the local simulation as if it were real.
