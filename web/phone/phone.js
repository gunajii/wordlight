// WordLight phone page — S3 microphone spike.
//
// Microphone rules live in mic-lifecycle.js (pure, unit-tested): the mic is open only with consent + a "Get ready"
// tap + an active session + a live socket + a visible page + an active server turn. Anything else stops every
// track (MediaStreamTrack.stop()) and forgets the turn; only a NEW turn.start can open it again.
// Wake lock (wakelock.js) keeps the screen on from "Get ready" until "End session", where the browser supports it.
// Diagnostics: page-lifecycle events (visibility, pagehide/pageshow, freeze/resume, online/offline, socket
// open/close codes, mic and wake-lock changes) are timestamped on the phone, kept across reloads in
// sessionStorage, and sent to the server when connected. No audio, no transcript.
import { SyncClient, ClockSync } from '/pkg/session-client/index.js';
import { encodeAudioFrame } from '/pkg/shared-protocol/audio.ts';
import { initialState, reduce, micWanted, needsTap } from '/phone/mic-lifecycle.js';
import { WakeLockKeeper } from '/phone/wakelock.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const sstore = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch {} },
};
const code = (location.pathname.match(/\/j\/([A-Za-z0-9]+)/) || [])[1]?.toUpperCase();
let clientId = store.get('wordlight.clientId');
if (!clientId) { clientId = 'ph-' + Math.random().toString(36).slice(2, 10); store.set('wordlight.clientId', clientId); }
const CONSENT_KEY = 'wordlight.micConsent.v1';
const now = () => performance.now();

// ---------- diagnostics event log ----------
const EV_KEY = `wordlight.events.${code}`;
let evSeq = Number(sstore.get(EV_KEY + '.seq')) || 0;
let events = []; try { events = JSON.parse(sstore.get(EV_KEY) || '[]'); } catch {}
function ev(k, extra = {}) {
  events.push({ i: ++evSeq, k, t: Math.round(now()), w: Date.now(), vis: document.visibilityState, ...extra });
  if (events.length > 400) events.splice(0, events.length - 400);
  sstore.set(EV_KEY, JSON.stringify(events)); sstore.set(EV_KEY + '.seq', String(evSeq));
}
function flushEvents() {
  while (events.length) {
    const batch = events.slice(0, 40);
    if (!client.send({ t: 'phone.events', events: batch })) return;
    events.splice(0, batch.length);
  }
  sstore.set(EV_KEY, '[]');
}

// ---------- state ----------
const S = {
  consent: Number(store.get(CONSENT_KEY)) || 0,
  ctx: null, workletReady: false,
  stream: null, source: null, node: null, tracks: new Set(), openingTurn: null,
  seq: 0, sent: 0, unsent: 0, acked: 0, lost: 0, latMs: null, rms: 0,
  status: 'connecting', connectedOnce: false, reconnects: 0, turnStartedAt: 0, rates: '—', wake: 'off',
};
let L = initialState({ consent: !!S.consent, visible: document.visibilityState === 'visible' });
window.wl = { S, get L() { return L; }, get events() { return events; } };

class LoggedWS extends WebSocket {
  constructor(u) {
    super(u);
    const t0 = now();
    this.addEventListener('open', () => ev('ws-open', { ms: Math.round(now() - t0) }));
    this.addEventListener('close', (e) => ev('ws-close', { code: e.code, clean: e.wasClean, reason: String(e.reason || '').slice(0, 60), aliveMs: Math.round(now() - t0) }));
    this.addEventListener('error', () => ev('ws-error'));
  }
}
const clock = new ClockSync();
const client = new SyncClient({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  sessionId: code || 'NONE', role: 'viewer', clientId, clock, now, WebSocketImpl: LoggedWS,
  onStatus: onStatus, onMessage: onMessage,
});
const wake = new WakeLockKeeper({ onChange: (st) => { S.wake = st; render(); }, log: (k, d) => ev(k, d ? { d: String(d).slice(0, 80) } : {}) });

