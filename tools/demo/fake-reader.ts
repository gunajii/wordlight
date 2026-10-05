// LOCAL DEMO ONLY — a scripted "phone" for the local simulation: joins the TV's session as reader "Riya", and during
// each reading turn reports the mic open and streams SILENT 40 ms PCM frames (no microphone, no voice), so the
// server's scripted speech source runs its script. Lets the whole loop run on the Vega Virtual Device with no phone.
//   node tools/demo/fake-reader.ts [--session CODE] [--url http://localhost:8787] [--name Riya] [--lang en-IN]
// Without --session it waits for the newest session that has a TV connected.
import WebSocket from 'ws';
import { encodeAudioFrame } from '@wordlight/shared-protocol';

export interface FakeReaderOptions { url: string; session?: string; name?: string; lang?: 'en-IN' | 'hi-IN'; log?: (m: string) => void }
export interface FakeReader { close(): void; readonly sessionId: string; readonly events: any[]; readonly micLog: { turnId: string; state: string; atMs: number }[] }

export async function startFakeReader(o: FakeReaderOptions): Promise<FakeReader> {
  const log = o.log ?? ((m: string) => console.log(`[fake-reader] ${m}`));
  let sid = o.session?.toUpperCase();
  for (let i = 0; !sid && i < 600; i++) {
    try {
      const list = await (await fetch(`${o.url}/api/sessions`)).json();
      sid = list.find((s: any) => s.tvConnected)?.sessionId;
    } catch {}
    if (!sid) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!sid) throw new Error('no TV session found');
  const ws = new WebSocket(o.url.replace(/^http/, 'ws') + '/ws');
  const events: any[] = [];
  const micLog: { turnId: string; state: string; atMs: number }[] = [];
  const send = (m: unknown) => ws.readyState === 1 && ws.send(JSON.stringify(m));
  let timer: ReturnType<typeof setInterval> | null = null;
  let turn: { turnId: string; tag: number } | null = null;
  const mic = (turnId: string, state: 'opening' | 'open' | 'closed') => { send({ type: 'mic.state', turnId, state }); micLog.push({ turnId, state, atMs: Date.now() }); };
  const stop = () => { if (timer) clearInterval(timer); timer = null; if (turn) mic(turn.turnId, 'closed'); turn = null; };
  await new Promise<void>((res, rej) => { ws.once('open', () => res()); ws.once('error', rej); });
  send({ t: 'hello', role: 'phone', sessionId: sid, clientId: 'demo-reader' });
  send({ t: 'clock.report', offsetMs: 0, minRttMs: 1 }); // same machine as the server
  send({ type: 'reader.save', reader: { readerId: 'rd-demo', firstName: o.name ?? 'Riya', age: 7, lang: o.lang ?? 'en-IN' }, consent: { microphone: true, atMs: Date.now() } });
  const keep = setInterval(() => send({ t: 'phone.status', micLive: turn ? 1 : 0, turnId: turn?.turnId ?? null, ctx: 'running', visible: 'visible' }), 1000);
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    events.push(m);
    if (m.type === 'turn.start') {
      stop();
      turn = { turnId: m.turnId, tag: m.audioTag };
      log(`turn ${m.turnId}: “${m.words.join(' ')}” → mic open (silent frames; speech is SIMULATED on the server)`);
      mic(m.turnId, 'opening'); mic(m.turnId, 'open');
      let seq = 0; const t = turn;
      timer = setInterval(() => ws.send(encodeAudioFrame({ seq: seq++, tag: t.tag, last: false, capturedAtMs: performance.timeOrigin + performance.now(), pcm: new Int16Array(640) })), 40);
    }
    if ((m.type === 'line.done' || m.type === 'turn.cancel') && turn && m.turnId === turn.turnId) { log(`${m.type} → mic closed`); stop(); }
    if (m.type === 'session.summary') log(`summary: ${m.text}`);
  });
  log(`joined session ${sid} as ${o.name ?? 'Riya'}`);
  return { sessionId: sid, events, micLog, close() { stop(); clearInterval(keep); ws.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2); const opt = (k: string) => (a.includes(`--${k}`) ? a[a.indexOf(`--${k}`) + 1] : undefined);
  startFakeReader({ url: opt('url') ?? 'http://localhost:8787', session: opt('session'), name: opt('name'), lang: opt('lang') as any })
    .catch((e) => { console.error(e?.message ?? e); process.exit(1); });
}
