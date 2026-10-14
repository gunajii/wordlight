# Marathi: what a native speaker should check

Marathi was added on 2026-10-14. The **story text is the official StoryWeaver translation** (कामसू मुंग्या, Sandhya
Taksale, Pratham Books, CC BY 4.0) and is not changed. Everything below was **written for WordLight** and needs a
Marathi speaker's review before wider use. Status: _not yet reviewed_.

## TV (child-facing) — packages/tv-core/src/text.ts
| Where | Marathi | English meaning |
|---|---|---|
| Your turn (echo) | `<name>, आता तू म्हण` | Now you say it |
| Well read | छान वाचलं! | Well read! |
| Help | थोडी मदत: “<word>” | A little help |
| Say it back | आता तू म्हण: “<word>” | Now you say it |
| Line done | `<n> स्वतः वाचले · <n> थोड्या मदतीने` | n on your own · n with a little help |
| Hint | अडचण आली? पुढचा शब्द ऐकण्यासाठी OK दाब · → दाबून ऐक | Stuck? Press OK for the next word |
| End | छान वाचलं! · समाप्त · पुन्हा भेटू | Well read · The end · See you |
| New sticker | `✓ <name>साठी नवा स्टिकर: हे पुस्तक आता तुझ्या शेल्फवर आहे!` | A new sticker for <name> |

Gendered verb forms are avoided where possible (“अडचण आली?” instead of “अडकलास/अडकलीस?”).

## Phone (parent-facing) — web/phone/i18n.js
The consent text (सुरू करण्यापूर्वी …) must say exactly what the English says: the microphone is used **only during
reading turns**, the child's voice is **not stored**, and the sound goes to Amazon Transcribe for recognition. Hindi
strings in the same file need the same review.

## Reading turns (content/sources/busy-ants-mr/source.json)
मी या रांगेत चौथी आहे. · आम्ही शांतपणे रांगेत चालतो. · आमची वासाची भाषा आहे. · दार बंद असलं तरी चालतं.