function msg(t) { $('msg').textContent = t || ''; }
function sendReader() {
  if (!S.consent) return;
  client.send({ type: 'reader.save', reader: { readerId: 'rd-' + clientId.slice(3, 11), firstName: 'Test reader', age: 8, lang: 'en-IN' }, consent: { microphone: true, atMs: S.consent } });
}
function micLive() { let n = 0; for (const t of S.tracks) if (t.readyState === 'live') n++; return n; }
function sendStatus() {
  client.send({ t: 'phone.status', micLive: micLive(), turnId: L.turn?.turnId ?? null, ctx: S.ctx?.state ?? null, visible: document.visibilityState });
}
function sendMic(turnId, state, detail) {
  client.send({ type: 'mic.state', turnId, state, detail: detail ? String(detail).slice(0, 500) : undefined, sentAtMs: now() });
}

// ---------- the only place that opens/closes the mic ----------
function dispatch(e) {
  const prevTurn = L.turn?.turnId ?? '-';
  const r = reduce(L, e);
  L = r.state;
  if (r.rejected) { ev('turn-rejected', { why: r.rejected }); if (e.type === 'turn-start') sendMic(e.turnId, 'error', `rejected:${r.rejected}`); }
  if (r.stopReason) stopMic(e.stale ? 'connection-stale' : r.stopReason, prevTurn);
  if (micWanted(L) && !S.stream && S.openingTurn !== L.turn.turnId) openMic(L.turn);
  $('tap-btn').classList.toggle('hidden', !needsTap(L));
  if (needsTap(L) && e.type === 'turn-start') sendMic(L.turn.turnId, 'opening', 'needs-tap');
  sendStatus(); render();
}

function onStatus(st) {
  const prev = S.status;
  S.status = st;
  ev('status', { from: prev, to: st, online: navigator.onLine });
  if (st === 'open') {
    if (S.connectedOnce) S.reconnects++;
    S.connectedOnce = true;
    sendReader(); flushEvents();
    dispatch({ type: 'connected' });
  } else if (st === 'connecting' || st === 'closed') {
    dispatch({ type: 'disconnected' });
  } else if (st === 'stale') {
    // No message from the server for 3 s (it pings every second): treat as lost for the MICROPHONE right away,
    // rather than streaming into a dead socket until the client gives it up (15 s). The turn is not resumed.
    dispatch({ type: 'disconnected', stale: true });
  } else render();
}

function onMessage(m) {
  if (m.t === 'error') msg(`${m.code}: ${m.message}`);
  if (m.t === 's3.ack' && L.turn && m.turnId === L.turn.turnId) { S.acked = m.frames; S.lost = m.missing; S.latMs = m.latencyMedianMs; }
  if (m.type === 'turn.start') {
    ev('turn-start', { turnId: m.turnId, chunk: m.chunkMs });
    Object.assign(S, { seq: 0, sent: 0, unsent: 0, acked: 0, lost: 0, latMs: null, turnStartedAt: now() });
    dispatch({ type: 'turn-start', turnId: m.turnId, tag: m.audioTag, chunkMs: m.chunkMs });
  }
  if (m.type === 'turn.cancel' || m.type === 'line.done') { ev('turn-end', { turnId: m.turnId, reason: m.reason ?? 'done' }); dispatch({ type: 'turn-end', turnId: m.turnId, reason: m.reason ?? 'done' }); }
}

async function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !window.AudioWorkletNode) { msg('This browser has no AudioWorklet; microphone streaming is not supported here.'); return; }
  if (!S.ctx) {
    S.ctx = new AC();
    S.ctx.onstatechange = () => {
      ev('ctx-state', { s: S.ctx.state });
      if (S.ctx.state !== 'running') dispatch({ type: 'not-ready' });
      else if (S.workletReady) dispatch({ type: 'ready' }); // (during the first unlock, unlockAudio dispatches 'ready')
    };
  }
  const resumed = S.ctx.resume(); // must start inside the tap (autoplay policy)
  if (!S.workletReady) {
    try { await S.ctx.audioWorklet.addModule('/phone/mic-worklet.js'); S.workletReady = true; }
    catch (e) { msg(`AudioWorklet failed to load: ${e?.message ?? e}`); ev('worklet-error', { e: String(e?.message ?? e) }); }
  }
  await resumed.catch(() => {});
  if (S.ctx.state === 'running' && S.workletReady) dispatch({ type: 'ready' });
  render();
}

