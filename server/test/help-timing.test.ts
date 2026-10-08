// Help timing in the real driver (no recogniser output at all, so only the clock and voice activity matter):
// sound from the phone keeps the clock waiting; after a help the clock waits for the TV's turn.help.done.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionHub } from '../src/hub.ts';
import { ReadingDriver } from '../src/reading/driver.ts';
import { VoiceActivity } from '../src/reading/vad.ts';
import type { SpeechSource } from '../src/reading/speech.ts';

const conn = () => { const out: any[] = []; return { out, send: (m: any) => out.push(m) }; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const deaf: SpeechSource = { name: 'deaf-test', simulated: true, open: () => ({ stats: { chunks: 0, bytes: 0, updates: 0 }, push() {}, end() {} }) };
const chunk = (amp: number) => { const p = new Int16Array(640); for (let i = 0; i < p.length; i++) p[i] = i % 2 ? amp : -amp; return p; };

test('voice activity: speech well above the room level counts, room noise does not', () => {
  const v = new VoiceActivity();
  for (let i = 0; i < 20; i++) assert.equal(v.push(chunk(80)), false, 'quiet room');
  assert.equal(v.push(chunk(2000)), true, 'voice');
  assert.equal(v.push(chunk(150)), false, 'below the 300 floor');
  const fresh = new VoiceActivity();
  assert.equal(fresh.push(chunk(3000)), true, 'speech in the very first chunk counts');
  const loud = new VoiceActivity();
  const judged: boolean[] = []; for (let i = 0; i < 150; i++) judged.push(loud.push(chunk(500))); // steady noisy room, 6 s
  assert.equal(judged.at(-1), false, 'a steady noisy room stops counting as speech');
  assert.ok(judged.indexOf(false) < 100, `within 4 s (chunk ${judged.indexOf(false)})`);
  assert.equal(loud.push(chunk(900)), false, 'not 3× above the noisy room');
  assert.equal(loud.push(chunk(3000)), true);
  assert.deepEqual(Object.keys(v.stats()), ['chunks', 'speechChunks', 'floorRms', 'maxRms']);
});

async function run(o: { tvReportsHelpDone: boolean }) {
  const t0 = performance.now(); const now = () => performance.timeOrigin + performance.now();
  const hub = new SessionHub({ now });
  const driver = new ReadingDriver({ hub, source: deaf, now, stallMs: 400, firstStallMs: 400, maxStallMs: 1500, helpPendingMaxMs: 900 });
  hub.driver = driver;
  const id = hub.createSession(); const tv = conn(), phone = conn();
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: id, clientId: 'tv' });
  hub.handle(phone, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p1' });
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r1', firstName: 'Riya', age: 7, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } });
  hub.handle(tv, { type: 'turn.start', turnId: 'T1', readerId: 'r1', storyId: 'demo', page: 0, line: 0, words: ['Can', 'you', 'see', 'me?'], lang: 'en-IN' });
  const s = hub.get(id)!; const tag = s.turn!.audioTag;
  const helps: { i: number; at: number }[] = [];
  let seq = 0; let helpDoneSent = 0;
  // script: 0–1000 ms the child keeps making sound (stutter), then silence
  while (performance.now() - t0 < 3500 && s.turn) {
    const at = performance.now() - t0;
    hub.audio(phone, { seq: seq++, tag, last: false, capturedAtMs: now(), pcm: chunk(at < 1000 ? 3000 : 60) });
    for (const m of tv.out.splice(0)) if (m.type === 'word.helped') {
      helps.push({ i: m.index, at: Math.round(at) });
      if (o.tvReportsHelpDone) setTimeout(() => { helpDoneSent++; hub.handle(tv, { type: 'turn.help.done', turnId: 'T1', index: m.index }); }, 200); // the clip plays 200 ms
    }
    await sleep(40);
  }
  return { helps, helpDoneSent, trace: driver.traces[0] ?? null, live: s.turn };
}

test('driver: no help while the child makes sound; after a help the clock restarts when the TV reports the word done', async () => {
  const r = await run({ tvReportsHelpDone: true });
  assert.ok(r.helps.length >= 2, JSON.stringify(r.helps));
  assert.ok(r.helps[0].at >= 1000 + 400 - 60, `first help only after the sound stopped + stall (got ${r.helps[0].at} ms)`);
  const gap = r.helps[1].at - r.helps[0].at;
  assert.ok(gap >= 200 + 400 - 60, `second help waits for the clip (200 ms) + stall (400 ms), got ${gap} ms`);
  assert.ok(r.helpDoneSent >= 1);
});

test('driver: an old TV that never reports help.done → the clock restarts after helpPendingMaxMs', async () => {
  const r = await run({ tvReportsHelpDone: false });
  assert.ok(r.helps.length >= 2, JSON.stringify(r.helps));
  const gap = r.helps[1].at - r.helps[0].at;
  assert.ok(gap >= 900 + 400 - 60, `pending max (900) + stall (400), got ${gap} ms`);
});
