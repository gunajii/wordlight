// Child-facing words on the TV, in the story's language. Encouraging only: nothing ever says "wrong".
// Hindi strings: simple, spoken-style Hindi for 6–10-year-olds (reviewed: docs/HINDI_REVIEW.md). Diagnostics stay
// in English; the parent summary follows the parent's (phone) language.
export interface ChildText {
  yourTurn(name: string, mode: 'free' | 'echo'): string;
  wellRead: string; listenTogether: string; listenThisOne: string; pairPhoneLine: string;
  help(word: string): string;
  sayIt(word: string): string;
  lineDone(read: number, helped: number): string;
  progress(done: number, total: number): string;
  micStarting: string; micOn: string; micOff: string; hint: string;
  readingAlong(name: string): string; pairToRead: string;
  end: { title: string; theEnd: string; seeYou: string; wordsAloud(n: number): string; onOwn(n: number): string; withHelp: string; turns(n: number): string; pairNext: string; newSticker(name: string): string; back: string };
}

const en: ChildText = {
  yourTurn: (n, m) => (m === 'echo' ? `${n}, now you say it` : `${n}, your turn`),
  wellRead: 'Well read!', listenTogether: 'Let’s listen together', listenThisOne: 'Let’s listen to this one', pairPhoneLine: 'Pair a phone to read this line yourself next time',
  help: (w) => `Here’s a little help: “${w}”`,
  sayIt: (w) => `Now you say it: “${w}”`,
  lineDone: (r, h) => `${r} on your own${h ? ` · ${h} with a little help` : ''}`,
  progress: (d, t) => `${d} of ${t} words`,
  micStarting: '○ microphone starting…', micOn: '● listening', micOff: '○ microphone off',
  hint: 'Stuck? Press OK for the next word · → to listen instead',
  readingAlong: (n) => `● ${n} is reading along`, pairToRead: '○ Pair a phone on the home screen to read along',
  end: { title: 'Well read!', theEnd: 'The end', seeYou: 'See you next time', wordsAloud: (n) => `${n} word${n === 1 ? '' : 's'} read aloud`, onOwn: (n) => `word${n === 1 ? '' : 's'} on your own`, withHelp: 'with a little help', turns: (n) => `reading turn${n === 1 ? '' : 's'}`, pairNext: 'Pair a phone next time to read some lines yourself.', newSticker: (n) => `✓ A new sticker for ${n}: this book is on your shelf!`, back: 'Back to stories' },
};

const hi: ChildText = {
  yourTurn: (n, m) => (m === 'echo' ? `${n}, अब तुम बोलो` : `${n}, अब तुम्हारी बारी`),
  wellRead: 'बहुत बढ़िया पढ़ा!', listenTogether: 'चलो, साथ में सुनते हैं', listenThisOne: 'चलो, इसे सुनते हैं', pairPhoneLine: 'अगली बार फ़ोन जोड़कर यह पंक्ति ख़ुद पढ़ना',
  help: (w) => `थोड़ी मदद: “${w}”`,
  sayIt: (w) => `अब तुम बोलो: “${w}”`,
  lineDone: (r, h) => `${r} ख़ुद पढ़े${h ? ` · ${h} थोड़ी मदद से` : ''}`,
  progress: (d, t) => `${t} में से ${d} शब्द`,
  micStarting: '○ माइक चालू हो रहा है…', micOn: '● सुन रहे हैं', micOff: '○ माइक बंद',
  hint: 'अटक गए? अगला शब्द सुनने के लिए OK दबाओ · → दबाकर सुनो',
  readingAlong: (n) => `● पाठक: ${n}`, pairToRead: '○ साथ में पढ़ने के लिए होम स्क्रीन पर फ़ोन जोड़ो',
  end: { title: 'बहुत बढ़िया पढ़ा!', theEnd: 'समाप्त', seeYou: 'फिर मिलेंगे', wordsAloud: (n) => `${n} शब्द बोलकर पढ़े`, onOwn: () => 'शब्द ख़ुद पढ़े', withHelp: 'थोड़ी मदद से', turns: () => 'पढ़ने की बारी', pairNext: 'अगली बार फ़ोन जोड़कर कुछ पंक्तियाँ ख़ुद पढ़ना।', newSticker: (n) => `✓ ${n} के लिए नया स्टिकर: यह किताब अब तुम्हारी शेल्फ़ पर है!`, back: 'कहानियों पर वापस' },
};

// Marathi strings: simple spoken Marathi, gender-neutral where the verb would otherwise be gendered (review:
// docs/MARATHI_REVIEW.md).
const mr: ChildText = {
  yourTurn: (n, m) => (m === 'echo' ? `${n}, आता तू म्हण` : `${n}, आता तुझी पाळी`),
  wellRead: 'छान वाचलं!', listenTogether: 'चला, एकत्र ऐकूया', listenThisOne: 'चला, हे ऐकूया', pairPhoneLine: 'पुढच्या वेळी फोन जोडून ही ओळ स्वतः वाच',
  help: (w) => `थोडी मदत: “${w}”`,
  sayIt: (w) => `आता तू म्हण: “${w}”`,
  lineDone: (r, h) => `${r} स्वतः वाचले${h ? ` · ${h} थोड्या मदतीने` : ''}`,
  progress: (d, t) => `${t} पैकी ${d} शब्द`,
  micStarting: '○ माइक सुरू होत आहे…', micOn: '● ऐकत आहे', micOff: '○ माइक बंद',
  hint: 'अडचण आली? पुढचा शब्द ऐकण्यासाठी OK दाब · → दाबून ऐक',
  readingAlong: (n) => `● वाचक: ${n}`, pairToRead: '○ सोबत वाचण्यासाठी होम स्क्रीनवर फोन जोडा',
  end: { title: 'छान वाचलं!', theEnd: 'समाप्त', seeYou: 'पुन्हा भेटू', wordsAloud: (n) => `${n} शब्द मोठ्याने वाचले`, onOwn: () => 'शब्द स्वतः वाचले', withHelp: 'थोड्या मदतीने', turns: () => 'वाचनाच्या पाळ्या', pairNext: 'पुढच्या वेळी फोन जोडून काही ओळी स्वतः वाच.', newSticker: (n) => `✓ ${n}साठी नवा स्टिकर: हे पुस्तक आता तुझ्या शेल्फवर आहे!`, back: 'गोष्टींकडे परत' },
};

export function childText(lang?: string): ChildText { return lang === 'hi-IN' ? hi : lang === 'mr-IN' ? mr : en; }
/** Name of a story language in that language, for the shelf. */
export function langLabel(lang?: string): string { return lang === 'hi-IN' ? 'हिंदी' : lang === 'mr-IN' ? 'मराठी' : 'English'; }
/** Devanagari stories (Hindi, Marathi) use the bundled Devanagari font. */
export const isDevanagari = (lang?: string) => lang === 'hi-IN' || lang === 'mr-IN';
