// Server discovery and dev config, shared by every screen.
import { SERVER_URL, SERVER_CANDIDATES, MEDIA_URL } from './wordlight.config';
export const log = (m: string) => console.log(`[wordlight] ${m}`); // vega device start-log-stream
export const logKey = (where: string, evt: any) => log(`key ${where} type=${evt?.eventType} action=${evt?.eventKeyAction}`);
// The Mac's LAN IP changes (DHCP: .35 → .33 → .34 in two days) and a baked IP then means a rebuild. So the app
// tries candidates in order and keeps the first that answers /healthz: the build-time LAN IP, the Mac's
// Bonjour name, and 10.0.2.2 (QEMU's usual host alias — whether the VVD provides it is UNKNOWN until logged).
export let serverUrl = SERVER_URL;
export const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms} ms`)), ms))]);
export async function findServer(): Promise<string | null> {
  const list = [SERVER_URL, ...SERVER_CANDIDATES.filter((u) => u !== SERVER_URL)];
  for (let round = 0; round < 3; round++) {
    for (const u of list) {
      try {
        const r = await withTimeout(fetch(`${u}/healthz`), 2500);
        if (r.ok) { serverUrl = u; log(`server ${u} (round ${round})`); return u; }
      } catch (e: any) { log(`server ${u} unreachable: ${e?.message ?? e}`); }
    }
  }
  return null;
}
// Vega's media player refuses http:// sources (VVD log: "isUriSchemeSecure Got an insecure protocol/scheme
// http, return error", MPB code 50004 → MediaError 4). story.json comes from SERVER_URL (fetch allows http);
// audio and images come from an https base resolved at RUNTIME from the dev server (/api/config, kept current by
// tools/dev-tunnel/dev-tunnel.sh), so a new tunnel URL needs no rebuild. The baked MEDIA_URL is the fallback
// (for a fixed https host such as CloudFront).
export type Run = { runId?: string; audioFile: string; leadMs: number; autorun?: boolean };
export type DevConfig = { mediaBase: string | null; run: Partial<Run>; readingMode: 'free' | 'echo'; simulated: boolean };
export async function fetchConfig(): Promise<DevConfig> {
  let mediaBase: string | null = MEDIA_URL.startsWith('https://') && !MEDIA_URL.includes('SET-ME') ? MEDIA_URL : null;
  let run: Partial<Run> = {};
  let readingMode: 'free' | 'echo' = 'free', simulated = false;
  try {
    const cfg = await (await withTimeout(fetch(`${serverUrl}/api/config`), 4000)).json();
    if (typeof cfg?.mediaUrl === 'string' && cfg.mediaUrl.startsWith('https://')) mediaBase = cfg.mediaUrl;
    if (cfg?.run && typeof cfg.run === 'object') run = cfg.run;
    if (cfg?.readingMode === 'echo') readingMode = 'echo';
    simulated = !!cfg?.speech?.simulated; // the server's speech source is a local simulation: say so on screen
  } catch (e: any) { log(`config fetch failed: ${e?.message ?? e}`); }
  return { mediaBase, run, readingMode, simulated };
}
export async function resolveMediaBase(): Promise<string | null> { return (await fetchConfig()).mediaBase; }