async function openMic(turn) {
  S.openingTurn = turn.turnId;
  sendMic(turn.turnId, 'opening');
  ev('mic-opening', { turnId: turn.turnId });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (e) {
    S.openingTurn = null;
    ev('mic-error', { name: e?.name, m: String(e?.message ?? '').slice(0, 80) });
    sendMic(turn.turnId, e?.name === 'NotAllowedError' ? 'denied' : 'error', `${e?.name}: ${e?.message}`);
    msg(`Microphone: ${e?.name}: ${e?.message}`);
    return;
  }
  for (const t of stream.getTracks()) {
    S.tracks.add(t);
    t.addEventListener('ended', () => { ev('track-ended'); sendStatus(); render(); });
    t.addEventListener('mute', () => ev('track-mute'));
    t.addEventListener('unmute', () => ev('track-unmute'));
  }
  S.openingTurn = null;
  if (!micWanted(L) || L.turn?.turnId !== turn.turnId) { // conditions changed while the prompt/open was pending
    for (const t of stream.getTracks()) t.stop();
    ev('mic-discarded', { turnId: turn.turnId });
    sendStatus(); render(); return;
  }
  S.stream = stream;
  S.source = S.ctx.createMediaStreamSource(stream);
  S.node = new AudioWorkletNode(S.ctx, 'wl-mic', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { targetRate: 16000, chunkMs: turn.chunkMs } });
  S.node.port.onmessage = (e) => onChunk(turn, e.data);
  S.source.connect(S.node);
  S.node.connect(S.ctx.destination); // outputs silence; keeps the node in the rendered graph
  const set = stream.getAudioTracks()[0]?.getSettings?.() ?? {};
  S.rates = `${S.ctx.sampleRate} → 16000 Hz`;
  ev('mic-open', { turnId: turn.turnId, ctxRate: S.ctx.sampleRate, trackRate: set.sampleRate ?? -1 });
  sendMic(turn.turnId, 'open', JSON.stringify({ ctxRate: S.ctx.sampleRate, trackRate: set.sampleRate ?? null, channels: set.channelCount ?? null, ec: set.echoCancellation ?? null, ns: set.noiseSuppression ?? null, agc: set.autoGainControl ?? null, trackLatency: set.latency ?? null, baseLatency: S.ctx.baseLatency ?? null, ua: navigator.userAgent }));
  sendStatus(); render();
}

function onChunk(turn, d) {
  if (L.turn?.turnId !== turn.turnId || !S.stream || !d?.pcm) return;
  const t = now();
  const pcm = new Int16Array(d.pcm);
  S.rms = d.rms;
  // capturedAtMs = when this chunk reached the page minus its own duration ≈ phone time of its first sample
  const frame = encodeAudioFrame({ seq: S.seq++, tag: turn.tag, last: false, capturedAtMs: t - pcm.length / 16, pcm });
  const ws = client.ws;
  if (ws && ws.readyState === 1 && (S.status === 'open' || S.status === 'stale') && ws.bufferedAmount < 512 * 1024) { ws.send(frame); S.sent++; }
  else S.unsent++;
}

function stopMic(reason, turnId = '-') {
  const hadMic = !!S.stream || S.tracks.size > 0;
  if (S.node) { try { S.node.port.postMessage({ cmd: 'stop' }); } catch {} S.node.port.onmessage = null; try { S.node.disconnect(); } catch {} S.node = null; }
  if (S.source) { try { S.source.disconnect(); } catch {} S.source = null; }
  for (const t of S.tracks) { try { t.stop(); } catch {} }
  S.tracks = new Set([...S.tracks].filter((t) => t.readyState === 'live')); // should now be empty
  S.stream = null; S.rms = 0;
  ev('mic-stop', { reason, hadMic, liveAfter: micLive() });
  // Always tell the server (a no-op if the socket is really gone): if the socket survived an 'offline' blip, the
  // server must not keep waiting on a turn whose microphone this phone has already closed.
  if (hadMic) sendMic(turnId, 'closed', reason);
}

