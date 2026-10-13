import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARY_LANGS as PROTOCOL_LANGS, validateEvent } from '@wordlight/shared-protocol';
import { SummaryTranslator, AwsTranslator, SUMMARY_LANGS, NAME_TOKEN, type Translator } from '../src/translate.ts';
import { UsageMeter } from '../src/usage.ts';
import { SessionHub } from '../src/hub.ts';

const EN = 'Riya read 12 words independently and needed help with 2 words (3 reading turns, 4 minutes).';
const meter = () => new UsageMeter({ file: null });

/** Fake translator: records what it was sent, answers with a scripted function. */
function fake(answer: (text: string, target: string) => string | Promise<string>) {
  const sent: { text: string; target: string }[] = [];
  const t: Translator = { name: 'fake', async translate(text, target) { sent.push({ text, target }); return answer(text, target); } };
  return { t, sent };
}

test('summary languages match the protocol list', () => {
  assert.deepEqual(Object.keys(SUMMARY_LANGS).sort(), [...PROTOCOL_LANGS].sort());
});

test("the child's name never reaches the translator, and is put back afterwards", async () => {
  const { t, sent } = fake((text) => `मराठी: ${text.replace('read', 'वाचले')}`);
  const st = new SummaryTranslator({ translator: t, usage: meter() });
  const r = await st.translate(EN, 'Riya', 'mr');
  assert.equal(sent.length, 1);
  assert.ok(!sent[0].text.includes('Riya'), 'name masked');
  assert.ok(sent[0].text.includes(NAME_TOKEN));
  assert.equal(sent[0].target, 'mr');
  assert.equal(r.source, 'amazon-translate');
  assert.equal(r.lang, 'mr');
  assert.ok(r.text.includes('Riya') && !r.text.includes(NAME_TOKEN));
});

test('English (or no choice) is passed through without a call', async () => {
  const { t, sent } = fake(() => 'x');
  const st = new SummaryTranslator({ translator: t, usage: meter() });
  for (const lang of [undefined, 'en']) assert.deepEqual(await st.translate(EN, 'Riya', lang), { text: EN, lang: 'en', source: 'original' });
  assert.equal(sent.length, 0);
});

test('every failure gives the parent the English summary, never an error', async () => {
  const cases: [string, Translator | null, string, string?][] = [
    ['off', null, 'mr'],
    ['unsupported-language', fake(() => 'x').t, 'fr'],
    ['placeholder-lost', fake(() => 'रिया ने 12 शब्द पढ़े').t, 'hi'],          // translator transliterated or dropped the token
    ['placeholder-lost', fake((s) => `${s} ${NAME_TOKEN}`).t, 'hi'],           // or duplicated it
    ['empty', fake(() => '').t, 'ta'],
    ['error:ThrottlingException', { name: 'x', translate: async () => { const e = new Error('slow down'); e.name = 'ThrottlingException'; throw e; } }, 'te'],
  ];
  for (const [reason, tr, lang] of cases) {
    const r = await new SummaryTranslator({ translator: tr, usage: meter() }).translate(EN, 'Riya', lang);
    assert.equal(r.text, EN, reason);
    assert.equal(r.source, 'original');
    assert.equal(r.fallbackReason, reason);
  }
});

