// A framework-free karaoke clock: polls any player that exposes currentTime (seconds) — Vega's W3C AudioPlayer,
// an HTMLMediaElement, a test double — through a PlayheadSampler, and reports a smooth position in ms.
// Why: on a new platform currentTime may update only every few hundred ms; sampling it often and timestamping the
// moment it CHANGES gives an unbiased position between updates (see sampler.ts).
import { PlayheadSampler } from './sampler.ts';

export interface PlayerLike { currentTime: number; paused?: boolean }
export interface ClockOptions {
  player: () => PlayerLike | null;
  /** true while playing; defaults to !player.paused */
  isPlaying?: () => boolean;
  onTick: (positionMs: number) => void;
  pollMs?: number;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (h: any) => void;
}

export function createKaraokeClock(o: ClockOptions): { stop(): void; reset(): void; readonly sampler: PlayheadSampler } {
  const sampler = new PlayheadSampler();
  const now = o.now ?? (() => (globalThis as any).performance?.now?.() ?? Date.now());
  const playing = () => { const p = o.player(); return o.isPlaying ? o.isPlaying() : !!p && p.paused === false; };
  const set = o.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
  const clear = o.clearInterval ?? ((h: any) => clearInterval(h));
  let wasPlaying = false;
  const h = set(() => {
    const p = o.player(); if (!p) return;
    const t = now(), pl = playing();
    if (pl !== wasPlaying) { sampler.reset(); wasPlaying = pl; }
    sampler.sample((p.currentTime ?? 0) * 1000, t, pl);
    o.onTick(sampler.positionAt(t, pl) ?? 0);
  }, o.pollMs ?? 20);
  return { stop: () => clear(h), reset: () => sampler.reset(), sampler };
}
