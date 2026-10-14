# WordLight — Devpost project story

Pasted into Devpost → Project details → About the project. Every number is in MEASURED_RESULTS.md.

## Inspiration
In many homes the TV is on every evening, and children see words on it all the time. Lighting each word as it is spoken (same-language subtitling) has been used in literacy programmes in India ([UNESCO LitBase](https://www.uil.unesco.org/en/litbase/reading-billion-same-language-subtitling-india)). But watching is passive. A child learning to read needs **someone who listens**: someone who waits when they get stuck, and helps with just one word. Parents can't always be that person every night. So I asked: what if the TV itself stopped and said, *"now you say it"*?

## What it does
WordLight turns the family Fire TV into a read-along partner for children of about 6–10.
- **Pair in seconds:** the TV shows a QR code. A parent scans it (a web page, no app), agrees to the microphone rule, and adds the reader's first name, age and language.
- **Listen:** an illustrated picture book plays, read aloud by Amazon Polly, and **every word lights up** as it is spoken.
- **Your turn:** the TV reads a line, stops, and says *"Riya, now you say it."* The child reads the line back into the phone. Amazon Transcribe hears them, and **only the words actually read turn green**.
- **Help, never "wrong":** if the child is stuck, the TV waits while they are still trying (a stutter counts as trying). After about 3 seconds of quiet it says just the next word, slowly, marks it amber, and lets the child say it back (✓).
- **Turns grow with the child:** 5 reading turns at age 5, one more per year, with longer lines for older readers.
- **Well read!** The TV and the parent's phone show what really happened: words read on their own, and words that needed a little help.
- **Reading diary:** the parent's phone also shows the last week of sessions (story, words read on their own, words helped), counts only, kept 30 days.
- **In the parent's language:** the parent can get that summary on the phone in Hindi, Marathi, Bengali, Gujarati, Kannada, Tamil or Telugu (Amazon Translate; checked in the app in Marathi). The child's name is never sent for translation.
- **English and Hindi:** five English picture books from Pratham Books on StoryWeaver (CC BY 4.0): *Busy Ants*, *Naughty Dog*, *Noisy Crows*, *Clean Cat* and *The Moon and The Cap*, plus my Hindi translation of *Busy Ants*.

## Why the TV, not a tablet
Reading-aloud tutors already exist on phones and tablets. WordLight puts the same idea on the screen a family shares:
- **Reading becomes family time.** The child reads to the TV with a parent beside them, not alone on one more personal
  screen.
- **Nothing to hand to a 6-year-old.** The phone stays with the parent as the microphone; the child follows big words
  on the TV from the sofa.
- **Made for Indian homes.** English and Hindi stories from StoryWeaver's free library, a Hindi narrator, and a reading
  engine that handles Devanagari.
- **No new hardware.** A Fire TV app plus the phone the family already has.

## Languages: built to travel
- **Today:** the child reads in English and Hindi, and the parent's summary comes in 8 languages.
- **Adding a language is mostly content, not new code:** a free StoryWeaver book, a narrator (Amazon Polly today; a recorded narrator could be timed the same way, because my generative narration is already timed by Amazon Transcribe alignment), and a language Amazon Transcribe can hear live.
- **The reach:** StoryWeaver lists over 60,000 free stories in more than 300 languages, and Amazon Transcribe streams more than 70 languages, 10 of them Indian besides English. The goal is a family TV that becomes a reading partner in the language a child speaks at home. So far only English and Hindi reading are tested.

## How I built it
- **Fire TV app on Vega OS:** React Native for Vega, the W3C `AudioPlayer`, and remote-only navigation. Word timing uses my open-source **[karaoke-vega](https://github.com/gunajii/karaoke-vega)** (MIT). It turns the player's coarse `currentTime` into an accurate playhead and cancels the measured audio latency.
- **Phone:** a plain web page. The microphone opens **only during a reading turn**, and the page always shows whether it is on or off.
- **Server on AWS:** one Graviton EC2 instance behind TLS (CloudFormation, an IAM role with no keys on the server, SSM, private S3). For each turn it opens an **Amazon Transcribe streaming** session (en-IN, hi-IN). At the end, **Amazon Translate** puts the parent's summary into the parent's language; the child's name is swapped for a placeholder first, and anything unexpected falls back to English.
- **The reading engine is deterministic, not a chatbot:**
  - A misread word does not light, and the cursor never goes backwards.
  - Small spelling noise on long words is tolerated; vowel changes (big/bag, कल/काल) are not.
  - A voice-activity detector tells "still trying" apart from silence, so help never interrupts.
- **Narration with Amazon Polly:** the expressive generative Kajal voice for English and neural Kajal for Hindi, plus a slow single-word help clip for every word in a reading line. The generative voice returns no word timings, so Amazon Transcribe listens to the narration and an aligner maps its words onto the known text.
- **Privacy by design:**
  - No audio and no transcript text is stored.
  - **Amazon DynamoDB** keeps only counts.
  - Audio goes only to my AWS endpoint, and the AWS AI-services opt-out is on.
  - AWS Budgets watches a USD 100 spending ceiling.

## What I measured
Every number has its device, sample and method in the repository's `MEASURED_RESULTS.md`.
- **Highlight in sync with the narration:** median −1.0 ms, SD 11 ms, over 242 words on the Vega Virtual Device.
- **Speech recognition:** about 95 % of words recognised, but only 51 % within 1 second (169 test lines). So I redesigned the interaction around **Echo Mode**: the child hears the line first, then says it.
- **The real loop (phone → AWS → Transcribe → TV):**
  - adult tester: a word lights a median **1.05 s** after it is spoken (93 words, 5 sessions);
  - children: a median **1.15 s** (48 words).
- **Children:** two children (ages 4 and 6), with a parent present, completed **14 of 14 reading turns**. Viraj's mother afterwards: *“This app is a really good way for Viraj to learn and revise his reading. Most of the time I am either unavailable or don't comprehend the exact words like the app might, which makes his learning better.”*
- **The parent's summary in Marathi:** worked in the app (one adult session, 14 Oct), after I fixed a translation problem described below.
- **Privacy:** **0 violations** in 1,238 microphone status reports from the phone.
- **221 automated tests**, run by GitHub Actions on every push.
- **Cost:** about **USD 0.03 of Transcribe per reading session.** Narration costs nothing at play time.

## Challenges I ran into
- **Recognition takes about a second.** "Read first, then light up" felt late, so I measured it, then designed the reading around Echo Mode instead of hiding it.
- **Polly speech marks are UTF-8 byte offsets.** A Devanagari character is 3 bytes, and SSML shifts the offsets again. The generative voice gives no timings at all.
- **Vega surprises:**
  - The media player silently refuses `http://` sources.
  - The virtual device's clock drifted and broke HTTPS.
  - A nested `<Text>` background is not drawn.
  - A focused card is drawn faded. All of these are in my friction log.
- **A brand-new AWS account:** services came online one by one, Amazon Bedrock is still not authorised (so the parent's language comes from Amazon Translate instead), and EC2 had no capacity on one restart.
- **Amazon Translate spelled my name placeholder in Marathi letters.** The child's name is swapped for a placeholder before translation; Hindi kept it, but Marathi turned it into एक्सक्यूझेड, so the app safely fell back to English. Amazon's do-not-translate markup fixed it (friction log W20).
- **Real children found real bugs.** The 6-year-old found 3–4 turns too easy, which led to the age-based turns. The phone locking itself mid-story led to an automatic reconnect.

## Accomplishments that I'm proud of
- A real child reading a whole story with the TV, filmed as it happened, with nothing staged.
- The microphone rule holds: 0 violations, and the mic is off within a quarter of a second of each turn ending.
- A reusable open-source word-timing component for Vega developers.

## What I learned
- **Measure before designing.** One number (51 % within 1 second) changed the whole interaction.
- **Encouragement is a design rule, not a tone.** No red, no "wrong", and help only when the child has stopped trying.
- **Children test differently from adults.** Every session with them changed something.

## What's next
- A physical Fire TV stick (so far tested on the Vega Virtual Device).
- Stories in more of the languages Transcribe can hear, starting with Indian ones (the parent's summary already comes in eight).
- More families, always with a parent's permission.
- A Bedrock-written parent summary once my account is authorised. It is built and guarded, and falls back to a template today.

*WordLight makes no claim that it improves reading: a few sessions can't show that. What it shows is that a child can read with the TV, and the TV can listen.*

## Built with (Devpost tags)
vega-os, react-native, fire-tv, typescript, javascript, node.js, amazon-transcribe, amazon-polly, amazon-translate, amazon-ec2, amazon-s3, amazon-dynamodb, aws-cloudformation, aws-iam, aws-systems-manager, aws-budgets, github-actions, websockets, web-audio-api, caddy, webvtt, storyweaver
