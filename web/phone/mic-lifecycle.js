// Microphone lifecycle rules for the WordLight phone page, as a pure state machine (unit-tested).
//
// The microphone may be open ONLY when all of these hold:
//   consent given on this phone · audio unlocked by a tap ("Get ready") · reading session active ·
//   socket connected · page visible · a reading turn from the server is active.
// Anything that breaks one of them closes the microphone AND forgets the turn: a turn never resumes by itself
// (after a reconnect, becoming visible again or a reload, only a NEW turn.start can open the mic).
// The TV's home, shelf, narration and "before Your Turn" states all mean "no turn" here → mic off.

export function initialState(o = {}) {
  return { consent: !!o.consent, ready: false, session: 'active', connected: false, visible: o.visible ?? true, turn: null, last: null };
}

/**
 * @param {ReturnType<typeof initialState>} s
 * @param {{type: string, [k: string]: any}} ev
 * @returns {{ state: ReturnType<typeof initialState>, mic: 'open' | 'closed', stopReason: string | null, rejected: string | null }}
 */
export function reduce(s, ev) {
  const n = { ...s, last: ev.type };
  let rejected = null;
  let endReason = null;
  switch (ev.type) {
    case 'consent': n.consent = true; break;
    case 'ready': n.ready = true; break;
    case 'not-ready': if (n.ready) endReason = 'audio-suspended'; n.ready = false; break; // AudioContext left 'running'
    case 'connected': n.connected = true; break;
    case 'disconnected': n.connected = false; endReason = 'connection-lost'; break;
    case 'hidden': n.visible = false; endReason = 'page-hidden'; break;
    case 'visible': n.visible = true; break;
    case 'unload': endReason = 'page-unload'; break;
    case 'session-end': n.session = 'ended'; endReason = 'session-ended'; break;
    case 'session-start': n.session = 'active'; break;
    case 'turn-start': {
      if (!n.consent) rejected = 'no-consent';
      else if (n.session !== 'active') rejected = 'no-session';
      else if (!n.connected) rejected = 'offline';
      else if (!n.visible) rejected = 'hidden';
      if (!rejected) { if (n.turn && n.turn.turnId !== ev.turnId) endReason = 'replaced'; n.turn = { turnId: ev.turnId, tag: ev.tag ?? 0, chunkMs: ev.chunkMs ?? 40 }; }
      break;
    }
    case 'turn-end':
      if (n.turn && n.turn.turnId === ev.turnId) { n.turn = null; endReason = `turn-ended:${ev.reason ?? 'done'}`; }
      break;
    default: break;
  }
  // any condition failing ends the turn (never resumed)
  if (endReason && ev.type !== 'turn-end' && ev.type !== 'turn-start') n.turn = null;
  const wasOpen = micWanted(s);
  const open = micWanted(n);
  return { state: n, mic: open ? 'open' : 'closed', stopReason: wasOpen && !open ? endReason ?? 'conditions-changed' : (ev.type === 'turn-start' && endReason) ? endReason : null, rejected };
}

export function micWanted(s) {
  return !!(s.consent && s.ready && s.session === 'active' && s.connected && s.visible && s.turn);
}

/** Needs a tap: a turn is active and everything else holds, but audio is not unlocked yet. */
export function needsTap(s) {
  return !!(s.turn && s.consent && s.session === 'active' && s.connected && s.visible && !s.ready);
}
