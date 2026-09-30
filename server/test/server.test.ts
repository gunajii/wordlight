import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createServer, sanitizeTvRun } from '../src/index.ts';
import { encodeAudioFrame } from '@wordlight/shared-protocol';

const { server, hub } = createServer({ publicUrl: 'http://test.local:1', log: () => {}, heartbeat: { pingMs: 100, deadMs: 600 }, s3ResultsDir: null, mediaUrl: async () => 'https://media.example', tvRun: async () => ({ runId: 'r1', leadMs: -339 }) });
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${(server.address() as any).port}`;
after(() => new Promise<void>((r) => { server.closeAllConnections?.(); server.close(() => r()); }));
const waitFor = async (pred: () => boolean, ms = 3000) => { const t = Date.now(); while (!pred()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 10)); } };

test('http: session create, QR png, content with Range, TypeScript packages served as JS, 404s', async () => {
  const s = await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json();
  assert.match(s.sessionId, /^[A-Z2-9]{4}$/);
  const qr = new Uint8Array(await (await fetch(`${base}/api/sessions/${s.sessionId}/qr.png`)).arrayBuffer());
  assert.deepEqual([...qr.slice(1, 4)], [0x50, 0x4e, 0x47]);
  const ts = await fetch(`${base}/pkg/reading-engine/normalize.ts`);
  assert.equal(ts.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const js = await ts.text();
  assert.ok(js.includes('export function normalizeWord'));
  assert.ok(!/: Lang\)/.test(js), 'type annotations stripped');
  assert.equal((await fetch(`${base}/content/../package.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/sessions/ZZZZ`)).status, 404);
  assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { mediaUrl: 'https://media.example', run: { runId: 'r1', leadMs: -339 } });
});

test('ws: phone joins, saves a reader; binary audio reaches the driver only during a turn', async () => {
  const { sessionId } = await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json();
  const frames: number[] = [];
  hub.driver = { start() {}, audio: (_s, _t, f) => frames.push(f.seq), help() {}, stop() {} };
  const open = (role: string, clientId: string) => new Promise<WebSocket>((r) => { const w = new WebSocket(`${base.replace('http', 'ws')}/ws`); w.on('open', () => { w.send(JSON.stringify({ t: 'hello', role, sessionId, clientId })); r(w); }); });
  const tvMsgs: any[] = [];
  const tv = await open('tv', 'tv');
  tv.on('message', (d) => tvMsgs.push(JSON.parse(d.toString())));
  const phone = await open('phone', 'p1');
  phone.send(JSON.stringify({ type: 'reader.save', reader: { readerId: 'r1', firstName: 'Riya', age: 7, lang: 'hi-IN' }, consent: { microphone: true, atMs: Date.now() } }));
  await waitFor(() => tvMsgs.some((m) => m.t === 'readers'));
  phone.send(encodeAudioFrame({ seq: 1, last: false, capturedAtMs: 0, pcm: new Int16Array(160) })); // no turn yet: ignored
  tv.send(JSON.stringify({ type: 'turn.start', turnId: 'T', readerId: 'r1', storyId: 's', page: 0, line: 0, words: ['a', 'b', 'c'], lang: 'en-IN' }));
  await waitFor(() => hub.get(sessionId)!.turn !== null);
  phone.send(encodeAudioFrame({ seq: 2, tag: hub.get(sessionId)!.turn!.audioTag, last: false, capturedAtMs: 0, pcm: new Int16Array(160) }));
  await waitFor(() => frames.length > 0);
  assert.deepEqual(frames, [2]);
  hub.endActiveTurn(hub.get(sessionId)!, 'exit');
  hub.driver = null;
  tv.close(); phone.close();
});

test('heartbeat: a silent connection that answers no pings is dropped as timeout', async () => {
  const { sessionId } = await (await fetch(`${base}/api/sessions`, { method: 'POST' })).json();
  const w = new WebSocket(`${base.replace('http', 'ws')}/ws`, { autoPong: false });
  await new Promise((r) => w.on('open', r));
  w.send(JSON.stringify({ t: 'hello', role: 'phone', sessionId, clientId: 'mute' }));
  await waitFor(() => hub.get(sessionId)!.telemetry.some((r) => r.kind === 'leave' && r.reason === 'timeout'), 3000);
  w.terminate();
});

test('dev run control: only well-formed fields pass', () => {
  assert.deepEqual(sanitizeTvRun({ runId: 'cal-m4a:1', audioFile: 'p1.m4a', leadMs: -339, autorun: true }), { runId: 'cal-m4a:1', audioFile: 'p1.m4a', leadMs: -339, autorun: true });
  assert.deepEqual(sanitizeTvRun({ runId: 'x y', audioFile: '../../etc/passwd', leadMs: 1e9, autorun: 'yes' }), {});
});
