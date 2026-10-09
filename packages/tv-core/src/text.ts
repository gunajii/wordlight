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
  end: { title: string; theEnd: string; seeYou: string; wordsAloud(n: number): string; onOwn(n: number): string; withHelp: string; turns(n: number): string; pairNext: string };
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
  end: { title: 'Well read!', theEnd: 'The end', seeYou: 'See you next time', wordsAloud: (n) => `${n} word${n === 1 ? '' : 's'} read aloud`, onOwn: (n) => `word${n === 1 ? '' : 's'} on your own`, withHelp: 'with a little help', turns: (n) => `reading turn${n === 1 ? '' : 's'}`, pairNext: 'Pair a phone next time to read some lines yourself.' },
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
  end: { title: 'बहुत बढ़िया पढ़ा!', theEnd: 'समाप्त', seeYou: 'फिर मिलेंगे', wordsAloud: (n) => `${n} शब्द बोलकर पढ़े`, onOwn: () => 'शब्द ख़ुद पढ़े', withHelp: 'थोड़ी मदद से', turns: () => 'पढ़ने की बारी', pairNext: 'अगली बार फ़ोन जोड़कर कुछ पंक्तियाँ ख़ुद पढ़ना।' },
};

export function childText(lang?: string): ChildText { return lang === 'hi-IN' ? hi : en; }