function render() {
  $('sid').textContent = code || '—';
  $('conn').textContent = S.status;
  $('reconnects').textContent = S.reconnects;
  $('rtt').textContent = clock.ready ? `${Math.round(clock.minRtt)} ms` : '—';
  $('consent-card').classList.toggle('hidden', !!S.consent);
  $('ready-card').classList.toggle('hidden', !S.consent || L.ready);
  $('mic-card').classList.toggle('hidden', !S.consent);
  $('test-card').classList.toggle('hidden', !S.consent || !L.ready);
  $('session-end-btn').classList.toggle('hidden', !L.ready || L.session !== 'active');
  const live = micLive();
  const mic = $('mic');
  mic.textContent = live > 0 ? 'LISTENING' : L.turn ? (needsTap(L) ? 'TAP TO LISTEN' : 'OPENING…') : 'OFF';
  mic.className = 'mic ' + (live > 0 ? 'on' : 'off');
  $('live').textContent = live;
  $('chunk').textContent = L.turn ? `${L.turn.chunkMs} ms` : '—';
  $('sent').textContent = S.sent; $('acked').textContent = S.acked; $('lost').textContent = S.lost; $('unsent').textContent = S.unsent;
  $('lat').textContent = S.latMs == null ? '—' : `${S.latMs} ms`;
  $('rates').textContent = S.rates;
  $('elapsed').textContent = L.turn ? `${((now() - S.turnStartedAt) / 1000).toFixed(1)} s` : '—';
  const wakeText = { on: 'on', off: 'off', requesting: 'requesting…', unsupported: 'not supported — keep the screen on manually', lost: 'lost — tap the page to restore', error: 'refused — keep the screen on manually' }[S.wake] ?? S.wake;
  $('wake').textContent = wakeText;
  const db = S.rms > 0 ? 20 * Math.log10(S.rms) : -90;
  $('level').style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
}

async function startSession() { ev('session-start'); wake.enable(); /* requested inside the tap */ dispatch({ type: 'session-start' }); await unlockAudio(); }
$('consent-btn').onclick = () => { S.consent = Date.now(); store.set(CONSENT_KEY, String(S.consent)); ev('consent'); dispatch({ type: 'consent' }); sendReader(); startSession(); };
$('ready-btn').onclick = () => startSession();
$('tap-btn').onclick = () => unlockAudio();
$('start-btn').onclick = () => client.send({ t: 's3.turn', action: 'start', chunkMs: Number($('chunk-sel').value), durationMs: 60_000 });
$('end-btn').onclick = () => client.send({ t: 's3.turn', action: 'end' });
$('session-end-btn').onclick = () => { ev('session-end'); if (L.turn) client.send({ t: 's3.turn', action: 'end' }); dispatch({ type: 'session-end' }); wake.disable(); S.ctx?.suspend?.().catch(() => {}); dispatch({ type: 'not-ready' }); };
document.addEventListener('click', () => { if (S.wake === 'lost' && L.session === 'active' && L.ready) wake.enable(); });

// ---------- page lifecycle ----------
document.addEventListener('visibilitychange', () => { ev('visibility', { v: document.visibilityState }); dispatch({ type: document.visibilityState === 'hidden' ? 'hidden' : 'visible' }); flushEvents(); });
addEventListener('pagehide', (e) => { ev('pagehide', { persisted: e.persisted }); dispatch({ type: 'unload' }); wake.disable(); flushEvents(); });
addEventListener('pageshow', (e) => ev('pageshow', { persisted: e.persisted }));
document.addEventListener('freeze', () => ev('freeze'));   // Chromium Page Lifecycle API
document.addEventListener('resume', () => ev('resume'));
addEventListener('online', () => ev('online'));
addEventListener('offline', () => { ev('offline'); dispatch({ type: 'disconnected' }); }); // the OS says the network is gone
addEventListener('focus', () => ev('focus'));
addEventListener('blur', () => ev('blur'));
navigator.connection?.addEventListener?.('change', () => ev('net-change', { type: navigator.connection.type ?? '', eff: navigator.connection.effectiveType ?? '' }));
ev('page-load', { nav: performance.getEntriesByType?.('navigation')?.[0]?.type ?? 'unknown', online: navigator.onLine, wakeLockApi: !!navigator.wakeLock });

setInterval(sendStatus, 1000);
setInterval(() => { if (clock.ready) client.send({ t: 'clock.report', offsetMs: clock.offsetAt(now()), minRttMs: clock.minRtt }); }, 2000);
setInterval(flushEvents, 1000);
setInterval(render, 100);

if (!code) msg('Open the link printed on the Mac (…/j/CODE).');
else client.start();
render();
