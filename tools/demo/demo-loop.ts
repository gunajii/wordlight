// Headless LOCAL SIMULATION of the whole product loop (no AWS, no TV, no phone): server with the scripted speech
// source → a TV stand-in that walks the story exactly as the TV app does (tv-core nextTurn/resumeAt over story.json,
// sending turn.start, help on stall, session.end) → the fake reader → reading engine → word events → summary.
// It prints a timeline and checks: words light, one word is helped (amber) on the stall, every turn ends with the
// mic closed, the summary carries the real counts, and the run is labelled SIMULATED.
//   node tools/demo/demo-loop.ts [--story wl-test-kite] [--script demo] [--mode free|echo]
import WebSocket from 'ws';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../../server/src/index.ts';
import { nextTurn, totals } from '../../packages/tv-core/src/index.ts';
import { startFakeReader } from './fake-reader.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function demoLoop(o: { story?: string; script?: string; mode?: 'free' | 'echo'; log?: (m: string) => void } = {}) {
  const log = o.log ?? console.log;
  process.env.SPEECH_SCRIPT = o.script ?? 'demo';
  const { server } = createServer({ publicUrl: 'http://127.0.0.1:0', log: () => {}, s3ResultsDir: null, mediaUrl: async () => null, tvRun: async () => ({}), speechSource: 'scripted', readingModeOpt: o.mode ?? 'free' });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  const T0 = Date.now(); const at = () => `${((Date.now() - T0) / 1000).toFixed(1).padStart(5)}s`;
  const cfg = await (await fetch(`${base}/api/config`)).json();
  const story = JSON.parse(readFileSync(path.join(ROOT, 'content/stories', o.story ?? 'wl-test-kite', 'story.json'), 'utf8'));
  log(`${at()} config: speech=${cfg.speech.source} simulated=${cfg.speech.simulated} mode=${cfg.readingMode} · story “${story.title}”`);
  const { sessionId } = await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json();
  const tv = new WebSocket(base.replace('http', 'ws') + '/ws');
  const tvMsgs: any[] = [];
  await new Promise((r) => tv.once('open', r));
  tv.send(JSON.stringify({ t: 'hello', role: 'tv', sessionId, clientId: 'tv-demo' }));
  tv.on('message', (d) => tvMsgs.push(JSON.parse(d.toString())));
  const reader = await startFakeReader({ url: base, session: sessionId, lang: story.lang, log: (m) => log(`${at()} phone  ${m}`) });
  await new Promise((r) => setTimeout(r, 300));
  const readerId = tvMsgs.filter((m) => m.t === 'readers').at(-1)?.readers?.[0]?.readerId;
  const results: { read: number; helped: number; skipped: number }[] = [];
  for (let pi = 0; pi < story.pages.length; pi++) {
    const page = story.pages[pi]; const done = new Set<number>(); let pos = 0;
    for (;;) {
      const nt = nextTurn(page, pos, done, cfg.readingMode);
      if (!nt) break;
      const line = page.lines[nt.index];
      log(`${at()} TV     page ${pi + 1}: narration stops at ${nt.stopAtMs} ms → “${line.text}” is ${story.lang === 'hi-IN' ? '' : ''}Riya's turn`);
      const turnId = `${story.id}-${pi}-${nt.index}`;
      const before = tvMsgs.length;
      tv.send(JSON.stringify({ type: 'turn.start', turnId, readerId, storyId: story.id, page: pi, line: nt.index, words: line.words.map((w: any) => w.w), lang: story.lang, mode: cfg.readingMode }));
      for (let i = 0; i < 300 && !tvMsgs.slice(before).some((m) => (m.type === 'line.done' || m.type === 'turn.cancel') && m.turnId === turnId); i++) await new Promise((r) => setTimeout(r, 50));
      const evs = tvMsgs.slice(before).filter((m) => m.turnId === turnId && ['mic.state', 'word.read', 'word.helped', 'word.skipped', 'line.done', 'turn.cancel'].includes(m.type));
      log(`${at()} TV     ${evs.map((m) => m.type === 'mic.state' ? `mic:${m.state}` : m.type === 'line.done' ? `line.done(${m.read} read, ${m.helped} helped)` : `${m.type.split('.')[1]}:${line.words[m.index]?.w}`).join(' · ')}`);
      const ld = evs.find((m) => m.type === 'line.done'); if (ld) results.push(ld);
      done.add(nt.index); pos = nt.stopAtMs + 1;
    }
  }
  const before = tvMsgs.length;
  tv.send(JSON.stringify({ t: 'session.end', storyId: story.id, storyTitle: story.title, completed: true, durationMs: Date.now() - T0 }));
  for (let i = 0; i < 40 && !tvMsgs.slice(before).some((m) => m.type === 'session.summary'); i++) await new Promise((r) => setTimeout(r, 50));
  const summary = tvMsgs.find((m) => m.type === 'session.summary');
  const t = totals(results);
  log(`${at()} TV     end card: ${t.onOwn} on your own · ${t.withHelp} with a little help · ${t.turns} turns`);
  log(`${at()} parent “${summary?.text}” (${summary?.source})`);
  const micClosedEveryTurn = results.length > 0 && [...new Set(reader.micLog.map((x) => x.turnId))].every((id) => reader.micLog.filter((x) => x.turnId === id).at(-1)?.state === 'closed');
  const traces = await (await fetch(`${base}/api/reading/traces?session=${sessionId}`)).json();
  reader.close(); tv.close(); server.close();
  return { results, totals: t, summary, micClosedEveryTurn, simulated: cfg.speech.simulated && traces.every((x: any) => x.simulated), helped: t.withHelp };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2); const opt = (k: string) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : undefined);
  console.log('LOCAL SIMULATION — scripted speech, not real speech recognition.\n');
  demoLoop({ story: opt('story'), script: opt('script'), mode: opt('mode') as any }).then((r) => {
    const checks = { 'words lit': r.totals.onOwn > 0, 'stall helped (amber)': r.helped > 0, 'mic closed after every turn': r.micClosedEveryTurn, 'summary has the real counts': !!r.summary?.text.includes(`${r.totals.onOwn} words`), 'labelled SIMULATED': r.simulated };
    console.log('\n' + Object.entries(checks).map(([k, v]) => `${v ? 'PASS' : 'FAIL'}  ${k}`).join('\n'));
    process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
  }).catch((e) => { console.error(e); process.exit(1); });
}
