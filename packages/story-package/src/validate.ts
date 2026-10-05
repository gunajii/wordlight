import { PACKAGE_VERSION, type StoryPackage } from './schema.ts';

export interface Issue { level: 'error' | 'warning'; path: string; message: string }

const LICENSES = ['CC BY 4.0', 'CC BY-SA 4.0', 'CC0', 'original'];
const ENGINES = ['polly-neural', 'polly-standard', 'synthetic-clicks', 'recorded'];
const TIMINGS = ['polly-speech-marks', 'transcribe', 'synthetic', 'manual'];
/** Turn lines outside this range are refused (3–8 is the recommended range, warned). */
export const TURN_WORDS_HARD = { min: 2, max: 12 };

/** Problems in Devanagari text that break display or matching: stray combining marks, zero-width chars, non-NFC. */
export function hindiTextProblems(text: string): string[] {
  const out: string[] = [];
  if (text !== text.normalize('NFC')) out.push('not NFC-normalised');
  if (/[\u200B-\u200D\uFEFF]/.test(text)) out.push('zero-width character');
  for (const tok of text.split(/\s+/)) {
    if (/^[\u0900-\u0903\u093A-\u094F\u0951-\u0957\u0962\u0963]/u.test(tok.replace(/^[\p{P}\p{S}]+/u, ''))) out.push(`“${tok}” starts with a combining mark`);
  }
  if (!/[\u0900-\u097F]/.test(text)) out.push('no Devanagari');
  return out;
}
const SAFE_FILE = /^[A-Za-z0-9._-]+\.(webp|png|jpg|mp3|m4a)$/;

/** Validate a story package. Errors make it unusable; warnings are shown by the pipeline. */
export function validateStory(s: StoryPackage): Issue[] {
  const out: Issue[] = [];
  const err = (path: string, message: string) => out.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => out.push({ level: 'warning', path, message });
  if (s.packageVersion !== PACKAGE_VERSION) err('packageVersion', `expected ${PACKAGE_VERSION}`);
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(s.id ?? '')) err('id', 'lowercase letters, digits, dashes (3–64)');
  if (s.lang !== 'hi-IN' && s.lang !== 'en-IN') err('lang', 'unsupported language (hi-IN or en-IN)');
  if (!s.title || typeof s.title !== 'string') err('title', 'required');
  if (!Number.isInteger(s.level) || s.level < 1 || s.level > 4) err('level', 'integer 1–4');
  if (!s.voice || !ENGINES.includes(s.voice.engine) || !s.voice.id) err('voice', `engine one of ${ENGINES.join(', ')} and an id`);
  if (!s.timing || !TIMINGS.includes(s.timing.source) || typeof s.timing.verified !== 'boolean') err('timing', `source one of ${TIMINGS.join(', ')}, verified boolean`);
  const c = s.credits;
  if (!c) err('credits', 'required');
  else {
    if (!LICENSES.includes(c.license)) err('credits.license', `must be one of ${LICENSES.join(', ')}`);
    for (const f of ['source', 'title', 'author', 'attribution'] as const) if (!c[f]) err(`credits.${f}`, 'required');
    if (c.source !== 'WordLight test content' && !c.url) err('credits.url', 'required for third-party content');
    if (c.license === 'CC BY-SA 4.0') warn('credits.license', 'ShareAlike: derived story files must be shared under CC BY-SA 4.0');
  }
  if (!s.pages?.length) err('pages', 'at least one page');
  let turns = 0;
  s.pages?.forEach((p, pi) => {
    const at = `pages[${pi}]`;
    if (!SAFE_FILE.test(p.image ?? '')) err(`${at}.image`, 'plain file name (.webp/.png/.jpg)');
    if (!SAFE_FILE.test(p.audio ?? '')) err(`${at}.audio`, 'plain file name (.mp3/.m4a)');
    if (!(p.durationMs > 0)) err(`${at}.durationMs`, 'must be > 0');
    let prev = -1;
    p.lines?.forEach((l, li) => {
      const la = `${at}.lines[${li}]`;
      if (!l.words?.length) return err(`${la}.words`, 'every line needs timed words');
      if (typeof l.text !== 'string' || l.words.map((w) => w.w).join(' ') !== l.text.trim().split(/\s+/).join(' ')) err(`${la}.text`, 'words must spell the text');
      if (s.lang === 'hi-IN') for (const prob of hindiTextProblems(l.text ?? '')) err(`${la}.text`, `malformed Hindi text: ${prob}`);
      let prevEnd = -1;
      l.words.forEach((w, wi) => {
        if (!(typeof w.t0 === 'number' && typeof w.t1 === 'number' && w.t0 >= 0 && w.t1 > w.t0)) err(`${la}.words[${wi}]`, `bad span ${w.t0}..${w.t1}`);
        if (w.t0 < prev) err(`${la}.words[${wi}]`, 'starts before the previous word');
        if (w.t0 < prevEnd - 1) err(`${la}.words[${wi}]`, `overlaps the previous word (${w.t0} < ${prevEnd})`);
        if (w.t1 > p.durationMs + 50) err(`${la}.words[${wi}]`, 'ends after the page audio');
        if (w.clip !== undefined && !SAFE_FILE.test(w.clip)) err(`${la}.words[${wi}].clip`, 'plain audio file name');
        prev = w.t0; prevEnd = w.t1;
      });
      if (l.turn) {
        turns++;
        if (l.words.length < TURN_WORDS_HARD.min || l.words.length > TURN_WORDS_HARD.max) err(la, `turn line has ${l.words.length} words (${TURN_WORDS_HARD.min}–${TURN_WORDS_HARD.max} allowed)`);
        else if (l.words.length < 3 || l.words.length > 8) warn(la, `turn line has ${l.words.length} words (3–8 recommended)`);
      }
    });
  });
  if (turns === 0) warn('pages', 'no "your turn" lines');
  if (s.voice?.engine === 'synthetic-clicks' || s.timing?.source === 'synthetic') warn('voice', 'test narration (synthetic tones), not a voice: hidden from the shelf unless test content is shown');
  if (!s.timing?.verified && s.timing?.source !== 'synthetic') warn('timing.verified', 'word timings not yet verified against the audio (spike S4)');
  return out;
}
