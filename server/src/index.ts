// WordLight session server — one Node process (run with Node >= 22.18: `npm start`).
//   • WebSocket (/ws): TV + phones, JSON events and binary audio frames, 5 s heartbeat
//   • REST: create/list sessions, QR codes as PNG, telemetry
//   • static: phone page, story packages (Range support for the TV's audio player),
//     and /pkg/* — our TypeScript packages served to the browser as JavaScript
//
// HTTP/WebSocket plumbing, QR, heartbeat and Range serving adapted from Earshot's server
// (same author, commit fe64ce9, server/index.js). See docs/REUSED.md.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { networkInterfaces } from 'node:os';
import * as nodeModule from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import QRCode from 'qrcode';
import { decodeAudioFrame } from '@wordlight/shared-protocol';
import { SessionHub, type Conn } from './hub.ts';
import { S3Sink } from './s3/sink.ts';
import { ReadingDriver, RouterDriver, type TurnTrace } from './reading/driver.ts';
import { TranscribeSource, type SpeechSource } from './reading/speech.ts';
import { scriptedFromEnv } from './reading/scripted.ts';
import { checkAllStories } from './content.ts';
import { summaryFromEnv } from './summary.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

export function lanAddress(): string {
  for (const list of Object.values(networkInterfaces())) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  return '127.0.0.1';
}
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://${lanAddress()}:${PORT}`).replace(/\/$/, '');

// HTTPS base for media. Vega's media player refuses http:// sources (FRICTION_LOG W5), so the TV fetches this at
// runtime instead of baking it into the build: MEDIA_URL env, else the file tools/dev-tunnel.sh keeps up to date
// (re-read per request, so a restarted tunnel needs no server restart and no rebuild).
const MEDIA_URL_FILE = path.join(ROOT, '.dev', 'media-url');
export async function currentMediaUrl(): Promise<string | null> {
  if (process.env.MEDIA_URL) return process.env.MEDIA_URL.replace(/\/$/, '');
  try { const v = (await readFile(MEDIA_URL_FILE, 'utf8')).trim().replace(/\/$/, ''); return v.startsWith('https://') ? v : null; }
  catch { return null; }
}

// Dev-only run control for the TV (written by tools/s1-run/s1-run.sh): lets a script change the audio file and
// lead and start a timing run on the already-running TV app, with no rebuild, relaunch or remote press.
const TV_RUN_FILE = path.join(ROOT, '.dev', 'tv.json');
export type TvRun = { runId?: string; audioFile?: string; leadMs?: number; autorun?: boolean };
export function sanitizeTvRun(v: any): TvRun {
  const out: TvRun = {};
  if (typeof v?.runId === 'string' && /^[\w.:-]{1,64}$/.test(v.runId)) out.runId = v.runId;
  if (typeof v?.audioFile === 'string' && /^[\w-]{1,40}\.(mp3|m4a)$/.test(v.audioFile)) out.audioFile = v.audioFile;
  if (typeof v?.leadMs === 'number' && Number.isFinite(v.leadMs) && Math.abs(v.leadMs) <= 2000) out.leadMs = v.leadMs;
  if (typeof v?.autorun === 'boolean') out.autorun = v.autorun;
  return out;
}
export async function currentTvRun(): Promise<TvRun> {
  try { return sanitizeTvRun(JSON.parse(await readFile(TV_RUN_FILE, 'utf8'))); } catch { return {}; }
}

// Monotonic server clock on a wall-clock scale.
const t0 = performance.timeOrigin;
export const serverNow = () => t0 + performance.now();

// Phones send ≥ 1 message/s and browsers answer WebSocket pings natively: 5 s of silence means gone.
export const HEARTBEAT = { pingMs: Number(process.env.HEARTBEAT_PING_MS || 2000), deadMs: Number(process.env.HEARTBEAT_DEAD_MS || 5000) };

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.ts': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.vtt': 'text/vtt; charset=utf-8',
  '.ttf': 'font/ttf', '.ico': 'image/x-icon',
};
const STATIC: [string, string][] = [
  ['/content/', path.join(ROOT, 'content')],
  ['/phone/', path.join(ROOT, 'web/phone')],
  ['/pkg/session-client/', path.join(ROOT, 'packages/session-client/src')],
  ['/pkg/shared-protocol/', path.join(ROOT, 'packages/shared-protocol/src')],
  ['/pkg/reading-engine/', path.join(ROOT, 'packages/reading-engine/src')],
  ['/pkg/karaoke-core/', path.join(ROOT, 'packages/karaoke-core/src')],
];

