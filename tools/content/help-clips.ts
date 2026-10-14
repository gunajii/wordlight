// Help clips: a turn word spoken alone and slowly (Polly neural, 80 %). The TV plays the clip when it helps with a
// word, instead of seeking in the page audio (on the VVD seeking let the rest of the line play).
import { writeFileSync } from 'node:fs';
import path from 'node:path';

export const clipKey = (w: string) => w.normalize('NFC').replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '').toLowerCase();
type W = { w: string; clip?: string };
type Pages = { lines: { words: W[] }[] }[];
export interface WordVoice { wordClip(w: string, lang: 'hi-IN' | 'en-IN' | 'mr-IN'): Promise<Uint8Array> }

/** Every word of the given lines gets a clip (h<N>.mp3 in outDir). A word that already has a clip anywhere in the story
 *  reuses it; existing clips and their names are never touched. Returns how many clips were made. */
export async function addHelpClips(pages: Pages, refs: { page: number; line: number }[], voice: WordVoice, outDir: string, lang: 'hi-IN' | 'en-IN' | 'mr-IN'): Promise<number> {
  const have = new Map<string, string>(); let max = 0;
  for (const p of pages) for (const l of p.lines) for (const w of l.words) if (w.clip) {
    const k = clipKey(w.w); if (k && !have.has(k)) have.set(k, w.clip);
    const m = /^h(\d+)\.mp3$/.exec(w.clip); if (m) max = Math.max(max, Number(m[1]));
  }
  let made = 0;
  for (const r of refs) for (const w of pages[r.page].lines[r.line].words) {
    const k = clipKey(w.w); if (!k) continue;
    if (!have.has(k)) { const file = `h${++max}.mp3`; writeFileSync(path.join(outDir, file), await voice.wordClip(w.w, lang)); have.set(k, file); made++; }
    w.clip = have.get(k);
  }
  return made;
}
