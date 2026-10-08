// S3 runner: drives microphone test turns on a real phone and reports the measurements.
//
//   node tools/s3/s3.ts [--plan full|quick|endurance|network] [--chunk 40] [--minutes 10] [--no-clicks] [--label iphone]
//
// Needs: `npm start` and `bash tools/dev-tunnel/dev-tunnel.sh` running (phones need https for the microphone).
// Prints a QR + link; open it on the phone, agree, tap "Get ready", leave the page open and the screen on.
// Clicks: a 1 kHz test tone is played on the Mac with afplay while turns run; the server detects it in the
// stream (onset times only) to bound the TRUE acoustic Mac→phone→server latency from above. No voice needed.
// Results: bench/runs/s3/<SESSION>/report.json (+ one JSON per turn written by the server). Numbers only.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = process.env.WL_SERVER || 'http://localhost:8787';
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const PLAN = opt('plan', 'full');
const CHUNK = Number(opt('chunk', '40'));
const MINUTES = Number(opt('minutes', '10'));
const LABEL = opt('label', 'phone');
const CLICKS = !args.includes('--no-clicks') && spawnSync('which', ['afplay']).status === 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (m: string) => console.log(`${new Date().toISOString().slice(11, 19)}  ${m}`);

async function api(p: string, body?: unknown) {
  const admin = { 'x-wordlight-admin': process.env.ADMIN_TOKEN ?? '' }; // needed on the AWS server (operator endpoints)
  const r = await fetch(`${BASE}${p}`, body === undefined ? { headers: admin } : { method: 'POST', headers: { 'content-type': 'application/json', ...admin }, body: JSON.stringify(body) });
  return r.json() as Promise<any>;
}

// server clock ≈ local performance clock + off (min-RTT of a few /api/time round trips; same machine, so tiny)
let off = 0;
async function syncClock() {
  let best = Infinity;
  for (let i = 0; i < 8; i++) {
    const c0 = performance.timeOrigin + performance.now();
    const r = await api(`/api/time?c0=${c0}`);
    const c1 = performance.timeOrigin + performance.now();
    if (c1 - c0 < best) { best = c1 - c0; off = r.s - (c0 + c1) / 2; }
  }
  return best;
}
const serverNow = () => performance.timeOrigin + performance.now() + off;

