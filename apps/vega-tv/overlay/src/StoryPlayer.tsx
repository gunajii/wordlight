// The WordLight story player: narration with word highlighting, and Your Turn lines read by the child into the
// paired phone. The TV's turn logic is the pure state machine in tv-core (unit-tested); this file wires it to the
// audio player, the session socket and the screen.
//
//   narration reaches a turn line → pause → turn.start → phone mic → server (Transcribe + reading engine)
//   → word.read / word.helped (TV replays that word from the narration) → line.done → resume narration
// Without an online reader, turn lines are simply narrated. Nothing on screen ever says "wrong".
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { AudioPlayer } from '@amazon-devices/react-native-w3cmedia';
import { useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { PlayheadSampler, lineIndexAt, phasesAt } from './vendor/karaoke-core/index';
import { idle, turnReduce, nextTurn, resumeAt, helpSpan, lineStart, type TurnState, type TurnEvent } from './vendor/tv-core/index';
import { log, logKey } from './net';
import type { TvSession } from './session';
import type { Story } from './S1Player';

declare const performance: { now(): number };
export type LineResult = { read: number; helped: number; skipped: number; durationMs: number; storyId: string; page: number; line: number };
const POLL_MS = 20;
const ACTIVE = ['TURN_START', 'LISTENING', 'READING', 'HELP'];

export function StoryPlayer({ story, mediaBase, session, leadMs, onEnd }: {
  story: Story; mediaBase: string; session: TvSession; leadMs: number; onEnd: (results: LineResult[]) => void;
}) {
  const [pageIdx, setPageIdx] = useState(0);
  const page = story.pages[pageIdx];
  const lines = page.lines;
  const player = useRef<AudioPlayer | null>(null);
  const sampler = useRef(new PlayheadSampler());
  const playing = useRef(false);
  const [view, setView] = useState({ line: 0, pos: 0 });
  const [turn, setTurn] = useState<TurnState>(idle());
  const turnRef = useRef<TurnState>(idle());
  const turnLine = useRef<number | null>(null);
  const turnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneTurns = useRef(new Set<number>());
  const results = useRef<LineResult[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const outLatency = Math.max(0, -leadMs); // audio is heard this much after currentTime (S1, VVD)

  const dispatch = (e: TurnEvent) => {
    const r = turnReduce(turnRef.current, e);
    if (r.rejected) log(`turn: ${r.rejected}`);
    turnRef.current = r.state;
    setTurn(r.state);
    return r.state;
  };
  const say = (t: string, ms = 2200) => { setToast(t); setTimeout(() => setToast((x) => (x === t ? null : x)), ms); };
  const play = () => { const r: any = player.current?.play(); r?.catch?.((e: any) => log(`play rejected ${e?.message ?? e}`)); };
  const pause = () => { try { player.current?.pause(); } catch {} };
  const seekMs = (ms: number) => { if (player.current) { player.current.currentTime = Math.max(0, ms / 1000); sampler.current.reset(); } };

  // ---- audio player per page ----
  useEffect(() => {
    doneTurns.current = new Set();
    const p = new AudioPlayer();
    player.current = p;
    const on = (ev: string, fn: () => void) => p.addEventListener(ev as any, fn as any);
    on('playing', () => { playing.current = true; sampler.current.reset(); });
    on('pause', () => { playing.current = false; sampler.current.reset(); });
    on('seeking', () => sampler.current.reset());
    let started = false;
    on('canplay', () => { if (!started) { started = true; log(`page ${pageIdx + 1} ready`); play(); } });
    on('error', () => log(`player error ${JSON.stringify({ code: (p as any).error?.code })} page ${pageIdx}`));
    on('ended', () => {
      playing.current = false;
      if (ACTIVE.includes(turnRef.current.phase)) return;
      if (pageIdx + 1 < story.pages.length) setPageIdx(pageIdx + 1);
      else onEnd(results.current);
    });
    p.initialize().then(() => { p.autoplay = false; p.src = `${mediaBase}/content/stories/${story.id}/${page.audio}`; }).catch((e: any) => log(`initialize failed ${e?.message ?? e}`));
    return () => { try { p.pause(); } catch {} p.deinitialize().catch(() => {}); };
  }, [pageIdx]);

  // ---- narration clock: highlight words; stop at Your Turn lines ----
  useEffect(() => {
    const id = setInterval(() => {
      const p = player.current;
      if (!p) return;
      const now = performance.now();
      sampler.current.sample((p.currentTime ?? 0) * 1000, now, playing.current);
      const pos = sampler.current.positionAt(now, playing.current) ?? 0;
      if (turnRef.current.phase !== 'LISTEN') return;
      if (playing.current) {
        const nt = nextTurn(page, pos, doneTurns.current);
        if (nt && pos >= nt.stopAtMs) { beginTurn(nt.index); return; }
      }
      const li = lineIndexAt(lines, pos + leadMs);
      setView((v) => (v.line === li && Math.abs(v.pos - pos) < 15 ? v : { line: li, pos }));
    }, POLL_MS);
    return () => clearInterval(id);
  }, [pageIdx]);

  function beginTurn(i: number) {
    const reader = session.onlineReader();
    if (!reader) { doneTurns.current.add(i); say('Pair a phone to read this line yourself next time'); return; } // narrate it
    pause();
    const line = lines[i];
    const turnId = `${story.id}-${pageIdx}-${i}-${Date.now().toString(36)}`;
    turnLine.current = i;
    dispatch({ type: 'begin', turnId, readerName: reader.firstName, words: line.words.map((w) => w.w) });
    session.send({ type: 'turn.start', turnId, readerId: reader.readerId, storyId: story.id, page: pageIdx, line: i, words: line.words.map((w) => w.w), lang: story.lang ?? 'en-IN' });
    log(`turn ${turnId} for ${reader.firstName}`);
    // If the microphone never opens (phone asleep, permission denied without a message), don't hold the story.
    if (turnTimer.current) clearTimeout(turnTimer.current);
    turnTimer.current = setTimeout(() => { if (turnRef.current.turnId === turnId && turnRef.current.phase === 'TURN_START') session.send({ type: 'turn.cancel', turnId, reason: 'timeout' }); }, 15000);
  }

  function finishTurn(narrateLine: boolean) {
    const i = turnLine.current;
    if (turnTimer.current) clearTimeout(turnTimer.current);
    dispatch({ type: 'finish' });
    turnLine.current = null;
    if (i === null) return;
    doneTurns.current.add(i);
    seekMs(narrateLine ? lineStart(lines[i]) - 250 : resumeAt(page, i));
    play();
  }

  function playHelp(index: number) {
    const i = turnLine.current;
    if (i === null) return;
    const span = helpSpan(lines[i], index);
    seekMs(span.fromMs);
    play();
    setTimeout(() => { pause(); if (turnRef.current.phase === 'HELP') dispatch({ type: 'help-done' }); }, span.toMs - span.fromMs + outLatency + 60);
  }

  // ---- live events for this turn ----
  useEffect(() => session.on((m: any) => {
    const t = turnRef.current;
    if (!t.turnId || (m.turnId && m.turnId !== t.turnId)) return;
    switch (m.type) {
      case 'mic.state': if (m.state === 'open') dispatch({ type: 'mic-open' }); break;
      case 'word.read':
        dispatch({ type: 'word-read', index: m.index });
        session.send({ t: 'telemetry', kind: 'word-lit', turnId: t.turnId, index: m.index, tvServerMs: session.serverNow() }); // end-to-end latency
        break;
      case 'word.skipped': dispatch({ type: 'word-skipped', index: m.index }); break;
      case 'word.helped': dispatch({ type: 'word-helped', index: m.index }); playHelp(m.index); break;
      case 'line.done': {
        dispatch({ type: 'line-done', read: m.read, helped: m.helped, skipped: m.skipped, durationMs: m.durationMs });
        results.current.push({ read: m.read, helped: m.helped, skipped: m.skipped, durationMs: m.durationMs, storyId: story.id, page: pageIdx, line: turnLine.current ?? -1 });
        setTimeout(() => finishTurn(false), 1600);
        break;
      }
      case 'turn.cancel':
        dispatch({ type: 'cancel', reason: m.reason });
        say(m.reason === 'skipped' ? 'Let’s listen to this one' : 'Let’s listen together');
        setTimeout(() => finishTurn(true), 1200);
        break;
    }
    if (m.t === 'error' && m.turnId === t.turnId) { dispatch({ type: 'cancel', reason: m.code }); setTimeout(() => finishTurn(true), 800); }
  }), [pageIdx]);

  useTVEventHandler((evt: any) => {
    logKey('story', evt);
    if (evt?.eventKeyAction !== 0) return;
    const t = turnRef.current;
    const active = ACTIVE.includes(t.phase);
    const ok = ['select', 'kpenter', 'enter'].includes(evt.eventType);
    if (active && ok) session.send({ type: 'turn.help', turnId: t.turnId, kind: 'next-word' });
    else if (active && evt.eventType === 'right') session.send({ type: 'turn.cancel', turnId: t.turnId, reason: 'skipped' });
    else if (evt.eventType === 'back') { if (active) session.send({ type: 'turn.cancel', turnId: t.turnId, reason: 'exit' }); pause(); onEnd(results.current); }
    else if (!active && ok) { if (playing.current) pause(); else play(); }
  });

  const reader = session.onlineReader();
  const line = lines[view.line];
  const phases = phasesAt(line.words, view.pos, leadMs);
  const deva = story.lang === 'hi-IN';
  return (
    <View style={st.root}>
      <Image source={{ uri: `${mediaBase}/content/stories/${story.id}/${page.image}` }} style={st.pageImg} resizeMode="contain" />
      <View style={st.readerChip}><Text style={st.readerText}>{reader ? `${reader.firstName} is reading along` : 'Pair a phone on the home screen to read along'}</Text></View>
      {turn.phase === 'LISTEN' ? (
        <View style={st.subtitle}>
          <Text style={[st.line, deva && st.deva]}>
            {line.words.map((w, i) => <Text key={i} style={phases[i] === 'current' ? st.current : phases[i] === 'spoken' ? st.spoken : st.upcoming}>{w.w}{i < line.words.length - 1 ? ' ' : ''}</Text>)}
          </Text>
        </View>
      ) : (
        <View style={st.turnBox}>
          <Text style={st.turnTitle}>{turn.phase === 'DONE' ? 'Well read!' : turn.phase === 'CANCEL' ? 'Let’s listen together' : `${turn.readerName}, your turn`}</Text>
          <Text style={st.mic}>{turn.phase === 'TURN_START' ? '○ getting the microphone ready…' : ['LISTENING', 'READING', 'HELP'].includes(turn.phase) ? '● listening' : '○ microphone off'}</Text>
          <Text style={[st.turnLine, deva && st.deva]}>
            {turn.words.map((w, i) => <Text key={i} style={turn.marks[i] === 'read' ? st.read : turn.marks[i] === 'helped' ? st.helped : turn.marks[i] === 'skipped' ? st.skipped : i === turn.marks.indexOf('pending') ? st.next : st.pending}>{w}{i < turn.words.length - 1 ? ' ' : ''}</Text>)}
          </Text>
          {turn.phase === 'DONE' && turn.result ? <Text style={st.turnSub}>{turn.result.read} on your own{turn.result.helped ? ` · ${turn.result.helped} with help` : ''}</Text> : null}
          {['LISTENING', 'READING', 'HELP'].includes(turn.phase) ? <Text style={st.turnHint}>Stuck? Press OK for the next word · → to listen instead</Text> : null}
        </View>
      )}
      {toast ? <View style={st.toast}><Text style={st.toastText}>{toast}</Text></View> : null}
      <Text style={st.credit}>{story.credits.attribution} · page {pageIdx + 1}/{story.pages.length}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101820' },
  pageImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 200 },
  readerChip: { position: 'absolute', top: 28, left: 32, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 24, paddingHorizontal: 20, paddingVertical: 8 },
  readerText: { color: '#cfe3f5', fontSize: 22 },
  subtitle: { position: 'absolute', bottom: 60, left: 80, right: 80, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 20, paddingVertical: 22, paddingHorizontal: 36 },
  line: { fontSize: 56, textAlign: 'center', color: '#8899aa' },
  deva: { lineHeight: 84 },
  spoken: { color: '#ffffff' },
  current: { color: '#101820', backgroundColor: '#ffd166' },
  upcoming: { color: '#8899aa' },
  turnBox: { position: 'absolute', bottom: 40, left: 60, right: 60, backgroundColor: 'rgba(16,24,32,0.94)', borderRadius: 24, borderWidth: 3, borderColor: '#5dd39e', paddingVertical: 24, paddingHorizontal: 40, alignItems: 'center' },
  turnTitle: { color: '#ffd166', fontSize: 44, fontWeight: '700' },
  mic: { color: '#5dd39e', fontSize: 26, marginTop: 6 },
  turnLine: { fontSize: 64, textAlign: 'center', marginTop: 14, color: '#c9d6e3' },
  pending: { color: '#c9d6e3' },
  next: { color: '#ffffff', textDecorationLine: 'underline' },
  read: { color: '#5dd39e' },
  helped: { color: '#101820', backgroundColor: '#ffb347' },
  skipped: { color: '#6b7a89' },
  turnSub: { color: '#cfe3f5', fontSize: 28, marginTop: 10 },
  turnHint: { color: '#8fa3b8', fontSize: 20, marginTop: 12 },
  toast: { position: 'absolute', top: 28, right: 32, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 16, padding: 14 },
  toastText: { color: '#ffd166', fontSize: 24 },
  credit: { position: 'absolute', bottom: 8, left: 32, color: '#8fa3b8', fontSize: 16 },
});
