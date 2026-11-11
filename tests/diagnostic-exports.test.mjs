import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnosticExportFiles } from '../src/diagnostic-exports.js';
import { makeDiagnosticRoute } from '../src/caption-diagnostics.js';

function report() {
  return { schemaVersion: 2, videoId: 'video-A', videoTitle: '比較する動画',
    collectionStartedAt: '2026-11-11T09:00:00.000Z', createdAt: '2026-11-11T09:01:00.123Z',
    extensionVersion: '0.4.2', selectedTrack: { languageCode: 'ja', kind: 'asr', label: '日本語（自動生成）' },
    routes: [
      makeDiagnosticRoute('get-panel', { segments: [{ startMs: 0, durationMs: 0, text: 'ラを積んだ' }] }, 'panel'),
      makeDiagnosticRoute('page', { segments: [{ startMs: 0, durationMs: 2000, text: 'ラデオンを積んだ\n全文の最後' }] }, 'json3'),
      makeDiagnosticRoute('alternate', { segments: [{ startMs: 0, durationMs: 2000, text: 'ラデオンを積んだ\n全文の最後' }] }, 'srv3'),
      makeDiagnosticRoute('failed', { ok: true, status: 200, body: '' }, 'json3')
    ] };
}

test('one TXT and one JSON contain all route data with exact-text references and empty reasons', () => {
  const source = report();
  const files = buildDiagnosticExportFiles(source);
  assert.deepEqual(JSON.parse(files.json.content), source);
  assert.equal(files.txt.filename.replace(/\.txt$/, ''), files.json.filename.replace(/\.json$/, ''));
  assert.match(files.txt.filename, /video-A-ja-asr-20261111T090100123Z/);
  assert.ok(files.txt.content.includes('videoTitle: "比較する動画"'));
  for (const r of source.routes) assert.ok(files.txt.content.includes(`[${r.method}]`));
  assert.ok(files.txt.content.includes('ラデオンを積んだ\n全文の最後'));
  assert.equal(files.txt.content.split('ラデオンを積んだ\n全文の最後').length - 1, 1);
  const routeSummaries = files.txt.content.split('=== TEXT BLOCKS')[0];
  assert.equal(routeSummaries.match(/rawFullText: T002/g)?.length, 2);
  assert.ok(routeSummaries.includes('reason: empty-response'));
  assert.ok(routeSummaries.includes('rawFullText: (empty)'));
  assert.ok(files.txt.content.includes('rawは秘匿化以外の整形前'));
});

test('file names separate different videos, tracks and runs', () => {
  const source = report();
  const name = buildDiagnosticExportFiles(source).txt.filename;
  assert.notEqual(name, buildDiagnosticExportFiles({ ...source, videoId: 'video-B' }).txt.filename);
  assert.notEqual(name, buildDiagnosticExportFiles({ ...source, createdAt: '2026-11-11T09:01:00.124Z' }).txt.filename);
  assert.notEqual(name, buildDiagnosticExportFiles({ ...source, selectedTrack: { languageCode: 'en', kind: '' } }).txt.filename);
});
