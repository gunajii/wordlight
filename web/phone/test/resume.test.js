import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resumeAction, RESUME_RECONNECT_AFTER_MS } from '../resume.js';

test('resume: a lock of a few seconds or more reconnects; a quick glance away does not', () => {
  assert.equal(resumeAction({ event: 'visible', hiddenAtMs: 1000, nowMs: 1000 + 60_000 }), 'reconnect');
  assert.equal(resumeAction({ event: 'visible', hiddenAtMs: 1000, nowMs: 1000 + RESUME_RECONNECT_AFTER_MS }), 'reconnect');
  assert.equal(resumeAction({ event: 'visible', hiddenAtMs: 1000, nowMs: 1000 + 800 }), 'none');
  assert.equal(resumeAction({ event: 'visible', hiddenAtMs: null, nowMs: 5000 }), 'none', 'never hidden');
});

test('resume: a back/forward-cache restore always reconnects; the network coming back reconnects unless already open', () => {
  assert.equal(resumeAction({ event: 'pageshow', persisted: true, nowMs: 0 }), 'reconnect');
  assert.equal(resumeAction({ event: 'pageshow', persisted: false, nowMs: 0 }), 'none');
  assert.equal(resumeAction({ event: 'online', status: 'stale', nowMs: 0 }), 'reconnect');
  assert.equal(resumeAction({ event: 'online', status: 'open', nowMs: 0 }), 'none');
});
