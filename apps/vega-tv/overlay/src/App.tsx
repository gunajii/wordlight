// WordLight TV — S1 spike build (Vega OS, React Native for Vega).
//
// Proves only: play narration with the W3C media AudioPlayer, read its playback time, render an
// English/Devanagari subtitle line, light each word at its timing, handle the D-pad — and makes
// the timing MEASURABLE: a white marker flashes whenever the lit word changes, so filming the TV
// and running tools/audio-analysis/av_offset.py gives the highlight-vs-audio offset.
//
// Copied into the generated Vega project by apps/vega-tv/setup.sh. Pure timing logic comes from
// packages/karaoke-core (vendored into src/vendor/karaoke-core by setup.sh).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { AudioPlayer } from '@amazon-devices/react-native-w3cmedia';
import { useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { PlayheadSampler, lineIndexAt, phasesAt, wordIndexAt } from './vendor/karaoke-core/index';
import { SERVER_URL, MEDIA_URL, STORY_ID, AUDIO_FILE, LEAD_MS } from './wordlight.config';
// Vega's media player refuses http:// sources (VVD log: "isUriSchemeSecure Got an insecure protocol/scheme
// http, return error", MPB code 50004 → MediaError 4). story.json comes from SERVER_URL (fetch allows http);
// audio and images come from an https base resolved at RUNTIME from the dev server (/api/config, kept current by
// tools/dev-tunnel/dev-tunnel.sh), so a new tunnel URL needs no rebuild. The baked MEDIA_URL is the fallback
// (for a fixed https host such as CloudFront).
async function resolveMediaBase(): Promise<string | null> {
  try {
    const cfg = await (await fetch(`${SERVER_URL}/api/config`)).json();
    if (typeof cfg?.mediaUrl === 'string' && cfg.mediaUrl.startsWith('https://')) return cfg.mediaUrl;
  } catch (e: any) { log(`config fetch failed: ${e?.message ?? e}`); }
  return MEDIA_URL.startsWith('https://') && !MEDIA_URL.includes('SET-ME') ? MEDIA_URL : null;
}
import { useDevanagariFont } from './fonts';

type Word = { w: string; t0: number; t1: number };
type Line = { text: string; words: Word[]; turn: boolean };
type Story = { id: string; title: string; credits: { attribution: string }; pages: { image: string; audio: string; durationMs: number; lines: Line[] }[] };

const POLL_MS = 20;
const log = (m: string) => console.log(`[wordlight] ${m}`); // vega device start-log-stream
// Every remote event is logged so key handling can be checked from the log stream.
const logKey = (where: string, evt: any) => log(`key ${where} type=${evt?.eventType} action=${evt?.eventKeyAction}`);
const PLAY_KEYS = ['select', 'kpenter', 'enter', 'playpause', 'play', 'pause'];
// In the player, OK arrives as 'select' on a remote and 'kpenter' from the VVD/keyboard. The media keys
// (play/pause/playpause) are NOT handled here: Vega's Player Session already acts on them, and handling them
// too made play→pause within 100 ms (VVD log, build 4).

export const App = () => {
  const [story, setStory] = useState<Story | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaBase, setMediaBase] = useState<string | null>(null);
  const [screen, setScreen] = useState<'shelf' | 'player' | 'fonts'>('shelf');
  const fontReady = useDevanagariFont();

  useEffect(() => {
    const url = `${SERVER_URL}/content/stories/${STORY_ID}/story.json`;
    fetch(url).then((r) => r.json()).then((st) => { setStory(st); log(`story ${st.id} loaded`); })
      .catch((e) => setError(`Cannot load ${url}: ${e?.message ?? e}`));
    resolveMediaBase().then((m) => { setMediaBase(m); log(`media base ${m ?? 'NONE (run tools/dev-tunnel/dev-tunnel.sh)'}`); });
  }, []);

  useTVEventHandler((evt: any) => {
    logKey(screen, evt);
    if (evt?.eventKeyAction !== 0) return; // key down only
    if (screen === 'shelf' && PLAY_KEYS.includes(evt.eventType) && story) setScreen('player');
    else if (screen === 'shelf' && evt.eventType === 'down') setScreen('fonts');
    else if (screen === 'fonts' && (evt.eventType === 'back' || evt.eventType === 'up')) setScreen('shelf');
  });

  if (error) return <View style={s.root}><Text style={s.err}>{error}</Text><Text style={s.hint}>Is `npm start` running on the Mac? Server: {SERVER_URL}</Text></View>;
  if (!story) return <View style={s.root}><Text style={s.hint}>Loading {STORY_ID}…</Text></View>;
  if (screen === 'fonts') return <FontCheck fontReady={fontReady} />;
  if (screen === 'player') return <Player story={story} fontReady={fontReady} mediaBase={mediaBase} onExit={() => setScreen('shelf')} />;
  return (
    <View style={s.root}>
      <Text style={s.brand}>WordLight</Text>
      {/* Focusable so OK reaches onPress through Vega's focus system even if the HW listener does not see 'select'. */}
      <TouchableOpacity hasTVPreferredFocus style={[s.card, s.cardFocused]} onPress={() => { log('card onPress'); setScreen('player'); }}>
        {mediaBase ? <Image source={{ uri: `${mediaBase}/content/stories/${story.id}/${story.pages[0].image}` }} style={s.cardImg} /> : <View style={s.cardImg} />}
        <Text style={s.cardTitle}>{story.title}</Text>
      </TouchableOpacity>
      <Text style={s.hint}>Select: open · Down: Devanagari check · audio: {AUDIO_FILE} · lead {LEAD_MS} ms</Text>
      <Text style={s.hint}>media: {mediaBase ?? 'no https media URL — run tools/dev-tunnel/dev-tunnel.sh on the Mac'}</Text>
    </View>
  );
};

