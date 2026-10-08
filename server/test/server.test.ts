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
  assert.deepEqual(await (await fetch(`${base}/api/config`)).json(), { mediaUrl: 'https://media.example', run: { runId: 'r1', leadMs: -339 }, readingMode: 'free', speech: { source: 'transcribe', simulated: false } });
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

test('config: a scripted (simulated) speech source and echo mode are announced to the TV and phone', async () => {
  const { server: srv } = createServer({ publicUrl: 'http://t:1', log: () => {}, s3ResultsDir: null, mediaUrl: async () => null, tvRun: async () => ({}), speechSource: 'scripted', readingModeOpt: 'echo' });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;
  const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
  assert.equal(cfg.readingMode, 'echo');
  assert.deepEqual(cfg.speech, { source: 'scripted', simulated: true });
  const shelf = await (await fetch(`http://127.0.0.1:${port}/api/stories`)).json();
  assert.ok(shelf.every((s: any) => !s.test), 'test content hidden from the shelf by default');
  srv.close();
});

test('config: the scripted simulation is refused in production', () => {
  const prev = process.env.NODE_ENV; process.env.NODE_ENV = 'production';
  try { assert.throws(() => createServer({ log: () => {}, s3ResultsDir: null, speechSource: 'scripted' }), /refused when NODE_ENV=production/); }
  finally { process.env.NODE_ENV = prev; }
});

test('operator endpoints need the admin token when ADMIN_TOKEN is set; public ones do not', async () => {
  const prev = process.env.ADMIN_TOKEN; process.env.ADMIN_TOKEN = 'secret-1';
  try {
    const { server: srv } = createServer({ publicUrl: 'http://t:1', log: () => {}, s3ResultsDir: null, mediaUrl: async () => null, tvRun: async () => ({}) });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const b = `http://127.0.0.1:${(srv.address() as any).port}`;
    assert.equal((await fetch(`${b}/api/sessions`)).status, 401);
    assert.equal((await fetch(`${b}/api/reading/traces`)).status, 401);
    assert.equal((await fetch(`${b}/api/usage`)).status, 401);
    assert.equal((await fetch(`${b}/api/usage`, { headers: { 'x-wordlight-admin': 'secret-1' } })).status, 200);
    const { sessionId } = await (await fetch(`${b}/api/sessions`, { method: 'POST' })).json();
    assert.ok(sessionId, 'the TV can still create a session');
    assert.equal((await fetch(`${b}/api/sessions/${sessionId}/privacy`)).status, 401);
    assert.equal((await (await fetch(`${b}/api/sessions/${sessionId}/privacy`, { headers: { 'x-wordlight-admin': 'secret-1' } })).json()).micAudit.violations.length, 0);
    assert.equal((await fetch(`${b}/api/config`)).status, 200);
    assert.equal((await fetch(`${b}/healthz`)).status, 200);
    srv.close();
  } finally { if (prev === undefined) delete process.env.ADMIN_TOKEN; else process.env.ADMIN_TOKEN = prev; }
});
