import test from 'node:test';
import { createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import { createObservedCaptionCache, buildObservedCaptionSelector, installCaptionRequestObserver } from '../src/observed-captions.js';
import { fetchObservedCaptionFromPage } from '../src/observed-caption-page.js';
import { fetchObservedPlayerCaption } from '../src/caption-observer-client.js';
import { fetchCaptionBodyFromPage } from '../src/youtube.js';
import { loadCaptionTrack } from '../src/captions.js';
import { runCaptionDiagnostics } from '../src/caption-diagnostics.js';

const VIDEO = 'public-video';
const pageUrl = id => `https://www.youtube.com/watch?v=${id}`;
const captionUrl = (id = VIDEO, extra = '') => `https://www.youtube.com/api/timedtext?v=${id}&lang=ja&kind=asr&fmt=json3&signature=PRIVATE_SIGNATURE${extra}`;
const trackFor = id => ({ baseUrl: captionUrl(id), languageCode: 'ja', kind: 'asr', label: '日本語', vssId: 'a.ja', trackIdentity: 'a.ja' });
const inputFor = (id = VIDEO) => ({ tabId: 1, track: trackFor(id), availableTracks: [trackFor(id)], expectedVideoIdentity: id });
const event = (url = captionUrl(), extra = {}) => ({ tabId: 1, frameId: 0, type: 'xmlhttprequest', initiator: 'https://www.youtube.com', url, ...extra });
const selector = buildObservedCaptionSelector(inputFor());
const jsonBody = text => JSON.stringify({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: text }] }] });
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness({ clock = () => 1000000, tabUrls = new Map([[1, pageUrl(VIDEO)]]), tabWorlds = new Map(), replay } = {}) {
  const listeners = {};
  const api = { runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`,
    onMessage: { addListener: fn => { listeners.message = fn; } } },
    scripting: { executeScript: async ({ target, world, func, args }) => {
      assert.equal(world, 'ISOLATED');
      if (!tabUrls.has(target.tabId)) throw new Error('tab closed');
      let context = tabWorlds.get(target.tabId);
      if (!context) {
        const events = {};
        context = createContext({ URL, Date: { now: clock }, events,
          document: { addEventListener: (name, fn) => { events[name] = fn; } },
          addEventListener: (name, fn) => { events[name] = fn; } });
        tabWorlds.set(target.tabId, context);
      }
      context.location = new URL(tabUrls.get(target.tabId)); context.args = args;
      return [{ result: runInContext(`(${func.toString()})(...args)`, context) }];
    } },
    tabs: { get: async id => ({ id, url: tabUrls.get(id) }),
      onUpdated: { addListener: fn => { listeners.updated = fn; } },
      onRemoved: { addListener: fn => { listeners.removed = tabId => { tabUrls.delete(tabId); tabWorlds.delete(tabId); fn(tabId); }; } } },
    webRequest: { onBeforeRequest: { addListener: (fn, filter) => { listeners.request = fn; listeners.filter = filter; } } } };
  const cache = installCaptionRequestObserver(api, replay || (async () => ({ ok: true, status: 200, body: jsonBody('ラデオンを積んだ'), format: 'json3' })), createObservedCaptionCache(clock));
  const sender = { id: 'extension', url: api.runtime.getURL('sidepanel.html') };
  const send = (message, from = sender) => new Promise(resolve => {
    let answered = false;
    const async = listeners.message(message, from, value => { answered = true; resolve(value); });
    if (!async && !answered) resolve(undefined);
  });
  api.runtime.sendMessage = send;
  return { api, cache, listeners, send, tabUrls, tabWorlds,
    acquire: (selected = selector, tabId = 1) => send({ type: 'fetch-observed-caption', tabId, selector: selected }) };
}

function setGlobals(values) {
  const previous = Object.fromEntries(Object.keys(values).map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const [k, value] of Object.entries(values)) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value });
  return () => { for (const [k, descriptor] of Object.entries(previous)) {
    if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k];
  } };
}

test('request cache rejects other tabs/videos/languages/kinds/names/translations and ambiguous tracks', () => {
  const c = createObservedCaptionCache(() => 1000000);
  c.capture(event(), pageUrl(VIDEO), 0);
  assert.equal(c.lookup(1, selector).url, captionUrl());
  assert.equal(c.lookup(2, selector).errorCode, 'observed-caption-url-unavailable');
  for (const patch of [{ videoId: 'other' }, { languageCode: 'en' }, { kind: '' }, { name: 'other' }, { translation: 'en' }]) {
    assert.equal(c.lookup(1, { ...selector, ...patch }).errorCode, 'observed-caption-url-unavailable');
  }
  const i = inputFor();
  assert.equal(buildObservedCaptionSelector({ ...i, availableTracks: [...i.availableTracks, { ...i.track, vssId: 'a.other', trackIdentity: 'a.other' }] }), null);
  assert.equal(buildObservedCaptionSelector({ ...i, expectedVideoIdentity: 'other' }), null);
  for (const extra of [{ frameId: 2 }, { tabId: -1 }, { initiator: 'chrome-extension://extension' }, { documentLifecycle: 'prerender' }]) {
    const fresh = createObservedCaptionCache(() => 1000000);
    fresh.capture(event(captionUrl(), extra), pageUrl(VIDEO), 0);
    assert.ok(!fresh.lookup(1, selector).url);
  }
  for (const url of [captionUrl('other'), captionUrl(VIDEO, '&seq=1'), 'https://example.com/api/timedtext?v=public-video&lang=ja']) {
    const fresh = createObservedCaptionCache(() => 1000000);
    fresh.capture(event(url), pageUrl(VIDEO), 0);
    assert.ok(!fresh.lookup(1, selector).url);
  }
});

test('URLs expire, clear on navigation/tab close and are absent in a fresh document', async () => {
  let now = 1000000;
  const h = harness({ clock: () => now });
  h.listeners.request(event(captionUrl(VIDEO, '&expire=1010'))); await settle();
  assert.equal((await h.acquire()).status, 200);
  now = 1010001;
  assert.equal((await h.acquire()).errorCode, 'observed-caption-url-expired');
  h.listeners.request(event()); await settle();
  h.listeners.updated(1, { url: pageUrl('other') });
  assert.equal((await h.acquire()).errorCode, 'observed-caption-url-unavailable');
  h.listeners.request(event()); await settle();
  h.listeners.removed(1);
  assert.equal(h.cache.lookup(1, selector).errorCode, 'observed-caption-url-unavailable');
  assert.equal((await harness().acquire()).errorCode, 'observed-caption-url-unavailable');
});

test('delayed request lookups cannot restore old video data or record Sidecar probes', async () => {
  const h = harness();
  let resolveTab;
  h.api.tabs.get = () => new Promise(resolve => { resolveTab = resolve; });
  h.listeners.request(event());
  h.listeners.updated(1, { status: 'loading' });
  resolveTab({ url: pageUrl(VIDEO) }); await settle();
  assert.ok(!h.cache.lookup(1, selector).url);
  h.api.tabs.get = async () => ({ url: pageUrl(VIDEO) });
  const { token } = await h.send({ type: 'caption-probe-start', tabId: 1 });
  h.listeners.request(event());
  await h.send({ type: 'caption-probe-end', tabId: 1, token });
  await settle();
  assert.ok(!h.cache.lookup(1, selector).url);
  h.listeners.request(event()); await settle();
  assert.ok(h.cache.lookup(1, selector).url);
});

test('observer is non-blocking, exposes only subtitle results, and rejects non-panel senders', async () => {
  const h = harness();
  h.listeners.request(event()); await settle();
  assert.deepEqual(h.listeners.filter.types, ['xmlhttprequest']);
  assert.equal(await h.send({ type: 'fetch-observed-caption', tabId: 1, selector }, { id: 'other', url: pageUrl(VIDEO) }), undefined);
  const result = await h.acquire();
  assert.equal(result.status, 200);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SIGNATURE|signature=|https:/);
  assert.deepEqual(Object.keys(result).sort(), ['body', 'errorCode', 'format', 'ok', 'status']);
});

test('failed cached URL is discarded; navigation during replay drops response', async () => {
  const failed = harness({ replay: async () => ({ ok: false, status: 403, body: '', errorCode: 'http-error' }) });
  failed.listeners.request(event()); await settle();
  assert.equal((await failed.acquire()).errorCode, 'http-error');
  assert.equal((await failed.acquire()).errorCode, 'observed-caption-url-unavailable');
  let h;
  h = harness({ replay: async () => { h.listeners.updated(1, { url: pageUrl('other') }); return { ok: true, status: 200, body: jsonBody('wrong-video') }; } });
  h.listeners.request(event()); await settle();
  const result = await h.acquire();
  assert.equal(result.errorCode, 'video-context-changed');
  assert.ok(!result.body);
});

test('public and members-only scenarios replay exact signed URLs through MAIN-world fetch and load full text', async t => {
  for (const id of [VIDEO, 'members-video']) await t.test(id, async () => {
    const i = inputFor(id);
    const text = id === 'members-video' ? 'メンバー字幕全文の末尾まで取得。'.repeat(15000) : '公開字幕の全文。';
    const body = jsonBody(text);
    const requests = [];
    const h = harness({ tabUrls: new Map([[1, pageUrl(id)]]), replay: fetchObservedCaptionFromPage });
    const playerResponse = { videoDetails: { videoId: id }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [i.track] } } };
    const restore = setGlobals({ chrome: h.api, location: new URL(pageUrl(id)), window: {},
      document: { addEventListener() {}, removeEventListener() {}, getElementById: () => ({ getPlayerResponse: () => playerResponse }), querySelector: () => null },
      fetch: async (url, options) => {
        requests.push({ url, options });
        h.listeners.request(event(url)); // Replay must not pollute the cache.
        return { ok: true, status: 200, text: async () => body };
      } });
    const isolated = h.api.scripting;
    h.api.scripting = { executeScript: async options => {
      if (options.world === 'ISOLATED') return isolated.executeScript(options);
      assert.equal(options.world, 'MAIN'); return [{ result: await options.func(...options.args) }];
    } };
    try {
      h.listeners.request(event(captionUrl(id))); await settle();
      const result = await loadCaptionTrack(i);
      assert.equal(result.method, 'player-webrequest-timedtext');
      assert.equal(result.cues[0].text, text);
      assert.equal(requests.length, 1); // No alternate player or panel request.
      assert.equal(requests[0].url, captionUrl(id));
      assert.equal(requests[0].options.credentials, 'include');
      assert.equal(requests[0].options.cache, 'no-store');
      assert.equal(requests[0].options.redirect, 'error');
      assert.doesNotMatch(JSON.stringify(result.diagnostics), /PRIVATE_SIGNATURE|signature=/);
      if (id === 'members-video') assert.ok(new TextEncoder().encode(body).length > 619095);
    } finally { restore(); }
  });
});

test('MAIN-world replay refuses stale video/track metadata and drops a response after SPA navigation', async () => {
  let navigate;
  let current = VIDEO;
  let tracks = [trackFor(VIDEO)];
  let calls = 0;
  const restore = setGlobals({ chrome: { scripting: { executeScript: async ({ func, args }) => [{ result: await func(...args) }] } },
    location: new URL(pageUrl(VIDEO)), window: {}, document: {
      addEventListener: (_, fn) => { navigate = fn; }, removeEventListener() {}, querySelector: () => null,
      getElementById: () => ({ getPlayerResponse: () => ({ videoDetails: { videoId: current }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }) }) },
    fetch: async () => { calls++; navigate(); return { ok: true, status: 200, text: async () => jsonBody('must drop') }; } });
  try {
    current = 'other';
    assert.equal((await fetchObservedCaptionFromPage(1, captionUrl(), selector)).errorCode, 'observed-caption-context-mismatch');
    current = VIDEO; tracks = [{ ...trackFor(VIDEO), vssId: 'wrong-track' }];
    assert.equal((await fetchObservedCaptionFromPage(1, captionUrl(), selector)).errorCode, 'observed-caption-context-mismatch');
    assert.equal(calls, 0);
    tracks = [trackFor(VIDEO)];
    assert.equal((await fetchObservedCaptionFromPage(1, captionUrl(), selector)).errorCode, 'video-context-changed');
    assert.equal(calls, 1);
  } finally { restore(); }
});

test('new observation appears as an independent comparison route without leaking signed URLs', async () => {
  const h = harness();
  const restore = setGlobals({ chrome: h.api });
  try {
    h.listeners.request(event()); await settle();
    const report = await runCaptionDiagnostics(inputFor(), undefined, {
      identity: async () => VIDEO, observed: fetchObservedPlayerCaption,
      player: async () => ({ resources: [] }), fetch: async () => ({ ok: true, status: 200, text: async () => '' }),
      fetchPage: async () => ({ ok: true, status: 200, body: '' }), panel: async () => ({ ok: false }),
      alternate: async () => ({ ok: false }), legacy: async () => ({ cues: [] }), modern: async () => ({ cues: [] })
    });
    const route = report.routes.find(r => r.method === 'player-webrequest-timedtext');
    assert.equal(route.rawFullText, 'ラデオンを積んだ');
    assert.equal(route.format, 'json3');
    assert.equal(report.routes.length, 20);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_SIGNATURE|signature=|https:\/\//);
  } finally { restore(); }
});


test('idle worker restart restores URL from extension-private tab RAM without storage or keepalive', async () => {
  const tabWorlds = new Map();
  const first = harness({ tabWorlds });
  first.listeners.request(event()); await settle();
  const restarted = harness({ tabWorlds });
  assert.ok(!restarted.cache.lookup(1, selector).url);
  const result = await restarted.acquire();
  assert.equal(result.status, 200);
  assert.equal(result.body, jsonBody('ラデオンを積んだ'));
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_SIGNATURE/);
  tabWorlds.get(1).events.pagehide();
  assert.equal((await harness({ tabWorlds }).acquire()).errorCode, 'observed-caption-url-unavailable');
  first.listeners.request(event()); await settle();
  tabWorlds.get(1).events['yt-navigate-start']();
  assert.equal((await harness({ tabWorlds }).acquire()).errorCode, 'observed-caption-url-unavailable');
  restarted.listeners.updated(1, { status: 'loading' }); await settle();
  assert.equal((await harness({ tabWorlds }).acquire()).errorCode, 'observed-caption-url-unavailable');
});


test('existing page-fetch helper cannot replace the observed player URL with an alternate probe', async () => {
  const h = harness();
  const isolated = h.api.scripting;
  h.api.scripting = { executeScript: async options => options.world === 'ISOLATED'
    ? isolated.executeScript(options) : [{ result: await options.func(...options.args) }] };
  const restore = setGlobals({ chrome: h.api, fetch: async url => {
    h.listeners.request(event(url));
    return { ok: true, status: 200, text: async () => jsonBody('alternate') };
  } });
  try {
    h.listeners.request(event()); await settle();
    await fetchCaptionBodyFromPage(1, captionUrl(VIDEO, '&source=alternate'), 'json3');
    await settle();
    assert.equal(h.cache.lookup(1, selector).url, captionUrl());
    const restarted = harness({ tabWorlds: h.tabWorlds });
    await restarted.acquire();
    assert.equal(restarted.cache.lookup(1, selector).url, captionUrl());
  } finally { restore(); }
});

test('members-only: legacy timedtext HTTP 200/0B fails, then observed signed URL recovers full captions', async () => {
  const id = 'members-video';
  const i = inputFor(id);
  const h = harness({ tabUrls: new Map([[1, pageUrl(id)]]), replay: fetchObservedCaptionFromPage });
  const isolated = h.api.scripting;
  h.api.scripting = { executeScript: async options => options.world === 'ISOLATED'
    ? isolated.executeScript(options) : [{ result: await options.func(...options.args) }] };
  const alternateUrl = captionUrl(id, '&source=alternate');
  const calls = [];
  const restore = setGlobals({ chrome: h.api, location: new URL(pageUrl(id)),
    window: { ytcfg: { get: key => key === 'INNERTUBE_CONTEXT' ? { client: { hl: 'ja', gl: 'JP' } } : 'fixture-context' } },
    document: { addEventListener() {}, removeEventListener() {}, querySelector: () => null,
      getElementById: () => ({ getPlayerResponse: () => ({ videoDetails: { videoId: id }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [i.track] } } }) }),
      querySelectorAll: () => [{ data: { primaryButton: { buttonRenderer: { command: { commandExecutorCommand: { commands: [{
        updateEngagementPanelContentCommand: { contentSourcePanelIdentifier: { tag: 'transcript' }, globalConfiguration: { params: 'fixture' } }
      }] } } } } } }] },
    fetch: async url => {
      calls.push(url);
      let body = '';
      if (url.includes('/youtubei/v1/player')) body = JSON.stringify({ playabilityStatus: { status: 'OK' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ ...i.track, baseUrl: alternateUrl }] } } });
      if (url === captionUrl(id)) body = jsonBody('メンバー限定動画の字幕全文');
      return { ok: true, status: 200, text: async () => body };
    } });
  try {
    const before = await loadCaptionTrack(i);
    assert.equal(before.method, 'none');
    assert.deepEqual(before.cues, []);
    assert.ok(before.diagnostics.some(line => line === 'alternate-player:json3 HTTP 200 0B 0 cues'));
    assert.ok(before.diagnostics.some(line => line.includes('HTTP 200 0B 0 cues') && line.startsWith('silent-panel')));
    h.listeners.request(event(captionUrl(id))); await settle();
    calls.length = 0;
    const after = await loadCaptionTrack(i);
    assert.equal(after.method, 'player-webrequest-timedtext');
    assert.equal(after.cues[0].text, 'メンバー限定動画の字幕全文');
    assert.deepEqual(calls, [captionUrl(id)]);
  } finally { restore(); }
});
