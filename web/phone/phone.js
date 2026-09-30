// WordLight phone page — S3 microphone spike.
//
// Lifecycle (privacy): pair (open link) → consent → "Get ready" tap (unlocks audio processing; mic stays OFF)
// → wait → server sends turn.start → getUserMedia → stream 16 kHz PCM16 chunks → turn.cancel / line.done /
// connection lost / page hidden / unload → every microphone track is stopped (MediaStreamTrack.stop()).
// The microphone is never requested on page load, and never re-opened without a new turn.start.
// Every second the page reports how many of its microphone tracks are 'live' (browser API, not UI state),
// so the server can audit that the microphone is off outside turns.
import { SyncClient, ClockSync } from '/pkg/session-client/index.js';
import { encodeAudioFrame } from '/pkg/shared-protocol/audio.ts';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const code = (location.pathname.match(/\/j\/([A-Za-z0-9]+)/) || [])[1]?.toUpperCase();
let clientId = store.get('wordlight.clientId');
if (!clientId) { clientId = 'ph-' + Math.random().toString(36).slice(2, 10); store.set('wordlight.clientId', clientId); }
const CONSENT_KEY = 'wordlight.micConsent.v1';

const S = {
  consent: Number(store.get(CONSENT_KEY)) || 0,
  ctx: null, workletReady: false,
  turn: null, stream: null, source: null, node: null, tracks: new Set(),
  seq: 0, sent: 0, unsent: 0, acked: 0, lost: 0, latMs: null, rms: 0,
  status: 'connecting', connectedOnce: false, reconnects: 0, turnStartedAt: 0, rates: '—',
};
window.wl = S; // for inspection in a remote debugger

const clock = new ClockSync();
const now = () => performance.now();
const client = new SyncClient({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  sessionId: code || 'NONE', role: 'viewer', clientId, clock, now,
  onStatus: onStatus, onMessage: onMessage,
});

function msg(t) { $('msg').textContent = t || ''; }

function sendReader() {
  if (!S.consent) return;
  client.send({ type: 'reader.save', reader: { readerId: 'rd-' + clientId.slice(3, 11), firstName: 'Test reader', age: 8, lang: 'en-IN' }, consent: { microphone: true, atMs: S.consent } });
}

function micLive() { let n = 0; for (const t of S.tracks) if (t.readyState === 'live') n++; return n; }
function sendStatus() {
  client.send({ t: 'phone.status', micLive: micLive(), turnId: S.turn?.turnId ?? null, ctx: S.ctx?.state ?? null, visible: document.visibilityState });
}
function sendMic(turn, state, detail) {
  client.send({ type: 'mic.state', turnId: turn.turnId, state, detail: detail ? String(detail).slice(0, 500) : undefined, sentAtMs: now() });
}

function onStatus(st) {
  S.status = st;
  if (st === 'open') {
    if (S.connectedOnce) S.reconnects++;
    S.connectedOnce = true;
    sendReader();
    sendStatus();
  } else if (st === 'connecting' || st === 'closed') {
    // Socket gone: stop the microphone now. The server ends this turn when we rejoin; nothing resumes blindly.
    if (S.stream || S.turn) stopMic('connection-lost', true);
  }
  render();
}

function onMessage(m) {
  if (m.t === 'error') msg(`${m.code}: ${m.message}`);
  if (m.t === 's3.ack' && S.turn && m.turnId === S.turn.turnId) { S.acked = m.frames; S.lost = m.missing; S.latMs = m.latencyMedianMs; }
  if (m.type === 'turn.start') startTurn(m);
  if ((m.type === 'turn.cancel' || m.type === 'line.done') && S.turn && m.turnId === S.turn.turnId) stopMic(`turn-ended:${m.reason ?? 'done'}`);
}

async function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC || !window.AudioWorkletNode) { msg('This browser has no AudioWorklet; microphone streaming is not supported here.'); return; }
  if (!S.ctx) { S.ctx = new AC(); S.ctx.onstatechange = () => { render(); sendStatus(); }; }
  const resumed = S.ctx.resume(); // must start inside the tap (autoplay policy)
  if (!S.workletReady) {
    try { await S.ctx.audioWorklet.addModule('/phone/mic-worklet.js'); S.workletReady = true; }
    catch (e) { msg(`AudioWorklet failed to load: ${e?.message ?? e}`); }
  }
  await resumed.catch(() => {});
  render();
}

async function startTurn(m) {
  if (!S.consent) { sendMic(m, 'denied', 'no-consent'); return; }
  if (S.turn) stopMic('replaced');
  S.turn = { turnId: m.turnId, tag: m.audioTag ?? 0, chunkMs: m.chunkMs ?? 40 };
  Object.assign(S, { seq: 0, sent: 0, unsent: 0, acked: 0, lost: 0, latMs: null, turnStartedAt: now() });
  if (S.ctx && S.ctx.state !== 'running') await S.ctx.resume().catch(() => {});
  if (!S.ctx || !S.workletReady || S.ctx.state !== 'running') {
    sendMic(S.turn, 'opening', 'needs-tap');
    $('tap-btn').classList.remove('hidden');
    render();
    return;
  }
  openMic();
}