export function createServer({ hub = new SessionHub({ now: serverNow }), publicUrl = PUBLIC_URL, log = console.log, heartbeat = HEARTBEAT, mediaUrl = currentMediaUrl, tvRun = currentTvRun, s3ResultsDir = path.join(ROOT, 'bench/runs/s3') as string | null, speechSource = (process.env.SPEECH ?? 'transcribe') as string, traceSink = null as null | ((t: TurnTrace) => void), readingModeOpt = null as null | 'free' | 'echo' } = {}) {
  let reading: ReadingDriver | null = null;
  // Reading strategy (config, not code): 'free' = the child reads the line first; 'echo' = the TV reads it, the child repeats.
  const readingMode: 'free' | 'echo' = (readingModeOpt ?? process.env.READING_MODE) === 'echo' ? 'echo' : 'free';
  let speechName = 'unknown', speechSimulated = false;
  // Phones need https (microphone). The join link/QR uses the https base when one exists (AWS hostname or the
  // dev tunnel), else the LAN URL (which can pair, but cannot open the microphone).
  const joinUrlAsync = async (id: string) => `${(await mediaUrl()) ?? publicUrl}/j/${id}`;
  const joinUrl = (id: string) => `${publicUrl}/j/${id}`;
  // Until the Transcribe adapter exists (S2), the S3 measurement sink is the turn driver. It keeps no audio.
  const s3 = new S3Sink({ now: serverNow, resultsDir: s3ResultsDir ?? undefined, log });
  if (!hub.driver) {
    const simulated = speechSource === 'scripted' || speechSource === 'sim';
    if (simulated && process.env.NODE_ENV === 'production') throw new Error('SPEECH=scripted is a local simulation and is refused when NODE_ENV=production');
    const speech: SpeechSource = simulated ? scriptedFromEnv(process.env.SPEECH_SCRIPT) : new TranscribeSource({ region: process.env.AWS_REGION });
    if (simulated) log(`[reading] SPEECH=scripted (${process.env.SPEECH_SCRIPT ?? 'demo'}) — LOCAL SIMULATION: transcripts come from a script, not from the audio. Not real speech recognition.`);
    speechName = speech.name; speechSimulated = !!speech.simulated;
    reading = new ReadingDriver({ hub, source: speech, now: serverNow, log, devTranscripts: process.env.DEV_TRANSCRIPTS === '1', onTrace: (t) => traceSink?.(t) });
    hub.driver = new RouterDriver({ test: s3, reading });
  }
  // Parent summary wording: template by default; Bedrock only with SUMMARY=bedrock + BEDROCK_MODEL_ID (always falls back).
  if (process.env.SUMMARY === 'bedrock') summaryFromEnv(log).then((sv) => { hub.summary = sv; log(`[summary] ${sv.name}`); });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    try {
      if (p === '/healthz') return json(res, 200, { ok: true, sessions: hub.sessions.size, publicUrl });
      // ---- S3 microphone spike (test sessions only; numbers only, never audio) ----
      if (p === '/api/s3/sessions' && req.method === 'POST') {
        const id = hub.createSession({ testMode: true });
        const https = await mediaUrl();
        return json(res, 201, { sessionId: id, joinUrl: https ? `${https}/j/${id}?diag=1` : null, lanJoinUrl: joinUrl(id), note: https ? undefined : 'no https base: run tools/dev-tunnel/dev-tunnel.sh (phones need https for the microphone)' });
      }
      let m3 = p.match(/^\/api\/s3\/sessions\/([A-Za-z0-9]+)\/(status|turn)$/);
      if (m3) {
        const s = hub.get(m3[1]);
        if (!s || !s.testMode) return json(res, 404, { error: 'no-test-session' });
        if (m3[2] === 'status') {
          return json(res, 200, {
            sessionId: s.id, serverMs: serverNow(),
            phones: [...s.phones.keys()].map((c) => ({ clientId: c, status: s.phoneStatus.get(c) ?? null, clock: s.clocks.get(c) ?? null, reader: [...s.readers.values()].some((r) => r.phoneClientId === c) })),
            turn: s.turn ? { turnId: s.turn.turn.turnId, origin: s.turn.origin, chunkMs: s.turn.chunkMs, audioTag: s.turn.audioTag, startedAtServerMs: s.turn.startedAtServerMs } : null,
            live: s3.liveSummary(s.id), micAudit: s.micAudit, results: s3.results.get(s.id) ?? [],
          });
        }
        if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
        const body = await readJson(req);
        if (body?.action === 'start') {
          const phone = hub.firstPhoneWithReader(s);
          if (!phone) return json(res, 409, { error: 'no-ready-phone' });
          const r = hub.startTestTurn(s, phone, { chunkMs: Number(body.chunkMs) || 40, durationMs: Number(body.durationMs) || 60_000, detectClicks: !!body.clicks });
          return json(res, r.ok ? 200 : 409, r);
        }
        if (body?.action === 'end' || body?.action === 'skip') return json(res, 200, { ended: hub.endActiveTurn(s, body.action === 'skip' ? 'skipped' : 'exit') });
        return json(res, 400, { error: 'action must be start|end|skip' });
      }
      // story shelf: every content/stories/<id> package that passes validation (bad packages are logged, never served
      // to the shelf). Test content (synthetic narration) only with ?all=1 or SHOW_TEST_CONTENT=1 (local demo mode).
      if (p === '/api/stories') {
        const showTest = url.searchParams.get('all') === '1' || process.env.SHOW_TEST_CONTENT === '1';
        const out: unknown[] = [];
        for (const c of await checkAllStories(path.join(ROOT, 'content/stories'))) {
          if (!c.ok) { log(`[content] ${c.id} refused: ${c.issues.filter((i) => i.level === 'error').map((i) => `${i.path}: ${i.message}`).slice(0, 3).join('; ')}`); continue; }
          if (c.test && !showTest) continue;
          const st = c.story!;
          out.push({ id: st.id, title: st.title, lang: st.lang, level: st.level, cover: st.pages[0]?.image ?? null, attribution: st.credits?.attribution ?? '', turns: st.pages.reduce((n, pg) => n + pg.lines.filter((l) => l.turn).length, 0), test: c.test });
        }
        return json(res, 200, out);
      }
      // reading traces (numbers; heard text only with DEV_TRANSCRIPTS=1) for the S2 harness and diagnostics
      if (p === '/api/reading/traces') {
        const sid = url.searchParams.get('session')?.toUpperCase();
        return json(res, 200, (reading?.traces ?? []).filter((t) => !sid || t.sessionId === sid));
      }
      if (p === '/api/config') return json(res, 200, { mediaUrl: await mediaUrl(), run: await tvRun(), readingMode, speech: { source: speechName, simulated: speechSimulated } });
      if (p === '/api/time') return json(res, 200, { c0: Number(url.searchParams.get('c0')), s: serverNow() });
      if (p === '/api/sessions' && req.method === 'POST') {
        const id = hub.createSession();
        log(`[session] created ${id}`);
        return json(res, 201, { sessionId: id, joinUrl: await joinUrlAsync(id), qrUrl: `${publicUrl}/api/sessions/${id}/qr.png`, wsUrl: publicUrl.replace(/^http/, 'ws') + '/ws' });
      }
      if (p === '/api/sessions' && req.method === 'GET') {
        const list = [...hub.sessions.values()].sort((a, b) => b.createdAt - a.createdAt)
          .map((s) => ({ sessionId: s.id, createdAt: s.createdAt, tvConnected: !!s.tv, phones: s.phones.size, readers: s.readers.size }));
        return json(res, 200, list);
      }
      let m = p.match(/^\/api\/sessions\/([A-Za-z0-9]+)(\/.*)?$/);
      if (m) {
        const s = hub.get(m[1]);
        if (!s) return json(res, 404, { error: 'no-session' });
        const sub = m[2] || '';
        if (sub === '' && req.method === 'GET') return json(res, 200, { sessionId: s.id, tvConnected: !!s.tv, phones: [...s.phones.keys()], readers: s.readers.size, turn: s.turn?.turn.turnId ?? null, joinUrl: joinUrl(s.id) });
        if (sub === '/qr.png') {
          const png = await QRCode.toBuffer(await joinUrlAsync(s.id), { width: Number(url.searchParams.get('size') || 480), margin: 2, errorCorrectionLevel: 'M' });
          res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
          return void res.end(png);
        }
        if (sub === '/telemetry.json') return json(res, 200, s.telemetry);
      }
      if (p === '/' || p === '/j' || (m = p.match(/^\/j\/([A-Za-z0-9]+)$/))) return sendFile(res, path.join(ROOT, 'web/phone/index.html'), req);
      for (const [prefix, dir] of STATIC) {
        if (!p.startsWith(prefix)) continue;
        const f = path.normalize(path.join(dir, decodeURIComponent(p.slice(prefix.length))));
        if (!f.startsWith(dir)) return json(res, 403, { error: 'forbidden' });
        if (f.endsWith('.ts')) return sendTypeScript(res, f);
        return sendFile(res, f, req);
      }
      json(res, 404, { error: 'not-found' });
    } catch (err) {
      log('[http] error', err);
      if (!res.headersSent) json(res, 500, { error: 'internal' });
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const conn: Conn = { send: (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); } };
    let lastRx = Date.now(), lastPing = 0, closeReason: 'closed' | 'timeout' = 'closed';
    ws.on('pong', () => (lastRx = Date.now()));
    const hb = setInterval(() => {
      const now = Date.now();
      if (now - lastRx > heartbeat.deadMs) { closeReason = 'timeout'; return ws.terminate(); }
      if (now - lastPing >= heartbeat.pingMs) { lastPing = now; try { ws.ping(); } catch {} }
    }, Math.min(1000, heartbeat.pingMs));
    ws.on('message', (data, isBinary) => {
      lastRx = Date.now();
      if (isBinary) {
        const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
        const frame = decodeAudioFrame(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        if (frame) hub.audio(conn, frame);
        return;
      }
      let msg: any;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg?.t === 'hello') log(`[ws] hello ${msg.role} ${msg.clientId} → ${msg.sessionId} (${req.socket.remoteAddress})`);
      hub.handle(conn, msg);
    });
    ws.on('close', (code) => { clearInterval(hb); hub.disconnect(conn, closeReason, { code }); });
  });
  return { server, hub, wss, publicUrl };
}

