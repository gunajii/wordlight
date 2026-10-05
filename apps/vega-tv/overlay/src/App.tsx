// WordLight TV (Vega OS, React Native for Vega).
//   Home: story shelf + "Pair a phone to read aloud" QR (the phone page needs no app install).
//   Story: narration with word highlighting; Your Turn lines read aloud into the paired phone (StoryPlayer).
//   End card: words read tonight — on your own / with help — from real line results; parent summary from the server.
// Dev tools kept: S1 timing player (driven by tools/s1-run via /api/config) and the Devanagari check (Down on Home).
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { totals } from './vendor/tv-core/index';
import { SERVER_URL, SERVER_CANDIDATES, AUDIO_FILE, LEAD_MS } from './wordlight.config';
import { log, logKey, findServer, fetchConfig, withTimeout, type Run } from './net';
import { TvSession } from './session';
import { StoryPlayer, type LineResult } from './StoryPlayer';
import { Player as S1Player, FontCheck, type Story } from './S1Player';
import { useDevanagariFont } from './fonts';

type ShelfItem = { id: string; title: string; lang: string; cover: string | null; attribution: string; turns: number };
type Screen = { name: 'home' } | { name: 'story'; story: Story } | { name: 'end'; story: Story; results: LineResult[] } | { name: 's1'; run: Run; key: string } | { name: 'fonts' };

