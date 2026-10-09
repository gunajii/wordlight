// WordLight TV (Vega OS, React Native for Vega).
//   Home: story shelf + "Pair a phone to read aloud" QR (the phone page needs no app install).
//   Story: narration with word highlighting; Your Turn lines read aloud into the paired phone (StoryPlayer).
//   End card: words read tonight — on your own / with help / skipped, turns, time — from real line results; the
//   parent summary from the server. Everything works with the remote alone (D-pad, OK, Back).
// Dev tools kept: S1 timing player (driven by tools/s1-run via /api/config) and the Devanagari check (Down on Home).
// A server whose speech recognition is a local simulation is labelled on every screen (SIMULATED SPEECH).
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, Dimensions } from 'react-native';
import { useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { totals, formatDuration, playableStoryProblem, childText, type ReadingMode } from './vendor/tv-core/index';
import { SERVER_URL, SERVER_CANDIDATES, AUDIO_FILE, LEAD_MS } from './wordlight.config';
import { log, logKey, findServer, fetchConfig, withTimeout, type Run } from './net';
import { TvSession } from './session';
import { StoryPlayer, type LineResult, type EndInfo } from './StoryPlayer';
import { Player as S1Player, FontCheck, type Story } from './S1Player';
import { useDevanagariFont } from './fonts';

type ShelfItem = { id: string; title: string; lang: string; cover: string | null; attribution: string; turns: number; test?: boolean };
type Screen = { name: 'home' } | { name: 'story'; story: Story } | { name: 'end'; story: Story; results: LineResult[]; info: EndInfo } | { name: 's1'; run: Run; key: string } | { name: 'fonts' };

export const App = () => {
  const [base, setBase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaBase, setMediaBase] = useState<string | null>(null);
  const [shelf, setShelf] = useState<ShelfItem[]>([]);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [, force] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const [mode, setMode] = useState<ReadingMode>('free');
  const [simulated, setSimulated] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [error2, setError2] = useState<string | null>(null); // a story that could not be opened (home stays usable)
  const session = useRef<TvSession | null>(null);
  const fontReady = useDevanagariFont();
  useEffect(() => { log(`device clock ${new Date().toISOString()} (a clock behind the server certificate's start breaks HTTPS)`); const w = Dimensions.get('window'); log(`screen ${w.width}×${w.height} dp, scale ${w.scale} (layout sized for 960×540)`); }, []);
  const baselineRunId = useRef<string | undefined | null>(null);

  useEffect(() => {
    (async () => {
      // Keep trying for ~60 s: right after the (virtual) device boots its network/DNS may not be up yet
      // (2026-10-09: curl error 6, "could not resolve host", at first launch after a Virtual Device restart).
      let b: string | null = null;
      for (let i = 0; i < 20 && !b; i++) { b = await findServer(); if (!b) await new Promise<void>((r) => setTimeout(() => r(), 3000)); }
      if (!b) { setError(`No WordLight server answered: ${[SERVER_URL, ...SERVER_CANDIDATES].join(' · ')}`); return; }
      setBase(b);
      try { setShelf(await (await withTimeout(fetch(`${b}/api/stories`), 6000)).json()); } catch (e: any) { log(`shelf: ${e?.message ?? e}`); }
      const s = new TvSession(() => force((n) => n + 1));
      session.current = s;
      s.on((m: any) => { if (m?.type === 'session.summary') setSummary(m.text); });
      s.start(b).catch((e) => setError(`Could not start a session: ${e?.message ?? e}`));
    })();
  }, []);

  // media base (https) + S1 dev run control, polled
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const cfg = await fetchConfig();
      if (!alive) return;
      if (!cfg.ok) return; // keep the last good config; never take a baseline from a failed fetch (a stale S1 run auto-started)
      setMediaBase((m) => (m === cfg.mediaBase ? m : cfg.mediaBase));
      setMode(cfg.readingMode); setSimulated(cfg.simulated);
      const id = cfg.run.runId;
      if (baselineRunId.current === null) { baselineRunId.current = id; return; }
      if (id && id !== baselineRunId.current && cfg.run.autorun) {
        baselineRunId.current = id;
        setScreen({ name: 's1', key: id, run: { runId: id, audioFile: cfg.run.audioFile ?? AUDIO_FILE, leadMs: cfg.run.leadMs ?? LEAD_MS, autorun: true } });
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function openStory(id: string) {
    if (!base) return;
    try {
      const st: Story = await (await withTimeout(fetch(`${base}/content/stories/${id}/story.json`), 8000)).json();
      const bad = playableStoryProblem(st);
      if (bad) { log(`refusing story ${id}: ${bad}`); setError2(`This story can’t be opened (${bad}). Choose another one.`); return; }
      setError2(null);
      setSummary(null);
      setScreen({ name: 'story', story: st });
    } catch (e: any) { log(`open ${id}: ${e?.message ?? e}`); setError2('This story didn’t load. Check the connection and try again.'); }
  }

  useTVEventHandler((evt: any) => {
    logKey(screen.name, evt);
    if (evt?.eventKeyAction !== 0) return;
    if (screen.name === 'home' && evt.eventType === 'down' && shelf.length === 0) setScreen({ name: 'fonts' });
    else if (screen.name === 'fonts' && (evt.eventType === 'back' || evt.eventType === 'up')) setScreen({ name: 'home' });
    else if (screen.name === 'end' && evt.eventType === 'back') setScreen({ name: 'home' });
  });

  if (error) return <View style={s.root}><Text style={s.err}>{error}</Text><Text style={s.hint}>{/^https:/.test(SERVER_URL) ? `This device's clock says ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. If that is wrong, HTTPS certificates look invalid: restart the device (Virtual Device: vega virtual-device stop, then start). Otherwise check the server (node tools/ops/healthcheck.ts) and .dev/tv-app.log.` : 'Is `npm start` running on the Mac? Then restart this app.'}</Text></View>;
  if (!base) return <View style={s.root}><Text style={s.hint}>Finding the WordLight server…</Text></View>;
  if (screen.name === 'fonts') return <FontCheck fontReady={fontReady} />;
  if (screen.name === 's1') return <S1PlayerLoader base={base} mediaBase={mediaBase} run={screen.run} k={screen.key} fontReady={fontReady} onExit={() => setScreen({ name: 'home' })} />;
  if (screen.name === 'story' && mediaBase && session.current) {
    return <StoryPlayer story={screen.story} mediaBase={mediaBase} session={session.current} leadMs={LEAD_MS} mode={mode} simulated={simulated} fontReady={fontReady}
      onEnd={(results, info) => { session.current?.send({ t: 'session.end', storyId: screen.story.id, storyTitle: screen.story.title, completed: info.completed, durationMs: info.durationMs }); setScreen({ name: 'end', story: screen.story, results, info }); }} />;
  }
  if (screen.name === 'end') {
    const t = totals(screen.results);
    const E = childText(screen.story.lang).end;
    const hf = screen.story.lang === 'hi-IN' && fontReady ? { fontFamily: 'NotoSansDevanagari-Regular' } : null;
    return (
      <View style={s.root}>
        {simulated ? <Text style={s.sim}>SIMULATED SPEECH · local demo — not real recognition</Text> : null}
        <Text style={[s.endBig, hf]}>{t.words > 0 ? E.title : screen.info.completed ? E.theEnd : E.seeYou}</Text>
        {t.words > 0 ? <Text style={[s.endSub, hf]}>{E.wordsAloud(t.words)}</Text> : null}
        {t.words > 0 ? (
          <View style={s.statRow}>
            <View style={s.stat}><Text style={[s.statNum, { color: '#5dd39e' }]}>{t.onOwn}</Text><Text style={[s.statLbl, hf]}>{E.onOwn(t.onOwn)}</Text></View>
            <View style={s.stat}><Text style={[s.statNum, { color: '#ffb347' }]}>{t.withHelp}</Text><Text style={[s.statLbl, hf]}>{E.withHelp}</Text></View>
            <View style={s.stat}><Text style={s.statNum}>{t.turns}</Text><Text style={[s.statLbl, hf]}>{E.turns(t.turns)}</Text></View>
          </View>
        ) : <Text style={[s.endSub, hf]}>{E.pairNext}</Text>}
        <Text style={s.hint}>{screen.story.title} · {screen.info.completed ? 'story finished' : 'stopped early'} · {formatDuration(screen.info.durationMs)}{t.skipped ? ` · ${t.skipped} word${t.skipped === 1 ? '' : 's'} skipped` : ''}</Text>
        {summary ? <Text style={s.summary}>For the parent: “{summary}”</Text> : null}
        <TouchableOpacity hasTVPreferredFocus activeOpacity={1} style={[s.btn, focused === 'end' && s.btnFocus]} onFocus={() => setFocused('end')} onBlur={() => setFocused(null)} onPress={() => setScreen({ name: 'home' })}>
          <Text style={s.btnText}>Back to stories</Text>
        </TouchableOpacity>
        <Text style={s.credit}>{screen.story.credits.attribution}</Text>
      </View>
    );
  }
  const sess = session.current;
  const readers = sess?.readers ?? [];
  return (
    <View style={s.homeRoot}>
      <View style={s.left}>
        <Text style={s.brand}>WordLight</Text>
        <Text style={s.tag}>{mode === 'echo' ? 'Listen to a story. Then say it yourself.' : 'Listen to a story. Then read it yourself.'}</Text>
        {simulated ? <Text style={s.sim}>SIMULATED SPEECH · local demo — not real recognition</Text> : null}
        <View style={s.shelf}>
          {shelf.length === 0 ? <Text style={s.hint}>No stories yet on the server.</Text> : shelf.map((it, i) => (
            <TouchableOpacity key={it.id} hasTVPreferredFocus={i === 0} activeOpacity={1} style={[s.card, focused === it.id && s.cardFocus]} onFocus={() => setFocused(it.id)} onBlur={() => setFocused((f) => (f === it.id ? null : f))} onPress={() => openStory(it.id)}>
              {mediaBase && it.cover ? <Image source={{ uri: `${mediaBase}/content/stories/${it.id}/${it.cover}` }} style={s.cardImg} /> : <View style={s.cardImg} />}
              <Text style={s.cardTitle}>{it.title}</Text>
              <Text style={s.cardMeta}>{it.lang === 'hi-IN' ? 'हिंदी' : 'English'} · {it.turns} reading turn{it.turns === 1 ? '' : 's'}{it.test ? ' · test story' : ''}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {error2 ? <Text style={s.err}>{error2}</Text> : null}
        {!mediaBase ? <Text style={s.err}>No https media address — start tools/dev-tunnel/dev-tunnel.sh on the Mac.</Text> : null}
      </View>
      <View style={s.right}>
        <Text style={s.pairTitle}>Pair a phone to read aloud</Text>
        {sess?.id && mediaBase ? <Image source={{ uri: `${mediaBase}/api/sessions/${sess.id}/qr.png?size=360` }} style={s.qr} /> : <View style={s.qr} />}
        <Text style={s.code}>{sess?.id ? `code ${sess.id}` : 'starting…'}</Text>
        <Text style={[s.small, { color: sess?.status === 'open' ? '#5dd39e' : '#ff9f80' }]}>{sess?.status === 'open' ? '● connected' : `○ ${sess?.status ?? 'connecting'}`}</Text>
        {readers.length === 0 ? <Text style={s.small}>Scan with the phone camera. No app needed.</Text> : readers.map((r) => (
          <Text key={r.readerId} style={s.reader}>{r.online ? '●' : '○'} {r.firstName}{r.online ? ' is ready to read' : ' (phone away)'}</Text>
        ))}
        <Text style={s.small}>The phone’s microphone is only on during a reading turn.</Text>
      </View>
    </View>
  );
};

/** S1 dev tool: loads the timing test story and hands it to the S1 player. */
function S1PlayerLoader({ base, mediaBase, run, k, fontReady, onExit }: { base: string; mediaBase: string | null; run: Run; k: string; fontReady: boolean; onExit: () => void }) {
  const [story, setStory] = useState<Story | null>(null);
  useEffect(() => { fetch(`${base}/content/stories/s1-timing/story.json`).then((r) => r.json()).then(setStory).catch(() => {}); }, [k]);
  if (!story) return <View style={s.root}><Text style={s.hint}>Loading S1…</Text></View>;
  return <S1Player key={k} story={story} fontReady={fontReady} mediaBase={mediaBase} audioFile={run.audioFile} leadMs={run.leadMs} autoplay={!!run.autorun} onExit={onExit} />;
}

// Sizes are for the screen the Vega Virtual Device reports to the app: 960×540 dp (measured from a screen recording;
// the earlier 1920×1080 sizes overflowed the home and end screens). TouchableOpacity gets activeOpacity={1}: on
// Vega the focused item is shown at activeOpacity, which made the focused card look disabled.
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101820', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 20 },
  homeRoot: { flex: 1, backgroundColor: '#101820', flexDirection: 'row', padding: 28 },
  left: { flex: 2, justifyContent: 'center' },
  right: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17222e', borderRadius: 16, padding: 16, marginLeft: 24 },
  brand: { color: '#ffd166', fontSize: 44, fontWeight: '700' },
  tag: { color: '#cfe3f5', fontSize: 19, marginTop: 2, marginBottom: 18 },
  shelf: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { width: 262, backgroundColor: '#1d2b3a', borderRadius: 12, padding: 8, marginRight: 16, marginBottom: 16, borderWidth: 3, borderColor: '#2a3a4c' },
  cardFocus: { borderColor: '#ffd166', backgroundColor: '#24364a', transform: [{ scale: 1.05 }] },
  sim: { color: '#fff', backgroundColor: '#8a1c1c', fontSize: 13, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 10, alignSelf: 'flex-start' },
  statRow: { flexDirection: 'row', marginTop: 10 },
  stat: { alignItems: 'center', marginHorizontal: 28 },
  statNum: { color: '#fff', fontSize: 52, fontWeight: '700' },
  statLbl: { color: '#cfe3f5', fontSize: 17 },
  summary: { color: '#ffffff', fontSize: 16, marginTop: 10, textAlign: 'center', maxWidth: 780 },
  btn: { marginTop: 14, backgroundColor: '#1d2b3a', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 8, borderWidth: 3, borderColor: '#2a3a4c' },
  btnFocus: { borderColor: '#ffd166', backgroundColor: '#24364a' },
  btnText: { color: '#fff', fontSize: 20 },
  cardImg: { width: 240, height: 135, borderRadius: 6, backgroundColor: '#0c131a' },
  cardTitle: { color: '#fff', fontSize: 20, marginTop: 6 },
  cardMeta: { color: '#9fb3c8', fontSize: 14, marginTop: 2 },
  pairTitle: { color: '#fff', fontSize: 19, fontWeight: '700', textAlign: 'center', marginBottom: 10 },
  qr: { width: 170, height: 170, backgroundColor: '#fff', borderRadius: 6 },
  code: { color: '#ffd166', fontSize: 18, marginTop: 8 },
  reader: { color: '#5dd39e', fontSize: 17, marginTop: 6, textAlign: 'center' },
  small: { color: '#9fb3c8', fontSize: 13, marginTop: 8, textAlign: 'center' },
  hint: { color: '#9fb3c8', fontSize: 16, marginTop: 12, textAlign: 'center' },
  err: { color: '#ff9f80', fontSize: 18, marginTop: 10 },
  endBig: { color: '#ffd166', fontSize: 44, fontWeight: '700' },
  endSub: { color: '#ffffff', fontSize: 22, marginTop: 4 },
  credit: { color: '#8fa3b8', fontSize: 11, lineHeight: 14, marginTop: 12, textAlign: 'center', maxWidth: 860 },
});
export default App;
