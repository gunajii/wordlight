import { chromium } from 'playwright-core';
// Dev-only automated browser check of the phone page's mic lifecycle (Chromium with a FAKE microphone).
// Needs: a running server (PORT=8800 MEDIA_URL=https://example.test node server/src/index.ts), playwright-core,
// and CHROMIUM=/path/to/chromium. Prints the lifecycle observations (A–M) used in docs/SPIKES.md.
const BASE = process.env.WL_SERVER || 'http://localhost:8800';
const api = async (p, body) => (await fetch(BASE + p, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = (sid) => api(`/api/s3/sessions/${sid}/status`);
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await browser.newContext();
await ctx.addInitScript(() => { window.__gum = 0; const o = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = (c) => { window.__gum++; return o(c); }; });
const page = await ctx.newPage();
page.on('pageerror', (e) => log('  [pageerror]', e.message));
const live = () => page.evaluate(() => [...window.wl.S.tracks].filter((t) => t.readyState === 'live').length);
const { sessionId: sid } = await api('/api/s3/sessions', {});
await page.goto(`${BASE}/j/${sid}`); await sleep(1200);
log('A load: gUM', await page.evaluate(() => window.__gum), 'live', await live(), 'wake', await page.textContent('#wake'));
await page.click('#consent-btn'); await sleep(1500);
log('B consent+ready: ready', await page.evaluate(() => window.wl.L.ready), 'wake', await page.textContent('#wake'), 'gUM', await page.evaluate(() => window.__gum));
// turn → offline mid-turn
const t1 = await api(`/api/s3/sessions/${sid}/turn`, { action: 'start', chunkMs: 40, durationMs: 60000 });
await sleep(2500);
log('C turn: mic', await page.textContent('#mic'), 'live', await live());
const tOff = Date.now();
await ctx.setOffline(true);
let offAt = null;
for (let i = 0; i < 100; i++) { if ((await live()) === 0) { offAt = Date.now() - tOff; break; } await sleep(50); }
log('D offline: mic off after', offAt, 'ms; status', await page.textContent('#conn'));
await sleep(7000);
let st = await status(sid);
log('   server turn after 7 s offline:', st.turn ? 'still active' : 'ended', '| last result', st.results.at(-1)?.reason);
await ctx.setOffline(false); await sleep(4000);
st = await status(sid);
log('E back online: conn', await page.textContent('#conn'), 'live', await live(), 'reconnects', await page.textContent('#reconnects'), 'server turn', st.turn);
// stale: block ws only? (skip) — session end
const t2 = await api(`/api/s3/sessions/${sid}/turn`, { action: 'start', chunkMs: 40, durationMs: 60000 }); await sleep(2000);
log('F turn again: live', await live());
await page.click('#session-end-btn'); await sleep(800);
st = await status(sid);
log('G session end: live', await live(), 'wake', await page.textContent('#wake'), 'server turn', st.turn, 'ready-card', await page.$eval('#ready-card', (e) => !e.classList.contains('hidden')));
const t3 = await api(`/api/s3/sessions/${sid}/turn`, { action: 'start', chunkMs: 40, durationMs: 5000 }); await sleep(1500);
log('H turn after session end: live', await live(), 'server turn ended?', !(await status(sid)).turn);
await sleep(4000);
// resume session, reload idle, reload mid-turn
await page.click('#ready-btn'); await sleep(1200);
await page.reload(); await sleep(2500);
log('I reload idle: gUM', await page.evaluate(() => window.__gum), 'live', await live(), 'ready', await page.evaluate(() => window.wl.L.ready));
await page.click('#ready-btn'); await sleep(1200);
await api(`/api/s3/sessions/${sid}/turn`, { action: 'start', chunkMs: 40, durationMs: 60000 }); await sleep(2000);
await page.reload(); await sleep(2500);
st = await status(sid);
log('J reload mid-turn: gUM new page', await page.evaluate(() => window.__gum), 'live', await live(), 'server turn', st.turn, 'last', st.results.at(-1)?.reason);
// hidden mid-turn
await page.click('#ready-btn'); await sleep(1200);
await api(`/api/s3/sessions/${sid}/turn`, { action: 'start', chunkMs: 40, durationMs: 60000 }); await sleep(2000);
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await sleep(800); st = await status(sid);
log('K hidden mid-turn: live', await live(), 'server turn', st.turn ? 'active' : 'ended', 'last', st.results.at(-1)?.reason);
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
await sleep(1500);
log('   visible again: live', await live(), 'mic', await page.textContent('#mic'));
const tel = await api(`/api/sessions/${sid}/telemetry.json`);
const kinds = {}; for (const r of tel) if (r.kind === 'phone-event') kinds[r.p_k] = (kinds[r.p_k] || 0) + 1;
log('L phone events at server:', JSON.stringify(kinds));
log('   leave rows:', JSON.stringify(tel.filter((r) => r.kind === 'leave' || r.kind === 'turn-lost-by-rejoin' || r.kind === 'old-socket-closed').map((r) => [r.kind, r.reason, r.code])));
st = await status(sid);
log('M audit:', JSON.stringify({ ...st.micAudit, offAfterEndMs: st.micAudit.offAfterEndMs }));
await browser.close();