// 1 kHz test tone for afplay (generated, not a recording)
const CLICK = path.join(ROOT, '.dev', 's3-click.wav');
function writeClick() {
  const sr = 48000, n = Math.round(sr * 0.03), pad = Math.round(sr * 0.1);
  const data = Buffer.alloc((n + pad) * 2);
  for (let i = 0; i < n; i++) {
    const ramp = Math.min(1, i / 96, (n - i) / 96);
    data.writeInt16LE(Math.round(0.6 * ramp * Math.sin((2 * Math.PI * 1000 * i) / sr) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  mkdirSync(path.dirname(CLICK), { recursive: true });
  writeFileSync(CLICK, Buffer.concat([h, data]));
}

async function waitReady(sid: string, quiet = false) {
  let last = '';
  for (;;) {
    const st = await api(`/api/s3/sessions/${sid}/status`);
    const p = st.phones?.find((x: any) => x.reader);
    const line = !st.phones?.length ? 'waiting for the phone to open the link…' : !p ? 'phone connected — waiting for consent…' : p.status?.ctx !== 'running' ? 'consent given — waiting for "Get ready" tap…' : p.status?.visible !== 'visible' ? 'phone page is in the background — bring it back…' : 'ready';
    if (line !== last && !quiet) { say(line); last = line; }
    if (line === 'ready' && p.clock) return st;
    await sleep(700);
  }
}

type TurnOut = { summary: any; spawns: number[]; endReason: string; micOffAfterEndMs: number | null };

async function runTurn(sid: string, o: { chunkMs: number; durationMs: number; clicksEveryMs?: number; skipAfterMs?: number }): Promise<TurnOut> {
  const r = await api(`/api/s3/sessions/${sid}/turn`, { action: 'start', chunkMs: o.chunkMs, durationMs: o.durationMs, clicks: CLICKS && !!o.clicksEveryMs });
  if (!r.ok) throw new Error(`turn refused: ${JSON.stringify(r)}`);
  const turnId = r.turnId as string;
  const t0 = Date.now();
  const spawns: number[] = [];
  let nextClick = t0 + 2500;
  let lastSec = -1;
  for (;;) {
    if (o.skipAfterMs && Date.now() - t0 >= o.skipAfterMs) { await api(`/api/s3/sessions/${sid}/turn`, { action: 'skip' }); }
    if (CLICKS && o.clicksEveryMs && Date.now() >= nextClick) {
      spawns.push(serverNow());
      spawn('afplay', [CLICK], { stdio: 'ignore' });
      nextClick += o.clicksEveryMs;
    }
    const st = await api(`/api/s3/sessions/${sid}/status`);
    if (!st.turn || st.turn.turnId !== turnId) break;
    const sec = Math.floor((Date.now() - t0) / 1000);
    if (sec % 15 === 0 && sec !== lastSec && st.live) {
      lastSec = sec;
      say(`  ${sec}s  frames ${st.live.frames} · missing ${st.live.missing} · latency median ${st.live.latencyFirstSampleMs?.median ?? '—'} ms`);
    }
    await sleep(200);
  }
  // how quickly does the phone report its microphone tracks ended?
  const tEnd = serverNow();
  let micOffAfterEndMs: number | null = null;
  for (let i = 0; i < 30; i++) {
    const st = await api(`/api/s3/sessions/${sid}/status`);
    const p = st.phones?.find((x: any) => x.reader);
    if (p?.status && p.status.micLive === 0 && p.status.atServerMs >= tEnd - 50) { micOffAfterEndMs = Math.round(p.status.atServerMs - tEnd); break; }
    if (!p) break; // phone gone (reload / left)
    await sleep(100);
  }
  let summary: any = null;
  for (let i = 0; i < 20 && !summary; i++) {
    const st = await api(`/api/s3/sessions/${sid}/status`);
    summary = st.results.find((x: any) => x.turnId === turnId) ?? null;
    if (!summary) await sleep(150);
  }
  return { summary, spawns, endReason: summary?.reason ?? 'unknown', micOffAfterEndMs };
}

function acoustic(t: TurnOut) {
  // Robust: the detector can fire on other sounds and a missed tone makes a click pair with an older spawn, so
  // pairs whose spawn→capture is > 150 ms from the median are reported as outliers, not averaged in.
  // pair each detected click with the latest afplay spawn before it (within 1.5 s)
  const pairs: { spawnToCapture: number; spawnToServer: number }[] = [];
  for (const c of t.summary?.clicks ?? []) {
    const ref = c.captureServerMs ?? c.recvServerMs;
    const sp = t.spawns.filter((s) => s <= ref + 50 && ref - s < 1500).pop();
    if (sp !== undefined) pairs.push({ spawnToCapture: c.captureServerMs == null ? NaN : c.captureServerMs - sp, spawnToServer: c.recvServerMs - sp });
  }
  const m0 = pairs.map((p) => p.spawnToCapture).filter(Number.isFinite).sort((x, y) => x - y);
  const mid = m0.length ? m0[m0.length >> 1] : NaN;
  const good = pairs.filter((p) => Math.abs(p.spawnToCapture - mid) <= 150);
  const d = (xs: number[]) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const q = (p: number) => a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)]; return { n: a.length, median: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(a[a.length - 1]) }; };
  return { played: t.spawns.length, detected: t.summary?.clicks?.length ?? 0, matched: good.length, outliers: pairs.length - good.length, spawnToCaptureMs: d(good.map((p) => p.spawnToCapture)), spawnToServerMs: d(good.map((p) => p.spawnToServer)), spawns: t.spawns.map((x) => Math.round(x)) };
}

function row(name: string, t: TurnOut) {
  const s = t.summary ?? {};
  const l = s.latencyFirstSampleMs, tr = s.latencyTransportMs, a = acoustic(t);
  return {
    name, turnId: s.turnId, reason: t.endReason, chunkMs: s.chunkMs, seconds: Math.round((s.durationMs ?? 0) / 1000), frames: s.frames,
    missing: s.missing, duplicates: s.duplicates, outOfOrder: s.outOfOrder, staleTag: s.staleTag,
    firstSample: l && { median: l.median, p95: l.p95, max: l.max, sd: l.sd }, transport: tr && { median: tr.median, p95: tr.p95, max: tr.max },
    clockMinRttMs: s.clock?.minRttMs?.min ?? null, captureGaps: s.captureGaps, audioCoverage: s.audioCoverage, timelineDriftMs: s.timelineDriftMs, effectiveSampleRate: s.effectiveSampleRate,
    firstFrameAfterStartMs: s.firstFrameAfterStartMs, micOffAfterEndMs: t.micOffAfterEndMs, acoustic: a,
  };
}

