// Text normalisation for matching what the child said against the expected line.
// Goal: equal words compare equal regardless of spelling variants that ASR and books disagree on,
// WITHOUT making different words equal. Every rule here must have a test.

export type Lang = 'hi-IN' | 'en-IN';

const NUKTA = '़';
const VIRAMA = '्';
const CHANDRABINDU = 'ँ';
const ANUSVARA = 'ं';
const ZW = /[​-‍﻿]/g; // zero-width space / (non-)joiner / BOM
const DEVANAGARI_DIGITS = '०१२३४५६७८९';

// Small numbers are read aloud as words; ASR may print either form. Canonicalise to digits.
const NUMBER_WORDS: Record<string, string> = {
  zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  'शून्य': '0', 'एक': '1', 'दो': '2', 'तीन': '3', 'चार': '4', 'पांच': '5', 'पाँच': '5', 'छह': '6', 'छः': '6', 'छे': '6', 'सात': '7', 'आठ': '8', 'नौ': '9', 'दस': '10',
};

/** Normalise one word for comparison. Returns '' for tokens that are only punctuation. */
export function normalizeWord(word: string, lang: Lang): string {
  let w = word.normalize('NFC').replace(ZW, '');
  w = w.replace(/[\p{P}\p{S}]/gu, ''); // punctuation incl. danda (।), quotes, dashes
  if (lang === 'en-IN') {
    w = w.toLowerCase();
  } else {
    w = w.split(NUKTA).join(''); // ज़ → ज, फ़ → फ (speakers and ASR vary)
    w = w.split(CHANDRABINDU).join(ANUSVARA); // हँस ≈ हंस
    // A nasal consonant + virama before another consonant is written either way: हिन्दी = हिंदी
    w = w.replace(new RegExp(`[ङञणनम]${VIRAMA}(?=[क-ह])`, 'g'), ANUSVARA);
    w = w.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
    // गये/गए, नयी/नई: the य-spelling of a final vowel is a common, equivalent variant.
    // Only after at least two code points, so the words ये and यी themselves are untouched.
    if ([...w].length > 2) w = w.replace(/ये$/, 'ए').replace(/यी$/, 'ई');
  }
  // Canonicalise number words after the script-specific rules (so पाँच → पांच → 5)
  const n = NUMBER_WORDS[w];
  return n ?? w;
}

/** Split a line or transcript into normalised words (empty tokens dropped). */
export function tokenize(text: string, lang: Lang): string[] {
  return text
    .normalize('NFC')
    .split(/[\s—–-]+/u) // whitespace and dashes separate words
    .map((t) => normalizeWord(t, lang))
    .filter((t) => t.length > 0);
}

const ASPIRATE: Record<string, string> = {
  'ख': 'क', 'घ': 'ग', 'छ': 'च', 'झ': 'ज', 'ठ': 'ट', 'ढ': 'ड', 'थ': 'त', 'ध': 'द', 'फ': 'प', 'भ': 'ब',
  'श': 'स', 'ष': 'स', 'ण': 'न', 'ङ': 'न', 'ञ': 'न', 'व': 'ब',
};

/**
 * A coarse sound key: two words with the same key sound alike to a non-expert ear.
 * Used only together with a small edit distance, never alone.
 */
export function phoneticKey(norm: string, lang: Lang): string {
  if (lang === 'en-IN') {
    let s = norm.replace(/ph/g, 'f').replace(/ck|q|c(?=[aou])|c$/g, 'k').replace(/c/g, 's').replace(/z/g, 's').replace(/x/g, 'ks');
    const first = s.charAt(0);
    s = first + s.slice(1).replace(/[aeiouyhw]/g, '');
    return s.replace(/(.)\1+/g, '$1');
  }
  // Devanagari: keep consonants (unaspirated), drop vowel signs, virama and nasal marks.
  let out = '';
  for (const ch of norm) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x0915 && cp <= 0x0939) out += ASPIRATE[ch] ?? ch; // consonants
    else if (cp >= 0x0904 && cp <= 0x0914 && out.length === 0) out += 'V'; // leading independent vowel
    else if (/[0-9]/.test(ch)) out += ch;
  }
  return out.replace(/(.)\1+/g, '$1');
}

/** Levenshtein distance over code points. */
export function editDistance(a: string, b: string): number {
  const A = [...a], B = [...b];
  if (A.length === 0) return B.length;
  if (B.length === 0) return A.length;
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j);
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[B.length];
}