test('a slow translator times out to English', async () => {
  const slow: Translator = { name: 'slow', translate: (_t, _l, signal) => new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted')))) };
  const r = await new SummaryTranslator({ translator: slow, timeoutMs: 20, usage: meter() }).translate(EN, 'Riya', 'mr');
  assert.equal(r.fallbackReason, 'timeout');
  assert.equal(r.text, EN);
});

test('cached per language; the per-process budget and the daily character cap are respected and metered', async () => {
  const { t, sent } = fake((s) => `[mr] ${s}`);
  const u = meter();
  const st = new SummaryTranslator({ translator: t, usage: u, maxCalls: 2 });
  await st.translate(EN, 'Riya', 'mr');
  await st.translate(EN.replace('Riya', 'Aarav'), 'Aarav', 'mr'); // same masked text → cache hit, different name back
  assert.equal(sent.length, 1);
  assert.equal(u.snapshot().translateChars, EN.replace('Riya', NAME_TOKEN).length);
  await st.translate(EN, 'Riya', 'hi');
  assert.equal((await st.translate(EN, 'Riya', 'ta')).fallbackReason, 'budget');
  const capped = new SummaryTranslator({ translator: t, usage: new UsageMeter({ file: null, caps: { translateChars: 10 } }) });
  assert.equal((await capped.translate(EN, 'Riya', 'mr')).fallbackReason, 'daily-cap');
});

test('AwsTranslator sends English source, the chosen target, and an abort signal', async () => {
  const calls: any[] = [];
  class Cmd { input: any; constructor(i: any) { this.input = i; } }
  const aws = new AwsTranslator({ client: { async send(c: any, o: any) { calls.push([c, o]); return { TranslatedText: 'ok' }; } }, TranslateTextCommand: Cmd });
  const ctl = new AbortController();
  assert.equal(await aws.translate('hello', 'kn', ctl.signal), 'ok');
  assert.deepEqual(calls[0][0].input, { Text: 'hello', SourceLanguageCode: 'en', TargetLanguageCode: 'kn' });
  assert.equal(calls[0][1].abortSignal, ctl.signal);
});

test('reader.save: summaryLang is optional and must be an offered language', () => {
  const base = { type: 'reader.save', sessionId: 'ABCD', serverMs: 1, reader: { readerId: 'rd-1', firstName: 'Riya', age: 7, lang: 'en-IN' }, consent: { microphone: true, atMs: 1 } };
  assert.equal(validateEvent(base).ok, true);
  assert.equal(validateEvent({ ...base, reader: { ...base.reader, summaryLang: 'mr' } }).ok, true);
  const bad = validateEvent({ ...base, reader: { ...base.reader, summaryLang: 'xx' } });
  assert.equal(bad.ok, false);
});

test("session end: the TV keeps the original; the parent's phone gets the summary in the chosen language", async () => {
  const hub = new SessionHub({ now: () => Date.now() });
  const { t, sent } = fake((s) => `[mr] ${s}`);
  hub.translator = new SummaryTranslator({ translator: t, usage: meter() });
  const id = hub.createSession();
  const tvOut: any[] = [], p1Out: any[] = [], p2Out: any[] = [];
  const tv = { send: (m: any) => tvOut.push(m) }, p1 = { send: (m: any) => p1Out.push(m) }, p2 = { send: (m: any) => p2Out.push(m) };
  hub.handle(tv, { t: 'hello', role: 'tv', sessionId: id, clientId: 'tv' });
  hub.handle(p1, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p1' });
  hub.handle(p2, { t: 'hello', role: 'phone', sessionId: id, clientId: 'p2' });
  hub.handle(p1, { type: 'reader.save', reader: { readerId: 'rd-1', firstName: 'Riya', age: 7, lang: 'en-IN', summaryLang: 'mr' }, consent: { microphone: true, atMs: 1 } });
  hub.handle(p2, { type: 'reader.save', reader: { readerId: 'rd-2', firstName: 'Kabir', age: 8, lang: 'hi-IN' }, consent: { microphone: true, atMs: 1 } });
  await hub.sessionEnd(hub.get(id)!, { storyId: 'kite', storyTitle: 'Kite', completed: true, durationMs: 60_000 });
  const tvSums = tvOut.filter((m) => m.type === 'session.summary');
  assert.equal(tvSums.length, 2);
  assert.ok(tvSums.every((m) => !m.text.startsWith('[mr]') && m.translatedBy === undefined), 'TV: original text');
  const a = p1Out.find((m) => m.type === 'session.summary');
  assert.ok(a.text.startsWith('[mr]') && a.text.includes('Riya'));
  assert.equal(a.textLang, 'mr');
  assert.equal(a.translatedBy, 'amazon-translate');
  assert.equal(a.textEn, tvSums.find((m) => m.readerId === 'rd-1').text);
  const b = p2Out.find((m) => m.type === 'session.summary');
  assert.ok(!b.text.startsWith('[mr]') && b.translatedBy === undefined, 'no choice → English');
  assert.equal(sent.length, 1);
  assert.ok(!sent[0].text.includes('Riya'));
  const log = hub.get(id)!.telemetry.filter((x: any) => x.kind === 'session-summary');
  assert.deepEqual(log.map((x: any) => [x.summaryLang, x.translated]), [['mr', true], ['en', false]]);
});