function printRow(r: any) {
  const f = r.firstSample, a = r.acoustic;
  say(`  ${r.name}: ${r.reason} · ${r.seconds}s · chunk ${r.chunkMs} · frames ${r.frames} · missing ${r.missing} dup ${r.duplicates} ooo ${r.outOfOrder} stale ${r.staleTag}`);
  say(`     first-sample→server: median ${f?.median ?? '—'} p95 ${f?.p95 ?? '—'} max ${f?.max ?? '—'} sd ${f?.sd ?? '—'} ms · clock ±${r.clockMinRttMs == null ? '?' : Math.round(r.clockMinRttMs / 2)} ms · first frame ${r.firstFrameAfterStartMs ?? '—'} ms after start · mic off ${r.micOffAfterEndMs ?? '—'} ms after end`);
  if (a.played) say(`     acoustic (afplay→server, upper bound): median ${a.spawnToServerMs?.median ?? '—'} p95 ${a.spawnToServerMs?.p95 ?? '—'} max ${a.spawnToServerMs?.max ?? '—'} ms · clicks ${a.matched}/${a.played} matched`);
  say(`     audio coverage ${r.audioCoverage ?? '—'} · timeline drift ${r.timelineDriftMs ?? '—'} ms · effective rate ${r.effectiveSampleRate ?? '—'} Hz`);
}

