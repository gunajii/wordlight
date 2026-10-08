// Health check for a deployed WordLight server — the path child audio would take must be real before any child
// session:  node tools/ops/healthcheck.ts https://<ip-with-dashes>.sslip.io
// Checks: HTTPS with a valid certificate, /healthz, speech source is REAL (not the scripted simulation), WebSocket
// (WSS) hello → welcome, round-trip time, and that the join links/QR point at the same https host (not a tunnel).
import WebSocket from 'ws';
import tls from 'node:tls';

/** Leaf key type and the issuer chain as served (what an embedded device's CA store has to accept). */
export function certChain(host: string): Promise<{ keyType: string; chain: string[]; notBefore: string }> {
  return new Promise((res, rej) => {
    const s = tls.connect({ host, port: 443, servername: host, timeout: 5000 }, () => {
      const leaf: any = s.getPeerCertificate(true);
      const chain: string[] = []; const seen = new Set<string>();
      for (let c: any = leaf; c && !seen.has(c.fingerprint256); c = c.issuerCertificate) { seen.add(c.fingerprint256); chain.push(c.subject?.CN ?? c.subject?.O ?? '?'); if (c.issuerCertificate === c) break; }
      const keyType = leaf.asn1Curve || leaf.nistCurve ? `EC ${leaf.nistCurve ?? leaf.asn1Curve}` : leaf.bits ? `RSA ${leaf.bits}` : 'unknown';
      s.end(); res({ keyType, chain: [...chain, `(issuer: ${leaf.issuer?.CN ?? '?'} … root as trusted locally)`], notBefore: leaf.valid_from });
    });
    s.on('error', rej); s.on('timeout', () => { s.destroy(); rej(new Error('TLS timeout')); });
  });
}

const url = (process.argv[2] ?? '').replace(/\/$/, '');
if (!/^https:\/\//.test(url)) { console.error('usage: node tools/ops/healthcheck.ts https://host'); process.exit(2); }
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => { results.push([name, ok, detail]); console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
try {
  const t0 = performance.now();
  const h = await (await fetch(`${url}/healthz`)).json(); // fetch fails on an invalid certificate
  check('https + certificate + /healthz', h.ok === true, `${Math.round(performance.now() - t0)} ms`);
  try {
    const c = await certChain(new URL(url).hostname);
    // RSA leaves chain to ISRG Root X1 (Let's Encrypt), present on all devices we know of; ECDSA leaves may chain
    // to ISRG Root X2, which the Vega Virtual Device rejected (curl error 60, 2026-10-08).
    check('certificate an embedded TV will accept (RSA key)', c.keyType.startsWith('RSA'), `${c.keyType} · ${c.chain.join(' ← ')} · valid from ${c.notBefore}`);
  } catch (e: any) { check('certificate details', false, e?.message ?? String(e)); }
  const cfg = await (await fetch(`${url}/api/config`)).json();
  check('speech recognition is real (not simulated)', cfg?.speech?.simulated === false && cfg?.speech?.source === 'transcribe', JSON.stringify(cfg?.speech));
  check('media URL is this host (https)', typeof cfg.mediaUrl === 'string' && cfg.mediaUrl.replace(/\/$/, '') === url, String(cfg.mediaUrl));
  const s = await (await fetch(`${url}/api/sessions`, { method: 'POST' })).json();
  check('join link uses this host (not a dev tunnel)', typeof s.joinUrl === 'string' && s.joinUrl.startsWith(url + '/j/') && !/trycloudflare|ngrok/.test(s.joinUrl), s.joinUrl);
  const ws = new WebSocket(url.replace(/^https/, 'wss') + '/ws');
  const welcome = await new Promise<any>((res, rej) => {
    const t = setTimeout(() => rej(new Error('no welcome in 5 s')), 5000);
    ws.on('open', () => { const c0 = performance.now(); ws.send(JSON.stringify({ t: 'hello', role: 'tv', sessionId: s.sessionId, clientId: 'healthcheck' })); ws.send(JSON.stringify({ t: 'ping', id: 1, c0 })); });
    ws.on('message', (d) => { const m = JSON.parse(d.toString()); if (m.t === 'pong') { clearTimeout(t); res(m); } });
    ws.on('error', rej);
  });
  check('WSS hello + clock ping', !!welcome, `rtt ${Math.round(performance.now() - welcome.c0)} ms`);
  ws.close();
} catch (e: any) { check('reachable', false, e?.message ?? String(e)); }
process.exit(results.every((r) => r[1]) ? 0 : 1);