async function openMic() {
  const turn = S.turn;
  if (!turn) return;
  $('tap-btn').classList.add('hidden');
  sendMic(turn, 'opening');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (e) {
    sendMic(turn, e?.name === 'NotAllowedError' ? 'denied' : 'error', `${e?.name}: ${e?.message}`);
    msg(`Microphone: ${e?.name}: ${e?.message}`);
    return;
  }
  for (const t of stream.getTracks()) { S.tracks.add(t); t.addEventListener('ended', () => { render(); sendStatus(); }); }
  if (S.turn !== turn) { for (const t of stream.getTracks()) t.stop(); sendStatus(); render(); return; } // turn ended during the prompt
  S.stream = stream;
  S.source = S.ctx.createMediaStreamSource(stream);
  S.node = new AudioWorkletNode(S.ctx, 'wl-mic', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], processorOptions: { targetRate: 16000, chunkMs: turn.chunkMs } });
  S.node.port.onmessage = (e) => onChunk(turn, e.data);
  S.source.connect(S.node);
  S.node.connect(S.ctx.destination); // outputs silence; keeps the node in the rendered graph
  const set = stream.getAudioTracks()[0]?.getSettings?.() ?? {};
  S.rates = `${S.ctx.sampleRate} → 16000 Hz`;
  sendMic(turn, 'open', JSON.stringify({ ctxRate: S.ctx.sampleRate, trackRate: set.sampleRate ?? null, channels: set.channelCount ?? null, ec: set.echoCancellation ?? null, ns: set.noiseSuppression ?? null, agc: set.autoGainControl ?? null, trackLatency: set.latency ?? null, baseLatency: S.ctx.baseLatency ?? null, ua: navigator.userAgent }));
  sendStatus();
  render();
}

function onChunk(turn, d) {
  if (S.turn !== turn || !d?.pcm) return;
  const t = now();
  const pcm = new Int16Array(d.pcm);
  S.rms = d.rms;
  // capturedAtMs = when this chunk reached the page minus its own duration ≈ phone time of its first sample
  const frame = encodeAudioFrame({ seq: S.seq++, tag: turn.tag, last: false, capturedAtMs: t - pcm.length / 16, pcm });
  const ws = client.ws;
  if (ws && ws.readyState === 1 && (S.status === 'open' || S.status === 'stale') && ws.bufferedAmount < 512 * 1024) {
    ws.send(frame);
    S.sent++;
  } else S.unsent++;
}

function stopMic(reason, silent = false) {
  const turn = S.turn;
  if (S.node) { try { S.node.port.postMessage({ cmd: 'stop' }); } catch {} S.node.port.onmessage = null; try { S.node.disconnect(); } catch {} S.node = null; }
  if (S.source) { try { S.source.disconnect(); } catch {} S.source = null; }
  for (const t of S.tracks) { try { t.stop(); } catch {} }
  S.tracks = new Set([...S.tracks].filter((t) => t.readyState === 'live')); // should now be empty
  S.stream = null;
  S.turn = null;
  S.rms = 0;
  $('tap-btn').classList.add('hidden');
  if (turn && !silent) sendMic(turn, 'closed', reason);
  sendStatus();
  render();
}

function render() {
  $('sid').textContent = code || '—';
  $('conn').textContent = S.status;
  $('reconnects').textContent = S.reconnects;
  $('rtt').textContent = clock.ready ? `${Math.round(clock.minRtt)} ms` : '—';
  const unlocked = !!S.ctx && S.workletReady && S.ctx.state === 'running';
  $('consent-card').classList.toggle('hidden', !!S.consent);
  $('ready-card').classList.toggle('hidden', !S.consent || unlocked);
  $('mic-card').classList.toggle('hidden', !S.consent);
  $('test-card').classList.toggle('hidden', !S.consent || !unlocked);
  const live = micLive();
  const mic = $('mic');
  mic.textContent = live > 0 ? 'LISTENING' : S.turn ? 'OPENING…' : 'OFF';
  mic.className = 'mic ' + (live > 0 ? 'on' : 'off');
  $('live').textContent = live;
  $('chunk').textContent = S.turn ? `${S.turn.chunkMs} ms` : '—';
  $('sent').textContent = S.sent; $('acked').textContent = S.acked; $('lost').textContent = S.lost; $('unsent').textContent = S.unsent;
  $('lat').textContent = S.latMs == null ? '—' : `${S.latMs} ms`;
  $('rates').textContent = S.rates;
  $('elapsed').textContent = S.turn ? `${((now() - S.turnStartedAt) / 1000).toFixed(1)} s` : '—';
  const db = S.rms > 0 ? 20 * Math.log10(S.rms) : -90;
  $('level').style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
}

$('consent-btn').onclick = () => { S.consent = Date.now(); store.set(CONSENT_KEY, String(S.consent)); sendReader(); unlockAudio(); };
$('ready-btn').onclick = () => unlockAudio();
$('tap-btn').onclick = async () => { await unlockAudio(); if (S.turn) openMic(); };
$('start-btn').onclick = () => client.send({ t: 's3.turn', action: 'start', chunkMs: Number($('chunk-sel').value), durationMs: 60_000 });
$('end-btn').onclick = () => client.send({ t: 's3.turn', action: 'end' });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && (S.stream || S.turn)) stopMic('page-hidden'); sendStatus(); });
addEventListener('pagehide', () => { if (S.stream || S.turn) stopMic('page-unload'); });

setInterval(sendStatus, 1000);
setInterval(() => { if (clock.ready) client.send({ t: 'clock.report', offsetMs: clock.offsetAt(now()), minRttMs: clock.minRtt }); }, 2000);
setInterval(render, 100);

if (!code) msg('Open the link printed on the Mac (…/j/CODE).');
else client.start();
render();
