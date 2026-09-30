import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnStats, ClickDetector, dist } from '../src/s3/stats.ts';
import { S3Sink } from '../src/s3/sink.ts';
import { SessionHub, MIC_GRACE_MS } from '../src/hub.ts';

const pcm = (n: number) => new Int16Array(n);

test('stats: sequence accounting — missing, duplicate, out-of-order', () => {
  const st = new TurnStats({ turnId: 't', chunkMs: 20, startedAtServerMs: 0 });
  for (const seq of [0, 1, 3, 3, 2, 5]) st.frame({ seq, capturedAtMs: seq * 20, pcm: pcm(320) }, 100 + seq * 20);
  const s = st.summary(1000, 'exit');
  assert.equal(s.frames, 5); // 0,1,3,2,5 (one duplicate 3)
  assert.equal(s.duplicates, 1);
  assert.equal(s.outOfOrder, 1); // 2 arrived after 3
  assert.equal(s.missing, 1); // 4 never came
  assert.deepEqual(s.gaps.map((g) => [g.fromSeq, g.toSeq]), [[2, 2], [4, 4]]);
});

test('stats: latency uses the phone clock offset; transport = first-sample latency − chunk duration', () => {
  const st = new TurnStats({ turnId: 't', chunkMs: 40, startedAtServerMs: 0 });
  // phone clock = server − 5000; first sample captured at phone 1000 (= server 6000); received at server 6100
  const clock = { offsetMs: 5000, minRttMs: 30, atServerMs: 6000 };
  st.frame({ seq: 0, capturedAtMs: 1000, pcm: pcm(640) }, 6100, clock);
  st.frame({ seq: 1, capturedAtMs: 1040, pcm: pcm(640) }, 6150, clock);
  const s = st.summary(7000, 'exit');
  assert.equal(s.latencyFirstSampleMs!.n, 2);
  assert.equal(s.latencyFirstSampleMs!.min, 100);
  assert.equal(s.latencyFirstSampleMs!.max, 110);
  assert.equal(s.latencyTransportMs!.min, 60);
  assert.equal(s.captureGaps.count, 0);
});

test('stats: no latency is reported without a clock estimate (never a raw client timestamp)', () => {
  const st = new TurnStats({ turnId: 't', chunkMs: 40, startedAtServerMs: 0 });
  st.frame({ seq: 0, capturedAtMs: 1000, pcm: pcm(640) }, 6100);
  assert.equal(st.summary(7000, 'exit').latencyFirstSampleMs, null);
});

test('stats: capture gaps on the phone timeline are detected', () => {
  const st = new TurnStats({ turnId: 't', chunkMs: 20, startedAtServerMs: 0 });
  st.frame({ seq: 0, capturedAtMs: 0, pcm: pcm(320) }, 50);
  st.frame({ seq: 1, capturedAtMs: 20, pcm: pcm(320) }, 70);
  st.frame({ seq: 2, capturedAtMs: 540, pcm: pcm(320) }, 600); // 500 ms of audio never produced (e.g. iOS suspended)
  const s = st.summary(700, 'exit');
  assert.equal(s.captureGaps.count, 1);
  assert.equal(s.captureGaps.maxMs, 500);
});

test('click detector: finds 1 kHz tone onsets to within 10 ms, ignores noise', () => {
  const d = new ClickDetector();
  const sr = 16000, total = sr * 3, x = new Int16Array(total);
  let seed = 1; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) - 0.5;
  const onsets = [8000, 24000, 40000]; // 0.5 s, 1.5 s, 2.5 s
  for (let i = 0; i < total; i++) {
    let v = rnd() * 0.004; // quiet room noise
    for (const o of onsets) if (i >= o && i < o + 800) v += 0.2 * Math.sin((2 * Math.PI * 1000 * (i - o)) / sr);
    x[i] = Math.round(v * 32767);
  }
  const found: number[] = [];
  for (let i = 0; i < total; i += 640) found.push(...d.push(x.subarray(i, i + 640), i).map((o) => o.idx)); // 40 ms chunks
  assert.equal(found.length, 3);
  found.forEach((f, k) => assert.ok(Math.abs(f - onsets[k]) <= 160, `onset ${k}: ${f} vs ${onsets[k]}`));
});

test('dist: percentiles', () => {
  assert.deepEqual(dist([5, 1, 3, 2, 4]), { n: 5, median: 3, p95: 5, max: 5, min: 1, mean: 3, sd: 1.6 });
  assert.equal(dist([]), null);
});

