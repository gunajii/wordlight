// <KaraokeLine> — one line of word-timed subtitles for React Native (Vega OS / Fire TV, or any RN target).
// Each word is a nested <Text>, styled by its phase at `positionMs`: spoken · current (highlighted) · upcoming.
// `leadMs` shifts the text relative to the audio (positive lights words earlier) — use it to cancel the device's
// measured audio output latency.
// Highlight with text colour, not backgroundColor: on the Vega Virtual Device a backgroundColor on a nested <Text>
// is not drawn (seen in a screen recording), so dark text on a missing yellow box disappears on a dark background.
import React from 'react';
import { Text, type TextStyle, type StyleProp } from 'react-native';
import { phasesAt, type TimedWord } from './timing.ts';

export interface KaraokeLineProps {
  words: readonly TimedWord[];
  positionMs: number;
  leadMs?: number;
  style?: StyleProp<TextStyle>;
  spokenStyle?: StyleProp<TextStyle>;
  currentStyle?: StyleProp<TextStyle>;
  upcomingStyle?: StyleProp<TextStyle>;
  /** accessibility: the whole line as one label */
  accessibilityLabel?: string;
}

const DEFAULTS = { spoken: { color: '#ffffff' }, current: { color: '#ffd166' }, upcoming: { color: '#8899aa' } };

export function KaraokeLine({ words, positionMs, leadMs = 0, style, spokenStyle, currentStyle, upcomingStyle, accessibilityLabel }: KaraokeLineProps) {
  const phases = phasesAt(words, positionMs, leadMs);
  return (
    <Text style={style} accessibilityLabel={accessibilityLabel ?? words.map((w) => w.w).join(' ')}>
      {words.map((w, i) => (
        <Text key={i} style={phases[i] === 'current' ? [DEFAULTS.current, currentStyle] : phases[i] === 'spoken' ? [DEFAULTS.spoken, spokenStyle] : [DEFAULTS.upcoming, upcomingStyle]}>
          {w.w}{i < words.length - 1 ? ' ' : ''}
        </Text>
      ))}
    </Text>
  );
}