function Player({ story, fontReady, mediaBase, onExit }: { story: Story; fontReady: boolean; mediaBase: string | null; onExit: () => void }) {
  const page = story.pages[0];
  const lines = page.lines;
  const player = useRef<AudioPlayer | null>(null);
  const sampler = useRef(new PlayheadSampler());
  const playing = useRef(false);
  const [view, setView] = useState({ line: 0, word: -1, pos: 0 });
  const [marker, setMarker] = useState(false);
  const [diag, setDiag] = useState<Record<string, string>>({});
  const [mediaError, setMediaError] = useState<string | null>(null);
  const lastWord = useRef<string>('');
  const pollGaps = useRef<number[]>([]);

  // player lifecycle (API as used in Amazon's vega-audio-sample: new AudioPlayer → initialize → src)
  useEffect(() => {
    const p = new AudioPlayer();
    player.current = p;
    const on = (ev: string, fn: () => void) => p.addEventListener(ev as any, fn as any);
    on('playing', () => { playing.current = true; sampler.current.reset(); log('playing'); });
    on('pause', () => { playing.current = false; sampler.current.reset(); log('pause'); });
    on('seeking', () => { sampler.current.reset(); });
    on('ended', () => { playing.current = false; log('ended'); });
    const srcFor = (base: string | null) => `${base ?? '(no-https-media-url)'}/content/stories/${story.id}/${AUDIO_FILE}`;
    let src = srcFor(mediaBase);
    let retries = 0;
    on('error', () => {
      const err = { code: (p as any).error?.code, message: (p as any).error?.message };
      log(`player error ${JSON.stringify(err)} src=${src}`);
      setMediaError(`media error ${err.code ?? '?'} · ${src.startsWith('https:') ? src.split('/content/')[0] : 'no https media URL: run tools/dev-tunnel/dev-tunnel.sh'}`);
      // Known VVD cold-start case: the guest network is not ready yet and this surfaces as error 4; retry with backoff.
      // The media base is re-resolved on retry, so a restarted dev tunnel is picked up without leaving the player.
      if (retries < 4) {
        const ms = 500 * 2 ** retries++;
        setTimeout(async () => { src = srcFor(await resolveMediaBase()); log(`retry ${retries} after ${ms} ms: ${src}`); p.src = src; }, ms);
      }
    });
    on('canplay', () => setMediaError(null));
    for (const ev of ['loadstart', 'loadedmetadata', 'canplay', 'waiting', 'stalled']) on(ev, () => log(`media ${ev} t=${p.currentTime}`));
    p.initialize().then(() => {
      p.autoplay = false;
      p.src = src;
      log(`player initialised, src ${src}`);
    }).catch((e: any) => log(`initialize failed: ${e?.message ?? e}`));
    return () => { try { p.pause(); } catch {} p.deinitialize().catch(() => {}); };
  }, [story.id]);

  // timing loop: sample currentTime, derive the lit word, flash the marker when it changes
  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const p = player.current;
      if (!p) return;
      const now = performance.now();
      pollGaps.current.push(now - last); if (pollGaps.current.length > 100) pollGaps.current.shift();
      last = now;
      sampler.current.sample((p.currentTime ?? 0) * 1000, now, playing.current);
      const pos = sampler.current.positionAt(now, playing.current) ?? 0;
      const li = lineIndexAt(lines, pos + LEAD_MS);
      const wi = wordIndexAt(lines[li].words, pos + LEAD_MS);
      const key = `${li}:${wi}`;
      if (key !== lastWord.current) {
        lastWord.current = key;
        setView({ line: li, word: wi, pos });
        if (wi >= 0 && playing.current) { setMarker(true); setTimeout(() => setMarker(false), 100); }
      }
    }, POLL_MS);
    const d = setInterval(() => {
      const gaps = [...pollGaps.current].sort((a, b) => a - b);
      const p = player.current;
      const info = {
        'currentTime update period': `${sampler.current.updatePeriodMs?.toFixed(0) ?? '—'} ms`,
        'poll gap median / max': `${gaps[gaps.length >> 1]?.toFixed(1) ?? '—'} / ${gaps[gaps.length - 1]?.toFixed(1) ?? '—'} ms`,
        'position': `${(p?.currentTime ?? 0).toFixed(3)} s`,
        'state': playing.current ? 'playing' : 'paused',
      };
      setDiag(info);
      log(`diag ${JSON.stringify(info)}`);
    }, 1000);
    return () => { clearInterval(id); clearInterval(d); };
  }, [lines]);

  const seekToLine = useCallback((i: number) => {
    const p = player.current;
    const l = lines[Math.max(0, Math.min(lines.length - 1, i))];
    if (!p || !l) return;
    p.currentTime = Math.max(0, (l.words[0].t0 - 300) / 1000);
    sampler.current.reset();
  }, [lines]);

  useTVEventHandler((evt: any) => {
    logKey('player', evt);
    if (evt?.eventKeyAction !== 0) return;
    const p = player.current;
    if (!p) return;
    switch (evt.eventType) {
      case 'select': case 'kpenter': case 'enter': {
        // Toggle on our event-driven state. (Build 4 log: p.paused was correct; audio failed because the source was http.)
        const wantPlay = !playing.current;
        log(`toggle -> ${wantPlay ? 'play' : 'pause'} (p.paused=${String((p as any).paused)})`);
        try {
          const r: any = wantPlay ? p.play() : p.pause();
          if (r && typeof r.then === 'function') r.then(() => log('play/pause resolved'), (e: any) => log(`play/pause rejected: ${e?.message ?? e}`));
        } catch (e: any) { log(`play/pause threw: ${e?.message ?? e}`); }
        break;
      }
      case 'left': seekToLine(view.line - 1); break;
      case 'right': seekToLine(view.line + 1); break;
      case 'up': seekToLine(view.line); break; // hear this line again
      case 'back': p.pause(); onExit(); break;
    }
  });

  const line = lines[view.line];
  const phases = phasesAt(line.words, view.pos, LEAD_MS);
  return (
    <View style={s.root}>
      {mediaBase ? <Image source={{ uri: `${mediaBase}/content/stories/${story.id}/${page.image}` }} style={s.pageImg} /> : null}
      <View style={s.subtitle}>
        <Text style={[s.line, fontReady && s.deva]}>
          {line.words.map((w, i) => (
            <Text key={i} style={phases[i] === 'current' ? s.current : phases[i] === 'spoken' ? s.spoken : s.upcoming}>{w.w}{i < line.words.length - 1 ? ' ' : ''}</Text>
          ))}
        </Text>
      </View>
      {/* S1 timing marker: filmed together with the audio clicks */}
      <View style={[s.marker, marker ? s.markerOn : null]} />
      <View style={s.diag}>
        {Object.entries(diag).map(([k, v]) => <Text key={k} style={s.diagText}>{k}: {v}</Text>)}
        <Text style={s.diagText}>line {view.line + 1}/{lines.length} · word {view.word + 1} · audio {AUDIO_FILE} · lead {LEAD_MS} ms</Text>
        {mediaError ? <Text style={[s.diagText, { color: '#ff9f80' }]}>{mediaError}</Text> : null}
        <Text style={s.diagText}>OK or ▶: play/pause · ←/→ line · ↑ again · Back: shelf</Text>
      </View>
      <Text style={s.credit}>{story.credits.attribution}</Text>
    </View>
  );
}