// ---- hub: test turns, audio tags, cap, privacy audit ----
const conn = () => { const out: any[] = []; return { out, send: (m: any) => out.push(m) }; };
function testSession() {
  let t = 1000; const now = () => t;
  const hub = new SessionHub({ now });
  const sink = new S3Sink({ now });
  hub.driver = sink;
  const id = hub.createSession({ testMode: true });
  const phone = conn();
  hub.handle(phone, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p1' });
  return { hub, sink, id, phone, s: hub.get(id)!, tick: (ms: number) => (t += ms) };
}

test('S3 test turn: refused before consent; after consent the phone gets turn.start with tag + chunk; end → turn.cancel', () => {
  const { hub, id, phone, s, sink, tick } = testSession();
  assert.deepEqual(hub.startTestTurn(s, 'p1'), { ok: false, error: 'no-consented-reader' });
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r', firstName: 'Test', age: 8, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } });
  const r = hub.startTestTurn(s, 'p1', { chunkMs: 20, durationMs: 5000 });
  assert.ok(r.ok);
  const ts = phone.out.find((m) => m.type === 'turn.start');
  assert.equal(ts.chunkMs, 20);
  assert.ok(ts.audioTag >= 1);
  hub.handle(phone, { t: 'clock.report', offsetMs: 0, minRttMs: 10 });
  tick(100);
  hub.audio(phone, { seq: 0, tag: ts.audioTag, last: false, capturedAtMs: 1080, pcm: pcm(320) });
  hub.endActiveTurn(s, 'exit');
  assert.equal(phone.out.at(-1).type, 'turn.cancel');
  const res = sink.results.get(id)!;
  assert.equal(res.length, 1);
  assert.equal(res[0].frames, 1);
  assert.equal(res[0].latencyFirstSampleMs!.median, 20); // 1100 − 1080
  assert.ok(!JSON.stringify(res).includes('pcm'), 'results hold numbers only, never samples');
  // chunk size outside the tested set falls back to 40
  hub.startTestTurn(s, 'p1', { chunkMs: 7 });
  assert.equal(phone.out.filter((m) => m.type === 'turn.start').at(-1).chunkMs, 40);
});

test('S3 test turn: a normal session refuses test turns', () => {
  const hub = new SessionHub({ now: () => 0 });
  const id = hub.createSession();
  assert.deepEqual(hub.startTestTurn(hub.get(id)!, 'x'), { ok: false, error: 'not-a-test-session' });
});

test('privacy audit: a live mic outside a turn (after the grace period) is a violation; inside a turn it is not', () => {
  const { hub, phone, s, tick } = testSession();
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r', firstName: 'Test', age: 8, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } });
  hub.handle(phone, { t: 'phone.status', micLive: 0, turnId: null });
  hub.startTestTurn(s, 'p1');
  hub.handle(phone, { t: 'phone.status', micLive: 1, turnId: s.turn!.turn.turnId });
  hub.endActiveTurn(s, 'exit');
  tick(500);
  hub.handle(phone, { t: 'phone.status', micLive: 1, turnId: null }); // still closing, within grace
  assert.equal(s.micAudit.violations.length, 0);
  tick(MIC_GRACE_MS + 1);
  hub.handle(phone, { t: 'phone.status', micLive: 1, turnId: null });
  assert.equal(s.micAudit.violations.length, 1);
  assert.equal(s.micAudit.liveDuringTurnReports, 1);
});

test('turn cap: a turn nobody ends is closed by the server (privacy cap)', async () => {
  const { hub, phone, s } = testSession();
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r', firstName: 'Test', age: 8, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } });
  hub.startTestTurn(s, 'p1', { durationMs: 1000 }); // minimum cap is 1 s
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(s.turn, null);
  assert.equal(phone.out.at(-1).reason, 'timeout');
});

test('phone may request / end its own test turn over the socket', () => {
  const { hub, phone, s } = testSession();
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r', firstName: 'Test', age: 8, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } });
  hub.handle(phone, { t: 's3.turn', action: 'start', chunkMs: 60, durationMs: 3000 });
  assert.equal(s.turn!.chunkMs, 60);
  hub.handle(phone, { t: 's3.turn', action: 'end' });
  assert.equal(s.turn, null);
});

test('reconnect during a turn: the turn ends (phone-lost) and is never resumed blindly', () => {
  const { hub, id, s } = testSession();
  const phone = conn();
  hub.handle(phone, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p1' });
  hub.handle(phone, { type: 'reader.save', reader: { readerId: 'r', firstName: 'Test', age: 8, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } });
  hub.startTestTurn(s, 'p1');
  const again = conn(); // new socket, same phone, before the server noticed the old one died
  hub.handle(again, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p1' });
  assert.equal(s.turn, null);
  assert.equal(again.out.at(-1).type, 'turn.cancel');
  assert.equal(again.out.at(-1).reason, 'phone-lost');
});
