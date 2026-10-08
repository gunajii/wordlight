// The story package the content pipeline writes and the TV reads:
//   stories/<id>/story.json  +  p1.webp, p1.mp3, ... beside it.
//
// Every line keeps word timings, including "your turn" lines: without a phone the TV simply
// narrates them, and during a turn the TV pauses at the line's first word, then resumes after
// its last word. Help for a word replays that word's span of the page audio (or `clip` if set).

export const PACKAGE_VERSION = 1;
export type Lang = 'hi-IN' | 'en-IN';

export interface Word {
  /** the word as displayed, punctuation attached (e.g. "था।") */
  w: string;
  /** ms from the start of the page audio */
  t0: number;
  t1: number;
  /** optional separate help clip for this word */
  clip?: string;
}

export interface Line {
  text: string;
  words: Word[];
  turn: boolean;
}

export interface Page {
  image: string;
  audio: string;
  durationMs: number;
  lines: Line[];
}

export interface Credits {
  source: string; // e.g. "StoryWeaver" or "WordLight test content"
  license: 'CC BY 4.0' | 'CC BY-SA 4.0' | 'CC0' | 'original';
  title: string;
  author: string;
  illustrator?: string;
  translator?: string;
  publisher?: string;
  url?: string;
  /** the exact attribution sentence shown in the app */
  attribution: string;
}

export interface StoryPackage {
  packageVersion: typeof PACKAGE_VERSION;
  id: string;
  lang: Lang;
  level: number;
  title: string;
  credits: Credits;
  voice: { engine: 'polly-neural' | 'polly-standard' | 'synthetic-clicks' | 'recorded'; id: string; style?: import('./ssml.ts').NarrationStyle };
  /** how word timings were produced, and whether they were measured against the audio (S4) */
  timing: { source: 'polly-speech-marks' | 'transcribe' | 'synthetic' | 'manual'; verified: boolean };
  /** how the Your Turn lines were chosen (rules = deterministic; bedrock = a model's choice, validated against the rules) */
  turnSelection?: { source: 'rules' | 'bedrock'; model?: string; level?: number; reason?: string };
  pages: Page[];
}
