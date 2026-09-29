import { PACKAGE_VERSION, type StoryPackage } from './schema.ts';

export interface Issue { level: 'error' | 'warning'; path: string; message: string }

const LICENSES = ['CC BY 4.0', 'CC BY-SA 4.0', 'CC0', 'original'];
const SAFE_FILE = /^[A-Za-z0-9._-]+\.(webp|png|jpg|mp3|m4a)$/;

/** Validate a story package. Errors make it unusable; warnings are shown by the pipeline. */
export function validateStory(s: StoryPackage): Issue[] {
  const out: Issue[] = [];
  const err = (path: string, message: string) => out.push({ level: 'error', path, message });
  const warn = (path: string, message: string) => out.push({ level: 'warning', path, message });
  if (s.packageVersion !== PACKAGE_VERSION) err('packageVersion', `expected ${PACKAGE_VERSION}`);
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(s.id ?? '')) err('id', 'lowercase letters, digits, dashes (3–64)');
  if (s.lang !== 'hi-IN' && s.lang !== 'en-IN') err('lang', 'hi-IN or en-IN');
  if (!s.title) err('title', 'required');
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
      if (l.words.map((w) => w.w).join(' ') !== l.text.trim().split(/\s+/).join(' ')) err(`${la}.text`, 'words must spell the text');
      l.words.forEach((w, wi) => {
        if (!(w.t0 >= 0 && w.t1 > w.t0)) err(`${la}.words[${wi}]`, `bad span ${w.t0}..${w.t1}`);
        if (w.t0 < prev) err(`${la}.words[${wi}]`, 'starts before the previous word');
        if (w.t1 > p.durationMs + 50) err(`${la}.words[${wi}]`, 'ends after the page audio');
        prev = w.t0;
      });
      if (l.turn) {
        turns++;
        if (l.words.length < 3 || l.words.length > 8) warn(la, `turn line has ${l.words.length} words (3–8 recommended)`);
      }
    });
  });
  if (turns === 0) warn('pages', 'no "your turn" lines');
  if (!s.timing?.verified) warn('timing.verified', 'word timings not yet verified against the audio (spike S4)');
  return out;
}
