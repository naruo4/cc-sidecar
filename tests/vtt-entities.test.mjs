import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVttCaptionBody, parseJson3CaptionBody, decodeVttEntities } from '../src/caption-parsers.js';
import { makeDiagnosticRoute } from '../src/caption-diagnostics.js';
import { buildPlainTranscript, buildReadableTranscript, buildMarkdownTranscript } from '../src/text.js';
const body = 'WEBVTT\n\n00:01.000 --> 00:03.000\nA &gt; B &amp; C &lt; D\n&quot;日本語&quot; &apos;x&apos; &#62; &#x1F600;';

test('VTT entities decode to literal text with unchanged timestamps and export content', () => {
  const cues = parseVttCaptionBody(body);
  assert.equal(cues[0].text, 'A > B & C < D "日本語" \'x\' > 😀');
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].durationMs, 2000);
  assert.equal(buildPlainTranscript(cues), cues[0].text);
  assert.equal(buildReadableTranscript(cues), cues[0].text);
  assert.ok(buildMarkdownTranscript({ title: 'test', cues }).includes(cues[0].text));
});

test('VTT decoding is single pass, retains unsupported/invalid references, and does not interpret HTML', () => {
  assert.equal(decodeVttEntities('&GT; &AMP; &LT;'), '> & <');
  assert.equal(decodeVttEntities('&amp;gt; &nbsp; &lrm;&rlm;'), '&gt; \u00a0 \u200e\u200f');
  assert.equal(decodeVttEntities('&#0; &#xD800; &#x110000; &unknown;'), '&#0; &#xD800; &#x110000; &unknown;');
  assert.equal(decodeVttEntities('&lt;img src=x onerror=alert(1)&gt;'), '<img src=x onerror=alert(1)>');
  assert.equal(parseJson3CaptionBody(JSON.stringify({ events: [{ segs: [{ utf8: '&gt;' }] }] }))[0].text, '&gt;');
});

test('comparison keeps encoded original VTT separate from decoded formatted text', () => {
  const route = makeDiagnosticRoute('alternate-player-timedtext-vtt', { ok: true, status: 200, body }, 'vtt');
  assert.ok(route.rawFullText.includes('&gt;'));
  assert.ok(route.formattedFullText.includes('A > B & C < D'));
  assert.equal(route.redacted, false);
});
