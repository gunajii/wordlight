# Hindi review — “व्यस्त चींटियाँ” and the TV's Hindi words

Reviewed 2026-10-09 against the English original (Busy Ants, StoryWeaver, CC BY 4.0). The rule: faithful and
child-friendly; no rewriting for taste. Status of the translation itself: **our own, unofficial** (marked so in the
credits). A native-speaker review by the developer is still recorded below as pending.

## Mechanical checks (MEASURED, `hindiTextProblems` + Unicode checks on `content/sources/busy-ants-hi/source.json`)
- All 10 pages: no validator problems; text is NFC.
- Nukta: written as consonant + U+093C (the NFC form; the precomposed U+0958–095F letters are composition
  exclusions): तेज़, तरफ़, ख़तरा, ताक़त ×2, दरवाज़ा, सैकड़ों, ख़ुशी ×2 — all present where Hindi needs them.
- Chandrabindu/anusvara: हूँ, चींटी, चींटियाँ, बायाँ, दायाँ, यहाँ, आऊँगी — correct.
- Punctuation: danda (।) ends each sentence; questions end in “?”; quoted speech uses “ ” with the danda inside
  (“…जाना।”), matching the English.
- Conjuncts render with the bundled Noto Sans Devanagari (S1 visual check: क्ष त्र ज्ञ श्र कृ, nukta letters).

## Meaning, page by page
| # | Hindi | English | Finding |
|---|---|---|---|
| 1 | नमस्ते, मैं इस कतार में चौथी चींटी हूँ। क्या तुम मुझे देख सकते हो? | Hello, I am the fourth one in the line. Can you see me? | faithful |
| 2 | बायाँ, दायाँ, बायाँ, दायाँ। हम चुपचाप एक कतार में **चलते हैं**। | Left, right… We walk silently in a line. | faithful; **agreement** — see below |
| 3 | मुझे एक तरकीब सूझी है। तेज़ चलने के लिए मैं पहिए ले आऊँगी! | I just got an idea. I am going to get a set of WHEELS… | faithful (the capitals' emphasis is not carried) |
| 4 | हम दूसरे जानवरों की तरह शोर नहीं **करते**। हमारी भाषा गंध की भाषा है। | We are not noisy like other animals. Ours is a language of smells. | faithful; **agreement** — see below |
| 5 | एक गंध कहती है, “इस तरफ़ आओ, यहाँ दावत है।” | One kind of smell says, “Follow me this way for a feast.” | faithful (गंध is feminine: कहती ✓) |
| 6 | दूसरी गंध कहती है, “ख़तरा! उधर मत जाना।” | Another smell says, “Danger! Do not go there.” | faithful |
| 7 | मुझे केक और हर तरह की मिठाई पसंद है, बिल्कुल तुम्हारी तरह। | I love cakes and all kinds of sweets, just like you. | faithful (collective singular मिठाई is idiomatic) |
| 8 | मेरी ताक़त देखनी है? मैं तुम्हें बहुत छोटी लगती हूँ, पर मैं बहुत ताक़तवर हूँ। | Want to see my muscles at work? I may look very tiny to you, but I am very strong. | faithful |
| 9 | दरवाज़ा बंद है तो क्या हुआ? मैं सबसे छोटी दरार से भी निकल जाती हूँ। | Never mind if the door is shut. I can slip through the smallest crack. | faithful |
| 10 | मानो या न मानो, हम सैकड़ों चींटियाँ एक बस्ती में ख़ुशी-ख़ुशी रहती हैं। | Believe it or not, hundreds of us live happily in a colony. | faithful |

### The one real issue: grammatical gender of “हम” (pages 2 and 4)
The narrator is a female ant everywhere else (चौथी चींटी, ले आऊँगी, छोटी लगती हूँ, निकल जाती हूँ) and page 10 uses
the feminine plural (हम … चींटियाँ … रहती हैं). Pages 2 and 4 use the masculine/default plural (चलते हैं, नहीं करते).
Spoken Hindi does allow the default plural with हम, so this is not an error a reader would stumble on, but a book for
young readers should be consistent. **Proposed (minimal) change, pending the developer's decision:**
- p2: हम चुपचाप एक कतार में **चलती हैं**।
- p4: हम दूसरे जानवरों की तरह शोर नहीं **करतीं**।
Neither sentence is a “Your turn” line, so the reading turns are unaffected; the page audio would be re-narrated.

## TV words in Hindi (`packages/tv-core/src/text.ts`) — shown for Hindi stories only
| situation | English | Hindi |
|---|---|---|
| echo turn | Riya, now you say it | रिया, अब तुम बोलो |
| free turn | Riya, your turn | रिया, अब तुम्हारी बारी |
| help | Here’s a little help: “word” | थोड़ी मदद: “शब्द” |
| line finished | Well read! · 3 on your own · 1 with a little help | बहुत बढ़िया पढ़ा! · 3 ख़ुद पढ़े · 1 थोड़ी मदद से |
| progress | 2 of 5 words | 5 में से 2 शब्द |
| listening / off | ● listening / ○ microphone off | ● सुन रहे हैं / ○ माइक बंद |
| cancelled | Let’s listen together | चलो, साथ में सुनते हैं |
| end card | words on your own · with a little help · reading turns | शब्द ख़ुद पढ़े · थोड़ी मदद से · पढ़ने की बारी |
Choices: तुम (the familiar “you” a parent or teacher uses with a child); short spoken words (माइक, OK);
gender-neutral wording where the reader's gender is unknown (“पाठक: रिया” instead of पढ़ रहा/रही है). Nothing says
“wrong” (a test enforces it). The parent summary stays in the parent's (phone) language.

## Pending
- Developer (native speaker) review of this page and the decision on the p2/p4 agreement change.
- How Transcribe hi-IN handles ख़ुशी-ख़ुशी (hyphenated compound): covered by the engine's compound rule only if
  Transcribe returns the two halves; not a turn line.