async function readJson(req: http.IncomingMessage, limit = 16 * 1024): Promise<any> {
  let size = 0; const parts: Buffer[] = [];
  for await (const c of req) { size += (c as Buffer).length; if (size > limit) return null; parts.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8') || '{}'); } catch { return null; }
}

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Our packages are TypeScript with erasable syntax only; browsers get them with types stripped
// by Node itself (node:module stripTypeScriptTypes, Node >= 22.13). Import specifiers keep their
// .ts extension, which is fine: the browser just requests the next file from this route.
async function sendTypeScript(res: http.ServerResponse, file: string) {
  const strip = (nodeModule as any).stripTypeScriptTypes as undefined | ((src: string, o?: object) => string);
  if (!strip) return json(res, 501, { error: 'this Node version cannot strip TypeScript; use Node >= 22.13' });
  let src: string;
  try { src = await readFile(file, 'utf8'); } catch { return json(res, 404, { error: 'not-found' }); }
  res.writeHead(200, { 'Content-Type': MIME['.ts'], 'Cache-Control': 'no-cache' });
  res.end(strip(src, { mode: 'strip' }));
}

// Static files with Range support (media players need it to seek).
async function sendFile(res: http.ServerResponse, file: string, req?: http.IncomingMessage) {
  let st;
  try { st = await stat(file); } catch { return json(res, 404, { error: 'not-found' }); }
  if (st.isDirectory()) return json(res, 404, { error: 'not-found' });
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const range = req?.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
    const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
    if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return void res.end(); }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    return void createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  if (st.size < 256 * 1024) return void res.end(await readFile(file));
  createReadStream(file).pipe(res);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { server, publicUrl } = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`WordLight server on ${HOST}:${PORT}`);
    console.log(`  public URL (TV + phones use this): ${publicUrl}`);
    console.log(`  phone page:                        ${publicUrl}/j/<CODE>   (open the QR on the TV)`);
    console.log(`  stories:                           ${publicUrl}/content/stories/`);
  });
}
