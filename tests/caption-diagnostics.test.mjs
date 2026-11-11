import test from 'node:test';
import assert from 'node:assert/strict';
import { runCaptionDiagnostics, extractDiagnosticSegments, makeDiagnosticRoute, redactDiagnosticText } from '../src/caption-diagnostics.js';
import { readPlayerDiagnosticSources, fetchDiagnosticCaptionFromPage } from '../src/diagnostic-page.js';
import { readRenderedTranscript } from '../src/youtube.js';

const track = { baseUrl: 'https://www.youtube.com/api/timedtext?v=video&lang=ja&kind=asr&signature=secret',
  languageCode: 'ja', kind: 'asr', vssId: 'a.ja' };
const body = JSON.stringify({ events: [{ tStartMs: 1234, dDurationMs: 2000,
  segs: [{ utf8: 'ラデオン', tOffsetMs: 0 }, { utf8: 'を積んだ\n', tOffsetMs: 500 }] }] });
const panelBody = JSON.stringify({ trackingParams: 'do-not-export', apiKey: 'do-not-export',
  a: { transcriptSegmentViewModel: { timestamp: '0:01', simpleText: 'ラを積んだ' } } });
const input = { tabId: 1, track, availableTracks: [track], expectedVideoIdentity: 'video' };
const success = { ok: true, status: 200, body };
function dependencies(extra = {}) {
  return { observed: async () => ({ ok: false, errorCode: 'observed-caption-url-unavailable' }), identity: async () => 'video', fetch: async () => ({ ok: true, status: 200, text: async () => body }),
    fetchPage: async () => success,
    panel: async () => ({ ok: true, status: 200, body: panelBody, trackIdentity: 'a.ja' }),
    alternate: async () => ({ ok: true, status: 200, bodyBytes: 123, baseUrl: track.baseUrl }),
    legacy: async () => ({ cues: [] }), modern: async () => ({ cues: [] }),
    player: async () => ({ displayed: { startMs: 1000, text: 'ラデオンを積んだ' }, resources: [{ url: track.baseUrl, format: 'json3' }] }), ...extra };
}

test('diagnostic raw segments preserve original whitespace, duplicate events and word offsets', () => {
  const data = JSON.parse(body); data.events.push(data.events[0]);
  const route = makeDiagnosticRoute('json3', { ok: true, status: 200, body: JSON.stringify(data) }, 'json3');
  assert.equal(route.segmentCount, 2);
  assert.equal(route.rawFullText, 'ラデオンを積んだ\n\nラデオンを積んだ\n');
  assert.equal(route.rawSegments[0].startMs, 1234);
  assert.equal(route.rawSegments[0].parts[1].offsetMs, 500);
  assert.equal(route.formattedSegments.length, 1);
  assert.equal(route.formattedFullText, 'ラデオンを積んだ');
  assert.equal(route.responseBytes, new TextEncoder().encode(JSON.stringify(data)).length);
});

test('panel extraction preserves original text without inferring missing syllables or duration', () => {
  const segments = extractDiagnosticSegments(panelBody, 'panel');
  assert.deepEqual(segments, [{ startMs: 1000, durationMs: 0, text: 'ラを積んだ' }]);
  const legacy = extractDiagnosticSegments(JSON.stringify({ transcriptSegmentRenderer: {
    startMs: '2500', endMs: '3900', snippet: { runs: [{ text: '  a\n' }, { text: ' b ' }] }
  } }), 'panel');
  assert.equal(legacy[0].text, '  a\n b ');
  assert.equal(legacy[0].durationMs, 1400);
});

