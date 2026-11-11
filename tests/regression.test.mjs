import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseJson3CaptionBody,
  parseVttCaptionBody
} from '../src/caption-parsers.js';
import {
  buildMarkdownTranscript,
  buildPlainTranscript,
  buildReadableTranscript,
  buildTimestampTranscript
} from '../src/text.js';

const root = new URL('../', import.meta.url);

test('normal acquisition uses observed player URL, alternate JSON3 then panel; other routes remain diagnostic-only', async () => {
  const source = await readFile(new URL('src/captions.js', root), 'utf8');
  const acquisition = source.slice(source.indexOf('export async function loadCaptionTrack'));
  assert.ok(acquisition.indexOf('await fetchObservedPlayerCaption') < acquisition.indexOf('await fetchAlternatePlayerCaptionFromPage'));
  assert.ok(acquisition.indexOf('await fetchAlternatePlayerCaptionFromPage') < acquisition.indexOf('await fetchSilentTranscriptPanelFromPage'));
  assert.match(acquisition, /fetchCaptionBodyFromPage\(tabId, alternateResult.baseUrl, 'json3'\)/);
  assert.doesNotMatch(acquisition, /readRenderedTranscript|fetchTimedTextFromExtension|'srv3'|'vtt'/);
  const diagnostics = await readFile(new URL('src/caption-diagnostics.js', root), 'utf8');
  for (const route of ['extension-timedtext', 'page-timedtext', 'dom-legacy', 'dom-modern', 'player-observed-timedtext']) assert.ok(diagnostics.includes(route));
});

test('caption acquisition contains no automatic page clicks or expansion', async () => {
  const source = await readFile(new URL('src/youtube.js', root), 'utf8');

  assert.doesNotMatch(source, /\.click\s*\(/);
  assert.doesNotMatch(source, /#expand/);
  assert.doesNotMatch(source, /show transcript/i);
  assert.doesNotMatch(source, /文字起こし/);
});

test('caption results fail closed across SPA identity changes', async () => {
  const appSource = await readFile(new URL('src/app.js', root), 'utf8');
  const youtubeSource = await readFile(new URL('src/youtube.js', root), 'utf8');
  const captionsSource = await readFile(new URL('src/captions.js', root), 'utf8');

  assert.match(appSource, /readCurrentVideoIdentity/);
  assert.match(appSource, /currentVideoIdentity !== expectedVideoIdentity/);
  assert.match(youtubeSource, /yt-navigate-start/);
  assert.match(youtubeSource, /video-context-changed/);
  assert.match(captionsSource, /alternateResult.errorCode === 'video-context-changed'/);
});

test('manifest permissions remain exactly scoped to YouTube Side Panel use', async () => {
  const manifest = JSON.parse(
    await readFile(new URL('manifest.json', root), 'utf8')
  );

  assert.deepEqual(manifest.permissions, ['scripting', 'sidePanel', 'webRequest']);
  assert.deepEqual(manifest.host_permissions, [
    'https://www.youtube.com/*',
    'https://youtube.com/*',
    'https://m.youtube.com/*'
  ]);
  assert.equal(manifest.background.type, 'module');
  assert.equal(manifest.version, '0.5.0');
  assert.equal(manifest.default_locale, 'en');
  assert.equal(manifest.name, '__MSG_extensionName__');
  assert.equal(manifest.description, '__MSG_extensionDescription__');
});

test('English and Japanese store summaries are packaged and within limit', async () => {
  const en = JSON.parse(
    await readFile(new URL('_locales/en/messages.json', root), 'utf8')
  );
  const ja = JSON.parse(
    await readFile(new URL('_locales/ja/messages.json', root), 'utf8')
  );

  assert.equal(en.extensionName.message, 'CC Sidecar');
  assert.equal(ja.extensionName.message, 'CC Sidecar');
  assert.ok(en.extensionDescription.message.length <= 132);
  assert.ok(ja.extensionDescription.message.length <= 132);
  assert.match(en.extensionDescription.message, /Side Panel/);
  assert.match(ja.extensionDescription.message, /サイドパネル/);
});

test('existing JSON3 and WebVTT caption parsing remains intact', () => {
  assert.deepEqual(parseJson3CaptionBody(JSON.stringify({
    events: [{
      tStartMs: 1000,
      dDurationMs: 2000,
      segs: [{ utf8: 'Hello ' }, { utf8: 'world' }]
    }]
  })), [
    { startMs: 1000, durationMs: 2000, text: 'Hello world' }
  ]);

  assert.deepEqual(parseVttCaptionBody([
    'WEBVTT',
    '',
    '00:01.000 --> 00:03.000',
    'Hello world'
  ].join('\n')), [
    { startMs: 1000, durationMs: 2000, text: 'Hello world' }
  ]);
});

test('existing copy and export formats remain intact', () => {
  const cues = [
    { startMs: 1000, durationMs: 1000, text: 'Hello' },
    { startMs: 2200, durationMs: 1000, text: 'world.' }
  ];

  assert.equal(buildPlainTranscript(cues), 'Hello world.');
  assert.equal(buildReadableTranscript(cues), 'Hello world.');
  assert.equal(
    buildTimestampTranscript(cues),
    '[00:01] Hello\n[00:02] world.'
  );
  assert.match(buildMarkdownTranscript({
    title: 'Video',
    url: 'https://www.youtube.com/watch?v=test',
    trackLabel: 'English',
    languageCode: 'en',
    cues
  }), /# Video[\s\S]*Captions: English \(en\)[\s\S]*Hello world\./);
});

test('JP and EN UI dictionaries and persistence remain functional', async () => {
  const saved = new Map();
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value)
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { languages: ['ja-JP'], language: 'ja-JP' }
  });
  globalThis.document = { documentElement: { lang: '' } };

  const i18n = await import('../src/i18n.js');
  assert.equal(i18n.getLanguage(), 'ja');
  assert.equal(i18n.translate('button.copyPlain'), '全文をコピー');

  i18n.setLanguage('en');
  assert.equal(i18n.translate('button.copyPlain'), 'Copy full transcript');
  assert.equal(saved.get('transcriptSidecar.uiLanguage'), 'en');
  assert.equal(document.documentElement.lang, 'en');

  i18n.setLanguage('ja');
  assert.equal(i18n.translate('button.copyPlain'), '全文をコピー');
  assert.equal(document.documentElement.lang, 'ja');
});
