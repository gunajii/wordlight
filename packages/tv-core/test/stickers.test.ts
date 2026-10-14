import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stickerFor, isNewSticker, stickerCount, childText } from '../src/index.ts';

const readers = [{ readerId: 'a', firstName: 'Riya', online: true }, { readerId: 'b', firstName: 'Kabir', online: false }];

test('a book shows the sticker of the reader on the sofa (online) who finished it', () => {
  const st = { a: ['busy-ants'], b: ['clean-cat'] };
  assert.equal(stickerFor(st, readers, 'busy-ants'), 'Riya');
  assert.equal(stickerFor(st, readers, 'clean-cat'), null, 'Kabir is not here tonight');
  assert.equal(stickerFor({}, readers, 'busy-ants'), null);
});

test('only finishing a book earns a new sticker, once per book; nothing is ever taken away', () => {
  const st = { a: ['busy-ants'] };
  assert.equal(isNewSticker(st, readers[0], 'clean-cat', true), true);
  assert.equal(isNewSticker(st, readers[0], 'clean-cat', false), false, 'stopped early: no sticker, no penalty');
  assert.equal(isNewSticker(st, readers[0], 'busy-ants', true), false, 'already has it');
  assert.equal(isNewSticker(st, null, 'clean-cat', true), false, 'no reader paired');
  assert.equal(stickerCount({ a: ['x', 'x', 'y'] }, 'a'), 2);
});

test('the new-sticker line exists in every TV language and names the child', () => {
  for (const l of ['en-IN', 'hi-IN', 'mr-IN']) assert.match(childText(l).end.newSticker('Riya'), /Riya/);
});
