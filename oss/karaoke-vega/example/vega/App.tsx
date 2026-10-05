// Minimal Vega OS (React Native for Vega) app: play an audio file and show word-timed subtitles.
// Vega's W3C AudioPlayer needs an https source. Words come from a WebVTT file with word timestamps (or from Polly
// speech marks via wordsFromPolly).
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { AudioPlayer } from '@amazon-devices/react-native-w3cmedia';
import { KaraokeLine, createKaraokeClock, parseKaraokeVtt, lineIndexAt, type TimedLine } from '@wordlight/karaoke-vega';

const AUDIO = 'https://example.com/story/p1.mp3';
const VTT = 'https://example.com/story/p1.vtt';
const LEAD_MS = 0; // measure your device's audio output latency and put −latency here (e.g. −339 on the Vega Virtual Device in WordLight's test)

export const App = () => {
  const player = useRef<AudioPlayer | null>(null);
  const [lines, setLines] = useState<TimedLine[]>([]);
  const [pos, setPos] = useState(0);
  useEffect(() => {
    fetch(VTT).then((r) => r.text()).then((t) => setLines(parseKaraokeVtt(t)));
    const p = new AudioPlayer();
    player.current = p;
    p.initialize().then(() => { p.src = AUDIO; p.play(); });
    const clock = createKaraokeClock({ player: () => player.current as any, onTick: setPos, pollMs: 20 });
    return () => { clock.stop(); p.deinitialize(); };
  }, []);
  const line = lines[lineIndexAt(lines, pos + LEAD_MS)];
  return (
    <View style={{ flex: 1, justifyContent: 'flex-end', padding: 60, backgroundColor: '#101820' }}>
      {line ? <KaraokeLine words={line.words} positionMs={pos} leadMs={LEAD_MS} style={{ fontSize: 56, textAlign: 'center' }} /> : null}
    </View>
  );
};
export default App;