test('every format and route runs despite early success; panel discrepancy is retained', async () => {
  let pageCalls = 0;
  const order = [];
  const report = await runCaptionDiagnostics(input, r => order.push(r.method), dependencies({
    fetchPage: async () => { pageCalls++; return success; }
  }));
  assert.equal(report.schemaVersion, 2);
  assert.ok(report.collectionStartedAt <= report.createdAt);
  assert.equal(report.routes.at(-1).comparisonKey, 'player-observed-timedtext:json3');
  assert.equal(order[0], 'player-displayed-snapshot');
  assert.equal(report.routes.length, 20);
  assert.equal(pageCalls, 9); // four page + four alternate + observed URL
  assert.equal(report.routes.filter(r => r.method.startsWith('extension-timedtext')).length, 4);
  assert.equal(report.routes.find(r => r.method === 'get-panel').rawFullText, 'ラを積んだ');
  assert.equal(report.comparisons.find(c => c.left === 'extension-timedtext-json3' && c.right === 'get-panel').rawFullTextEqual, false);
  assert.doesNotMatch(JSON.stringify(report), /signature=secret|do-not-export|https:\/\//);
});

test('network exceptions, empty 200s, failed HTTP and skipped routes retain zero counts; later routes still run', async () => {
  const report = await runCaptionDiagnostics(input, undefined, dependencies({
    fetch: async () => { throw new Error('https://youtube.com/?token=secret'); },
    fetchPage: async () => ({ ok: true, status: 200, body: '' }),
    panel: async () => ({ ok: false, status: 403, body: 'private-response-secret' }),
    alternate: async () => ({ ok: false, skipped: true }),
    player: async () => ({ resources: [] })
  }));
  assert.equal(report.routes.find(r => r.method === 'page-timedtext-json3').reason, 'empty-response');
  const panel = report.routes.find(r => r.method === 'get-panel');
  assert.equal(panel.httpStatus, 403); assert.equal(panel.segmentCount, 0);
  assert.equal(report.routes.at(-1).reason, 'no-matching-resource-timing-entry');
  assert.doesNotMatch(JSON.stringify(report), /private-response-secret|token=secret/);
  assert.ok(report.routes.every(r => r.reason && r.segmentCount === 0));
});

test('navigated video responses are discarded while all planned routes remain recorded', async () => {
  let n = 0;
  const report = await runCaptionDiagnostics(input, undefined, dependencies({ identity: async () => ++n < 3 ? 'video' : 'different-video' }));
  assert.ok(report.routes.slice(1).every(r => r.segmentCount === 0 && r.reason === 'video-context-changed'));
});

test('redaction covers caption URLs, escaped URLs, auth and token syntax', () => {
  const output = redactDiagnosticText('https://youtube.com/api/timedtext?signature=abc\nhttps:\\/\\/youtube.com/?key=abc\nBearer abc.secret\nCookie: SID=private\ntoken=private');
  assert.doesNotMatch(output, /abc|private|youtube\.com/);
});

test('actual MAIN-world player helper excludes diagnostic fetch URLs and foreign videos/tracks', async () => {
  const old = { chrome: globalThis.chrome, location: globalThis.location, document: globalThis.document, performance: globalThis.performance };
  const entries = [
    { name: track.baseUrl + '&fmt=json3', initiatorType: 'xmlhttprequest', startTime: 1 },
    { name: track.baseUrl + '&fmt=vtt', initiatorType: 'fetch', startTime: 2 },
    { name: track.baseUrl.replace('v=video', 'v=wrong') + '&fmt=srv3', initiatorType: 'xmlhttprequest', startTime: 3 },
    { name: track.baseUrl.replace('lang=ja', 'lang=en'), initiatorType: 'xmlhttprequest', startTime: 4 }
  ];
  try {
    globalThis.location = new URL('https://www.youtube.com/watch?v=video');
    globalThis.document = { querySelector: () => ({ currentTime: 2, textTracks: [] }), querySelectorAll: () => [{ textContent: 'ラデオンを積んだ' }] };
    Object.defineProperty(globalThis, 'performance', { configurable: true, value: { getEntriesByType: () => entries } });
    globalThis.chrome = { scripting: { executeScript: async ({ func, args = [] }) => [{ result: await func(...args) }] } };
    const result = await readPlayerDiagnosticSources(1, 'video', track);
    assert.equal(result.resources.length, 1);
    assert.equal(result.resources[0].format, 'json3');
    assert.equal(result.displayed.text, 'ラデオンを積んだ');
    assert.equal((await readPlayerDiagnosticSources(1, 'other', track)).errorCode, 'video-context-changed');
    assert.equal((await fetchDiagnosticCaptionFromPage(1, 'https://example.com/', '')).errorCode, 'invalid-caption-url');
  } finally { for (const [key, value] of Object.entries(old)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
});

test('legacy DOM reader keeps normal behavior and diagnostic mode preserves original text', async () => {
  const oldChrome = globalThis.chrome, oldDocument = globalThis.document;
  try {
    globalThis.chrome = { scripting: { executeScript: async ({ func, args }) => [{ result: await func(...args) }] } };
    globalThis.document = { querySelectorAll: () => [{ getBoundingClientRect: () => ({ width: 10, height: 10 }),
      querySelector: sel => ({ textContent: sel === '.segment-timestamp' ? '0:02' : ' ラデオン\nを積んだ  ' }) }] };
    assert.equal((await readRenderedTranscript(1)).cues[0].text, 'ラデオン を積んだ');
    assert.equal((await readRenderedTranscript(1, true)).cues[0].text, ' ラデオン\nを積んだ  ');
  } finally { globalThis.chrome = oldChrome; globalThis.document = oldDocument; }
});


test('a signed URL split across word parts cannot leak its credential suffix', () => {
  const r = makeDiagnosticRoute('json3', { ok: true, body: JSON.stringify({ events: [{
    segs: [{ utf8: 'https://youtube.com/?signature=' }, { utf8: 'PRIVATE_SUFFIX' }]
  }] }) }, 'json3');
  assert.equal(r.redacted, true);
  assert.doesNotMatch(JSON.stringify(r), /PRIVATE_SUFFIX/);
});
