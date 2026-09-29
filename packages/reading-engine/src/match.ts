import { editDistance, phoneticKey, type Lang } from './normalize.ts';

export interface MatchPolicy {
  /** Expected words with at most this many code points must match exactly (after normalisation). */
  exactUpTo: number;
  /** Longer words may differ by 1 edit (2 edits from `twoEditsFrom` code points) if they sound alike. */
  twoEditsFrom: number;
}

// Deliberately strict. Fuzziness exists only to absorb ASR spelling noise on longer words
// (elephant/elefant, rabbit/rabit). A different word — including any vowel change such as
// big/bag, lived/loved, कल/काल, बिल्ली/बल्ली — must never light up. The price: colour/color is
// rejected too. Tune with S2 data; the misread tests must keep passing.
export const DEFAULT_MATCH_POLICY: MatchPolicy = { exactUpTo: 4, twoEditsFrom: 8 };

const EN_VOWELS = new Set('aeiou');
const isHiVowel = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  return (cp >= 0x0904 && cp <= 0x0914) || (cp >= 0x093e && cp <= 0x094c); // independent vowels, vowel signs
};

/**
 * True if a and b are one edit apart and that edit changes a vowel: a vowel swapped for another
 * (big/bag, किताबें/किताबों) or a vowel added/dropped (बिल्ली/बल्ली). Vowels carry meaning.
 */
function isVowelEdit(a: string, b: string, lang: Lang): boolean {
  const vowel = (c: string) => (lang === 'en-IN' ? EN_VOWELS.has(c) : isHiVowel(c));
  const A = [...a], B = [...b];
  if (A.length === B.length) {
    const diff = A.map((c, i) => [c, B[i]]).filter(([x, y]) => x !== y);
    return diff.length === 1 && vowel(diff[0][0]) && vowel(diff[0][1]);
  }
  const [L, S] = A.length > B.length ? [A, B] : [B, A];
  if (L.length - S.length !== 1) return false;
  for (let i = 0; i < L.length; i++) {
    if (L.slice(0, i).join('') + L.slice(i + 1).join('') === S.join('')) return vowel(L[i]);
  }
  return false;
}

/**
 * Similarity in (0,1] if `heard` counts as reading `expected`, else 0.
 * Both arguments must already be normalised with normalizeWord / tokenize.
 */
export function wordScore(expected: string, heard: string, lang: Lang, p: MatchPolicy = DEFAULT_MATCH_POLICY): number {
  if (!expected || !heard) return 0;
  if (expected === heard) return 1;
  const lenE = [...expected].length;
  if (lenE <= p.exactUpTo) return 0;
  const d = editDistance(expected, heard);
  const maxEdits = lenE >= p.twoEditsFrom ? 2 : 1;
  if (d > maxEdits) return 0;
  if (phoneticKey(expected, lang) !== phoneticKey(heard, lang)) return 0;
  if (d === 1 && isVowelEdit(expected, heard, lang)) return 0;
  return 1 - d / Math.max(lenE, [...heard].length);
}
