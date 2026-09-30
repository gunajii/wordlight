// Synthetic phone for testing the S3 pipeline without a browser: joins a session over WebSocket, gives consent,
// keeps an NTP-style clock estimate, reports mic status, and on turn.start streams 16 kHz PCM16 chunks of a
// synthetic signal (quiet noise + a 1 kHz tone every 3 s) in real time until turn.cancel. No microphone, no voice.
//   node tools/s3/fake-phone.ts <SESSION> [--url ws://localhost:8787/ws] [--clock-skew-ms 123456] [--jitter-ms 30]
import WebSocket from 'ws';
import { encodeAudioFrame } from '@wordlight/shared-protocol';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const sid = args[0];
const url = opt('url', 'ws://localhost:8787/ws');
const skew = Number(opt('clock-skew-ms', '123456')); // phone clock = real − skew
const jitter = Number(opt('jitter-ms', '0'));
const phoneNow = () => performance.now() - skew;
const ws = new WebSocket(url);
const clientId = 'fake-' + Math.random().toString(36).slice(2, 7);
let best = { rtt: Infinity, offset: 0 };
let turn: { turnId: string; tag: number; chunkMs: number } | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let seq = 0, sampleIdx = 0, micLive = 0;
const send = (m: unknown) => ws.readyState === 1 && ws.send(JSON.stringify(m));

ws.on('open', () => {
  send({ t: 'hello', role: 'phone', sessionId: sid, clientId });
  send({ type: 'reader.save', reader: { readerId: 'rd-fake', firstName: 'Fake', age: 8, lang: 'en-IN' }, consent: { microphone: true, atMs: Date.now() } });
  setInterval(() => send({ t: 'ping', id: 1, c0: phoneNow() }), 250);
  setInterval(() => send({ t: 'phone.status', micLive, turnId: turn?.turnId ?? null, ctx: 'running', visible: 'visible' }), 1000);
  setInterval(() => { if (best.rtt < Infinity) send({ t: 'clock.report', offsetMs: best.offset, minRttMs: best.rtt }); }, 2000);
});
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.t === 'pong') { const c1 = phoneNow(), rtt = c1 - m.c0; if (rtt < best.rtt) best = { rtt, offset: m.s - (m.c0 + c1) / 2 }; }
  if (m.type === 'turn.start') {
    turn = { turnId: m.turnId, tag: m.audioTag, chunkMs: m.chunkMs ?? 40 }; seq = 0; micLive = 1;
    const n = turn.chunkMs * 16;
    const t = turn;
    timer = setInterval(() => {
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++, sampleIdx++) {
        const inTone = sampleIdx % 48000 < 480;
        pcm[i] = Math.round((Math.random() - 0.5) * 200 + (inTone ? 8000 * Math.sin((2 * Math.PI * 1000 * sampleIdx) / 16000) : 0));
      }
      const frame = encodeAudioFrame({ seq: seq++, tag: t.tag, last: false, capturedAtMs: phoneNow() - turn!.chunkMs, pcm });
      setTimeout(() => ws.readyState === 1 && ws.send(frame), Math.random() * jitter);
    }, turn.chunkMs);
    console.log(`turn ${m.turnId} chunk ${turn.chunkMs} ms`);
  }
  if ((m.type === 'turn.cancel' || m.type === 'line.done') && turn && m.turnId === turn.turnId) {
    if (timer) clearInterval(timer); timer = null; turn = null; micLive = 0;
    console.log(`turn ended: ${m.reason ?? 'done'}`);
  }
});
ws.on('close', () => { console.log('socket closed'); process.exit(0); });