const SAMPLES = ['एक छोटा चूहा था।', 'विद्यालय में बच्चे पढ़ते हैं।', 'क्षमा त्रिकोण ज्ञान श्रम।', 'कृष्ण ने दूध पिया।', 'हिंदी और हिन्दी · क़लम ज़मीन फ़ूल', 'The little cat ran home.'];
function FontCheck({ fontReady }: { fontReady: boolean }) {
  return (
    <View style={s.root}>
      <Text style={s.brand}>Devanagari check</Text>
      <View style={s.fontCols}>
        <View style={s.fontCol}>
          <Text style={s.hint}>System font</Text>
          {SAMPLES.map((t) => <Text key={t} style={s.sample}>{t}</Text>)}
        </View>
        <View style={s.fontCol}>
          <Text style={s.hint}>Noto Sans Devanagari {fontReady ? '(loaded)' : '(NOT loaded)'}</Text>
          {SAMPLES.map((t) => <Text key={t} style={[s.sample, fontReady && s.deva]}>{t}</Text>)}
        </View>
      </View>
      <Text style={s.hint}>Photograph this screen for the S1 record. Back/Up: return.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#101820', alignItems: 'center', justifyContent: 'center' },
  brand: { color: '#ffd166', fontSize: 64, fontWeight: '700', marginBottom: 32 },
  card: { width: 420, backgroundColor: '#1d2b3a', borderRadius: 16, padding: 16, borderWidth: 4, borderColor: 'transparent' },
  cardFocused: { borderColor: '#ffd166' },
  cardImg: { width: 388, height: 218, borderRadius: 8 },
  cardTitle: { color: '#fff', fontSize: 32, marginTop: 12 },
  hint: { color: '#9fb3c8', fontSize: 24, marginTop: 24 },
  err: { color: '#ff8080', fontSize: 30, padding: 40 },
  pageImg: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  subtitle: { position: 'absolute', bottom: 120, left: 80, right: 80, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 20, paddingVertical: 24, paddingHorizontal: 36 },
  line: { fontSize: 64, textAlign: 'center', color: '#8899aa' },
  deva: { fontFamily: 'NotoSansDevanagari-Regular' },
  spoken: { color: '#ffffff' },
  current: { color: '#101820', backgroundColor: '#ffd166' },
  upcoming: { color: '#8899aa' },
  marker: { position: 'absolute', top: 40, right: 40, width: 160, height: 160, backgroundColor: '#101820' },
  markerOn: { backgroundColor: '#ffffff' },
  diag: { position: 'absolute', top: 30, left: 30, backgroundColor: 'rgba(0,0,0,0.6)', padding: 12, borderRadius: 8 },
  diagText: { color: '#cfe3f5', fontSize: 18 },
  credit: { position: 'absolute', bottom: 24, color: '#9fb3c8', fontSize: 18 },
  fontCols: { flexDirection: 'row' },
  fontCol: { marginHorizontal: 40 },
  sample: { color: '#fff', fontSize: 40, marginVertical: 6 },
});
export default App;