async function main() {
  const health = await api('/healthz').catch(() => null);
  if (!health?.ok) { console.error(`Server not reachable at ${BASE} — run: npm start`); process.exit(1); }
  const created = await api('/api/s3/sessions', {});
  if (!created.joinUrl) { console.error('No https URL for phones — run: bash tools/dev-tunnel/dev-tunnel.sh (then re-run this)'); process.exit(1); }
  const sid = created.sessionId as string;
  const rtt = await syncClock();
  if (CLICKS) writeClick();
  console.log(`\nS3 microphone test · plan ${PLAN} · session ${sid} · label ${LABEL} · clicks ${CLICKS ? 'on (afplay)' : 'off'} · Mac↔server clock RTT ${rtt.toFixed(1)} ms\n`);
  console.log(await QRCode.toString(created.joinUrl, { type: 'terminal', small: true }));
  console.log(`Open on the phone: ${created.joinUrl}\nThen: agree → "Get ready". Keep this page open with the screen on. Mac volume ~70%, speakers on.\n`);
  await waitReady(sid);
  const report: any = { label: LABEL, plan: PLAN, sessionId: sid, startedAt: new Date().toISOString(), clicks: CLICKS, turns: [] as any[], privacy: {} as any };
  const status0 = await api(`/api/s3/sessions/${sid}/status`);
  const phone = status0.phones.find((x: any) => x.reader);
  say(`phone ready · clock min RTT ${Math.round(phone.clock.minRttMs)} ms`);

  // P1: idle, no turn → microphone must be off
  say('privacy check: 8 s idle with no turn (mic must stay OFF)…');
  const before = status0.micAudit.statusReports;
  await sleep(8000);
  const idle = await api(`/api/s3/sessions/${sid}/status`);
  report.privacy.idle = { statusReports: idle.micAudit.statusReports - before, violations: idle.micAudit.violations.length, micLiveNow: idle.phones.find((x: any) => x.reader)?.status?.micLive };
  say(`  idle: ${report.privacy.idle.statusReports} status reports, mic live now ${report.privacy.idle.micLiveNow}, violations ${report.privacy.idle.violations}`);

  const add = (name: string, t: TurnOut) => { const r = row(name, t); report.turns.push(r); printRow(r); return r; };
  const chunks = PLAN === 'quick' ? [40] : [20, 40, 60, 100];

  if (PLAN === 'full' || PLAN === 'quick') {
    say(`chunk-size sweep: ${chunks.join(', ')} ms × ${PLAN === 'quick' ? 30 : 60} s each (clicks every 3 s)`);
    for (const c of chunks) {
      say(`turn: chunk ${c} ms`);
      add(`sweep-${c}`, await runTurn(sid, { chunkMs: c, durationMs: (PLAN === 'quick' ? 30 : 60) * 1000, clicksEveryMs: 3000 }));
      await waitReady(sid, true); await sleep(1500);
    }
    say('skip check: start a turn, skip it after 3 s (mic must close)');
    add('skip', await runTurn(sid, { chunkMs: 40, durationMs: 60_000, skipAfterMs: 3000 }));
    await waitReady(sid, true); await sleep(1500);
  }
  if (PLAN === 'full' || PLAN === 'endurance') {
    const total = MINUTES * 60_000;
    say(`endurance: ${MINUTES} min at ${CHUNK} ms chunks (clicks every 10 s). Keep the page open, screen on.`);
    let left = total, part = 0;
    while (left > 5000) {
      const t0 = Date.now();
      const t = await runTurn(sid, { chunkMs: CHUNK, durationMs: left, clicksEveryMs: 10_000 });
      add(`endurance-${++part}`, t);
      left -= Date.now() - t0;
      if (t.endReason === 'timeout') break;
      say(`  turn ended early (${t.endReason}); waiting for the phone, then continuing for ${Math.round(left / 1000)} s`);
      const w0 = Date.now(); await waitReady(sid, true); say(`  phone ready again after ${Math.round((Date.now() - w0) / 1000)} s`);
      left -= Date.now() - w0;
    }
  }
  if (PLAN === 'network') {
    const mins = args.includes('--minutes') ? MINUTES : 4;
    say(`interruption test: ${mins} min of turns. Do each of these once, about a minute apart, ~10 s each:`);
    say('  (1) Wi-Fi OFF then ON   (2) lock the screen, then unlock   (3) switch to another app, then come back   (4) reload the page (tap "Get ready" again)');
    say('Expected each time: mic stops at once; the turn ends; nothing restarts until this runner starts a NEW turn once the phone is back.');
    say('The page asks to keep the screen awake during the session; do NOT touch the phone between the steps (tests the screen staying on).');
    let left = mins * 60_000, part = 0;
    while (left > 5000) {
      const t0 = Date.now();
      const t = await runTurn(sid, { chunkMs: CHUNK, durationMs: left, clicksEveryMs: 5000 });
      add(`network-${++part}`, t);
      left -= Date.now() - t0;
      if (t.endReason === 'timeout') break;
      const w0 = Date.now(); await waitReady(sid, true);
      const back = Math.round((Date.now() - w0) / 1000);
      say(`  phone ready again after ${back} s`); report.turns.at(-1).readyAgainAfterS = back;
      left -= Date.now() - w0;
    }
  }
  const fin = await api(`/api/s3/sessions/${sid}/status`);
  report.privacy.audit = fin.micAudit;
  // session timeline (joins, leaves, turn start/end, mic.state incl. device audio settings) — events only, no audio
  const tel = await api(`/api/sessions/${sid}/telemetry.json`).catch(() => []);
  report.finishedAt = new Date().toISOString();
  const dir = path.join(ROOT, 'bench/runs/s3', sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `report-${LABEL}-${PLAN}.json`), JSON.stringify(report, null, 1));
  writeFileSync(path.join(dir, `telemetry-${LABEL}-${PLAN}.json`), JSON.stringify(tel, null, 1));
  const offs = [...fin.micAudit.offAfterEndMs].sort((x: number, y: number) => x - y);
  if (offs.length) say(`mic off after turn end (server end → phone reports 0 live tracks): median ${offs[offs.length >> 1]} ms, max ${offs[offs.length - 1]} ms over ${offs.length} turns`);
  say(`privacy audit: ${fin.micAudit.statusReports} status reports · mic live during turns ${fin.micAudit.liveDuringTurnReports} · violations (live outside a turn) ${fin.micAudit.violations.length}`);
  say(`report: bench/runs/s3/${sid}/report-${LABEL}-${PLAN}.json`);
  if (existsSync(CLICK)) say('done.');
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
