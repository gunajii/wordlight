// What to do with the session socket when the phone page comes back (pure, unit-tested).
// Field report 2026-10-12: the phone auto-locked mid-story; after unlocking, the page said "connected" but the TV
// still showed "Pair a phone" for the rest of the story. A socket from before a lock is usually already dropped by
// the server (5 s without a message), yet can still look open on the phone, and the client's own silence watchdog
// may not have counted the time the phone slept. So: after being hidden for a few seconds, or after a back/forward
// cache restore, always reconnect; the new hello makes the server tell the TV that the reader is back.
// Times are wall-clock (Date.now): a monotonic page clock may stand still while the phone sleeps.
export const RESUME_RECONNECT_AFTER_MS = 3000;

/** @returns {'reconnect' | 'none'} */
export function resumeAction({ event, hiddenAtMs = null, nowMs, persisted = false, status = 'open' }) {
  if (event === 'pageshow') return persisted ? 'reconnect' : 'none';
  if (event === 'online') return status === 'open' ? 'none' : 'reconnect';
  if (event === 'visible') return hiddenAtMs !== null && nowMs - hiddenAtMs >= RESUME_RECONNECT_AFTER_MS ? 'reconnect' : 'none';
  return 'none';
}