export const App = () => {
  const [base, setBase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaBase, setMediaBase] = useState<string | null>(null);
  const [shelf, setShelf] = useState<ShelfItem[]>([]);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [, force] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const session = useRef<TvSession | null>(null);
  const fontReady = useDevanagariFont();
  const baselineRunId = useRef<string | undefined | null>(null);

  useEffect(() => {
    (async () => {
      const b = await findServer();
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
      setMediaBase((m) => (m === cfg.mediaBase ? m : cfg.mediaBase));
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
      setSummary(null);
      setScreen({ name: 'story', story: st });
    } catch (e: any) { log(`open ${id}: ${e?.message ?? e}`); }
  }

  useTVEventHandler((evt: any) => {
    logKey(screen.name, evt);
    if (evt?.eventKeyAction !== 0) return;
    if (screen.name === 'home' && evt.eventType === 'down' && shelf.length === 0) setScreen({ name: 'fonts' });
    else if (screen.name === 'fonts' && (evt.eventType === 'back' || evt.eventType === 'up')) setScreen({ name: 'home' });
    else if (screen.name === 'end' && ['select', 'kpenter', 'enter', 'back'].includes(evt.eventType)) setScreen({ name: 'home' });
  });

  if (error) return <View style={s.root}><Text style={s.err}>{error}</Text><Text style={s.hint}>Is `npm start` running on the Mac? Then restart this app.</Text></View>;
  if (!base) return <View style={s.root}><Text style={s.hint}>Finding the WordLight server…</Text></View>;
  if (screen.name === 'fonts') return <FontCheck fontReady={fontReady} />;
  if (screen.name === 's1') return <S1PlayerLoader base={base} mediaBase={mediaBase} run={screen.run} k={screen.key} fontReady={fontReady} onExit={() => setScreen({ name: 'home' })} />;
  if (screen.name === 'story' && mediaBase && session.current) {
    return <StoryPlayer story={screen.story} mediaBase={mediaBase} session={session.current} leadMs={LEAD_MS}
      onEnd={(results) => { session.current?.send({ t: 'session.end' }); setScreen({ name: 'end', story: screen.story, results }); }} />;
  }
  if (screen.name === 'end') {
    const t = totals(screen.results);
    return (
      <View style={s.root}>
        <Text style={s.endBig}>{t.words > 0 ? `You read ${t.words} word${t.words === 1 ? '' : 's'}!` : 'The end'}</Text>
        {t.words > 0 ? <Text style={s.endSub}>{t.onOwn} on your own{t.withHelp ? ` · ${t.withHelp} with help` : ''}</Text> : <Text style={s.endSub}>Pair a phone next time to read some lines yourself.</Text>}
        {summary ? <Text style={s.hint}>Sent to the phone: “{summary}”</Text> : null}
        <Text style={s.credit}>{screen.story.credits.attribution}</Text>
        <Text style={s.hint}>OK: back to stories</Text>
      </View>
    );
  }
  const sess = session.current;
  const readers = sess?.readers ?? [];
  return (
    <View style={s.homeRoot}>
      <View style={s.left}>
        <Text style={s.brand}>WordLight</Text>
        <Text style={s.tag}>Listen to a story. Then read it yourself.</Text>
        <View style={s.shelf}>
          {shelf.length === 0 ? <Text style={s.hint}>No stories yet on the server.</Text> : shelf.map((it, i) => (
            <TouchableOpacity key={it.id} hasTVPreferredFocus={i === 0} style={s.card} onPress={() => openStory(it.id)}>
              {mediaBase && it.cover ? <Image source={{ uri: `${mediaBase}/content/stories/${it.id}/${it.cover}` }} style={s.cardImg} /> : <View style={s.cardImg} />}
              <Text style={s.cardTitle}>{it.title}</Text>
              <Text style={s.cardMeta}>{it.lang === 'hi-IN' ? 'हिंदी' : 'English'} · {it.turns} reading turns</Text>
            </TouchableOpacity>
          ))}
        </View>
        {!mediaBase ? <Text style={s.err}>No https media address — start tools/dev-tunnel/dev-tunnel.sh on the Mac.</Text> : null}
      </View>
      <View style={s.right}>
        <Text style={s.pairTitle}>Pair a phone to read aloud</Text>
        {sess?.id && mediaBase ? <Image source={{ uri: `${mediaBase}/api/sessions/${sess.id}/qr.png?size=360` }} style={s.qr} /> : <View style={s.qr} />}
        <Text style={s.code}>{sess?.id ? `code ${sess.id}` : 'starting…'}</Text>
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101820', alignItems: 'center', justifyContent: 'center', padding: 40 },
  homeRoot: { flex: 1, backgroundColor: '#101820', flexDirection: 'row', padding: 56 },
  left: { flex: 2, justifyContent: 'center' },
  right: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17222e', borderRadius: 24, padding: 28, marginLeft: 40 },
  brand: { color: '#ffd166', fontSize: 72, fontWeight: '700' },
  tag: { color: '#cfe3f5', fontSize: 30, marginTop: 6, marginBottom: 30 },
  shelf: { flexDirection: 'row', flexWrap: 'wrap' },
  card: { width: 380, backgroundColor: '#1d2b3a', borderRadius: 16, padding: 14, marginRight: 24, marginBottom: 24, borderWidth: 4, borderColor: '#ffd166' },
  cardImg: { width: 348, height: 196, borderRadius: 8, backgroundColor: '#0c131a' },
  cardTitle: { color: '#fff', fontSize: 30, marginTop: 10 },
  cardMeta: { color: '#9fb3c8', fontSize: 20, marginTop: 4 },
  pairTitle: { color: '#fff', fontSize: 30, fontWeight: '700', textAlign: 'center', marginBottom: 16 },
  qr: { width: 300, height: 300, backgroundColor: '#fff', borderRadius: 8 },
  code: { color: '#ffd166', fontSize: 26, marginTop: 12 },
  reader: { color: '#5dd39e', fontSize: 26, marginTop: 10 },
  small: { color: '#9fb3c8', fontSize: 18, marginTop: 14, textAlign: 'center' },
  hint: { color: '#9fb3c8', fontSize: 24, marginTop: 24, textAlign: 'center' },
  err: { color: '#ff9f80', fontSize: 24, marginTop: 16 },
  endBig: { color: '#ffd166', fontSize: 80, fontWeight: '700' },
  endSub: { color: '#ffffff', fontSize: 40, marginTop: 12 },
  credit: { color: '#8fa3b8', fontSize: 18, marginTop: 30 },
});
export default App;
