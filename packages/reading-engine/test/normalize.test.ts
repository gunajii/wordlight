import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWord, tokenize, phoneticKey, editDistance } from '../src/index.ts';

test('English: case and punctuation do not matter', () => {
  assert.equal(normalizeWord('Home.', 'en-IN'), 'home');
  assert.equal(normalizeWord('"Cat,"', 'en-IN'), 'cat');
  assert.equal(normalizeWord("don't", 'en-IN'), 'dont');
  assert.deepEqual(tokenize('The little cat ran home!', 'en-IN'), ['the', 'little', 'cat', 'ran', 'home']);
  assert.deepEqual(tokenize('well-known — yes', 'en-IN'), ['well', 'known', 'yes']);
});

test('Unicode: NFC and NFD spellings of the same word are equal', () => {
  const nfc = 'क़लम'.normalize('NFC');
  const nfd = 'क़लम'.normalize('NFD');
  assert.equal(normalizeWord(nfc, 'hi-IN'), normalizeWord(nfd, 'hi-IN'));
});

test('Hindi: danda and punctuation stripped; nukta, chandrabindu and half-nasals folded', () => {
  assert.equal(normalizeWord('था।', 'hi-IN'), 'था');
  assert.equal(normalizeWord('ज़मीन', 'hi-IN'), normalizeWord('जमीन', 'hi-IN'));
  assert.equal(normalizeWord('हँसी', 'hi-IN'), normalizeWord('हंसी', 'hi-IN'));
  assert.equal(normalizeWord('हिन्दी', 'hi-IN'), normalizeWord('हिंदी', 'hi-IN'));
  assert.equal(normalizeWord('गन्दा', 'hi-IN'), normalizeWord('गंदा', 'hi-IN'));
  assert.equal(normalizeWord('‍घर‌', 'hi-IN'), 'घर');
});

test('Hindi folding does not merge different words', () => {
  assert.notEqual(normalizeWord('कल', 'hi-IN'), normalizeWord('काल', 'hi-IN')); // matra matters
  assert.notEqual(normalizeWord('दिन', 'hi-IN'), normalizeWord('दीन', 'hi-IN'));
  assert.notEqual(normalizeWord('घर', 'hi-IN'), normalizeWord('कर', 'hi-IN'));
});

test('Numbers: digits, Devanagari digits and number words agree', () => {
  assert.equal(normalizeWord('2', 'en-IN'), normalizeWord('two', 'en-IN'));
  assert.equal(normalizeWord('२', 'hi-IN'), '2');
  assert.equal(normalizeWord('दो', 'hi-IN'), '2');
  assert.equal(normalizeWord('पाँच', 'hi-IN'), normalizeWord('5', 'hi-IN'));
});

test('phonetic keys and edit distance', () => {
  assert.equal(phoneticKey('cat', 'en-IN'), phoneticKey('kat', 'en-IN'));
  assert.notEqual(phoneticKey('cat', 'en-IN'), phoneticKey('hat', 'en-IN'));
  assert.equal(phoneticKey('खाना', 'hi-IN'), phoneticKey('काना', 'hi-IN')); // aspiration folded
  assert.equal(editDistance('little', 'litle'), 1);
  assert.equal(editDistance('', 'abc'), 3);
});
