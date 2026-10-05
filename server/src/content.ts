// Story packages on disk: parse, validate (schema + timings + credits + language) and check every referenced file.
// The server lists only packages that pass, so a bad package fails here — loudly — before it reaches the TV.
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { validateStory, type Issue, type StoryPackage } from '@wordlight/story-package';

export interface Checked { id: string; dir: string; story: StoryPackage | null; issues: Issue[]; ok: boolean; test: boolean }

export async function checkStoryDir(dir: string): Promise<Checked> {
  const id = path.basename(dir);
  const issues: Issue[] = [];
  let story: StoryPackage | null = null;
  try { story = JSON.parse(await readFile(path.join(dir, 'story.json'), 'utf8')); }
  catch (e: any) { return { id, dir, story: null, issues: [{ level: 'error', path: 'story.json', message: `cannot read/parse: ${e?.message ?? e}` }], ok: false, test: false }; }
  if (!story || typeof story !== 'object' || !Array.isArray(story.pages)) return { id, dir, story: null, issues: [{ level: 'error', path: 'story.json', message: 'not a story package (no pages)' }], ok: false, test: false };
  try { issues.push(...validateStory(story)); } catch (e: any) { issues.push({ level: 'error', path: 'story.json', message: `malformed: ${e?.message ?? e}` }); }
  if (story.id !== id) issues.push({ level: 'error', path: 'id', message: `id "${story.id}" does not match its folder "${id}"` });
  const files = new Set<string>();
  story.pages.forEach((p) => { files.add(p?.image); files.add(p?.audio); p?.lines?.forEach((l) => l?.words?.forEach((w) => w?.clip && files.add(w.clip))); });
  for (const f of files) {
    if (!f || typeof f !== 'string' || f.includes('/') || f.includes('..')) continue; // reported by validateStory
    try { const st = await stat(path.join(dir, f)); if (!st.isFile() || st.size === 0) issues.push({ level: 'error', path: f, message: 'empty or not a file' }); }
    catch { issues.push({ level: 'error', path: f, message: 'missing asset (narration/image not built?)' }); }
  }
  const test = story.timing?.source === 'synthetic' || story.voice?.engine === 'synthetic-clicks';
  return { id, dir, story, issues, ok: !issues.some((i) => i.level === 'error'), test };
}

export async function checkAllStories(root: string): Promise<Checked[]> {
  const ids = (await readdir(root).catch(() => [] as string[])).sort();
  const out: Checked[] = [];
  for (const id of ids) {
    const d = path.join(root, id);
    try { if (!(await stat(d)).isDirectory()) continue; } catch { continue; }
    out.push(await checkStoryDir(d));
  }
  return out;
}
