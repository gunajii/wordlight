# Child reading tests — protocol (prepared, NOT yet run)

No child has used WordLight so far. This protocol exists so that a test can be run properly if a parent or guardian
agrees. The software does not need a child; every automated test uses scripts, synthetic speech or adult control speech.

## Rules
1. **Written permission from a parent or guardian, before anything else.** They are present for the whole session.
   The child can stop at any time, for any reason.
2. **Only the real AWS path.** Phone → `https://<aws-host>` (the AWS server) → Amazon Transcribe. The Cloudflare
   development tunnel is never used with a child's voice. Check the address bar on the phone before starting.
3. **Preferred method: no recording at all.** The child reads in the normal product. An adult marks a paper sheet
   (one line per reading turn: R = read correctly, M = misread, O = omitted, P = long pause). Afterwards:
   ```
   curl -s https://<aws-host>/api/reading/traces?session=<CODE> > traces.json   # numbers only, no audio, no text
   node tools/s2/score-observed.ts --traces traces.json --sheet sheet.txt --speaker "child, age 7, consented"
   ```
   The server keeps no audio and no transcript text (`DEV_TRANSCRIPTS` stays off on AWS).
4. **Recording, only if the parent separately agrees.** Store the files outside the repository (for example
   `~/WordLight-private/s2-child/`), never in Git and never in cloud storage. Score them with:
   ```
   node tools/s2/eval.ts --engine wav --audio-dir ~/WordLight-private/s2-child --speaker "child, consented"
   ```
   The harness refuses an audio folder inside the repository. **Delete the recordings after scoring** and write the
   date of deletion in the run's report.
5. **Report honestly.** Give the number of children, their ages, and the number of lines read. Never write
   "children" when one child took part. Never claim reading improvement: a session measures the recognition
   pipeline, not learning.

## Parent/guardian note (to read aloud or hand over)
> WordLight is a student project for a hackathon. It shows a story on the TV, and your child reads a few lines aloud
> into a phone. The phone's microphone is on only while your child is reading a line. The sound goes over an
> encrypted connection to Amazon Web Services (the Mumbai region), which turns speech into words so the TV can light
> them up. WordLight does not save the recording. With your permission we will write down, on paper, which words your
> child read, so that we can check how well the app follows a child's reading. We will not publish your child's
> name, voice or picture. You can stop at any time.
>
> Parent/guardian name: ____________  Signature: ____________  Date: ________
> ☐ I agree to a session without recording   ☐ I also agree to an audio recording, deleted after scoring

## A child in the demo video (separate permission)
The note above promises *not* to publish a child's name, voice or picture. A demo video publishes them, so it needs
its own, specific permission — ask only after explaining that the video will be **public on YouTube/Vimeo** and seen
by hackathon judges and anyone with the link.

> **Video permission.** The demo video for WordLight (a student hackathon project) will be public online.
> ☐ My child's **voice** may appear   ☐ my child's **hands/back** may appear (no face)   ☐ my child's **face** may appear
> Name shown/spoken: ☐ first name ________  ☐ a made-up name (e.g. “Riya”)  ☐ no name
> I may ask for the video to be taken down or re-cut, and it will be done as soon as possible (copies made by others
> cannot be recalled). Parent/guardian name: ____________ Signature: ____________ Date: ________

Before recording:
1. `bash tools/aws/final-checks.sh` shows the **AI services opt-out = optOut** (our rule before any child audio).
2. The phone's address bar shows the AWS host (`…sslip.io`), not a tunnel.
3. The parent is in the room for the whole session; the child agrees too and can stop any time; short (≈ 5 min).
4. Fill the paper sheet for every turn — the session doubles as the first child test (score it with
   `tools/s2/score-observed.ts`; report it as ONE child, with age, honestly).

In the edit: show the takes as they happened (cutting for length is fine; staging recognition results is not), label
the clip “a child reading with WordLight (shown with a parent's permission)”, and claim nothing about learning.
