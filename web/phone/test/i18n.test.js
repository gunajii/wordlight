import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS, UI_LANGS, strings, pickUiLang, defaultSummaryLang } from '../i18n.js';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const keysIn = (attr) => [...html.matchAll(new RegExp(`${attr}="([A-Za-z]+)"`, 'g'))].map((m) => m[1]);

test('every language has every key, with the same kind of value', () => {
  for (const l of UI_LANGS) for (const k of Object.keys(STRINGS.en)) {
    assert.ok(k in STRINGS[l], `${l} is missing ${k}`);
    assert.equal(typeof STRINGS[l][k], typeof STRINGS.en[k], `${l}.${k}`);
  }
  for (const l of UI_LANGS) assert.deepEqual(Object.keys(STRINGS[l].wake).sort(), Object.keys(STRINGS.en.wake).sort());
});

test('every key used by the page exists; HTML strings contain only <b>', () => {
  for (const k of [...keysIn('data-i18n'), ...keysIn('data-i18n-html')]) assert.ok(typeof STRINGS.en[k] === 'string', `page uses missing key ${k}`);
  for (const l of UI_LANGS) for (const k of keysIn('data-i18n-html')) {
    const tags = [...STRINGS[l][k].matchAll(/<\/?([a-z]+)[^>]*>/g)].map((m) => m[1]);
    assert.ok(tags.every((t) => t === 'b'), `${l}.${k} has tags other than <b>`);
  }
  for (const l of ['hi', 'mr']) assert.ok(keysIn('data-i18n').every((k) => STRINGS[l][k] !== STRINGS.en[k] || /WordLight/.test(k)), `${l}: an untranslated string`);
});

test('the consent text keeps its promises in every language: microphone only in turns, voice not stored, Amazon Transcribe named', () => {
  assert.match(strings('hi').consentBody, /सिर्फ़ पढ़ने की बारी/); assert.match(strings('hi').consentBody, /सेव नहीं/);
  assert.match(strings('mr').consentBody, /फक्त वाचनाच्या पाळीत/); assert.match(strings('mr').consentBody, /जतन करत नाही/);
  for (const l of UI_LANGS) assert.match(strings(l).consentDetail, /Amazon Transcribe/);
});

test('page language: saved choice, else Hindi/Marathi browsers, else English; summary language follows it', () => {
  assert.equal(pickUiLang('mr', ['en-US']), 'mr');
  assert.equal(pickUiLang(null, ['mr-IN', 'en']), 'mr');
  assert.equal(pickUiLang(undefined, ['hi']), 'hi');
  assert.equal(pickUiLang('xx', ['en-IN']), 'en');
  assert.equal(defaultSummaryLang('mr'), 'mr'); assert.equal(defaultSummaryLang('en'), 'en');
  assert.equal(strings('mr').stateWellRead(5, 0), 'छान! 5 शब्द स्वतः वाचले.');
});
