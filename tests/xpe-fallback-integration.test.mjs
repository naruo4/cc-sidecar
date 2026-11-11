import assert from 'node:assert/strict';
import test from 'node:test';

import { loadCaptionTrack } from '../src/captions.js';

const VIDEO_ID = 'xpe-video-test';
const WEB_TIMED_TEXT_URL =
  `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}`
  + '&lang=en&kind=asr&exp=xpe&source=web';
const ALTERNATE_TIMED_TEXT_URL =
  `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}`
  + '&lang=en&kind=asr&exp=xpo&source=alternate';

const selectedTrack = {
  baseUrl: WEB_TIMED_TEXT_URL,
  languageCode: 'en',
  label: 'English (auto-generated)',
  kind: 'asr',
  vssId: 'a.en',
  trackIdentity: 'a.en'
};

const otherTrack = {
  baseUrl: `https://www.youtube.com/api/timedtext?v=${VIDEO_ID}&lang=ja`,
  languageCode: 'ja',
  label: 'Japanese',
  kind: '',
  vssId: '.ja',
  trackIdentity: '.ja'
};

const initialAcquisitionEvents = ['execute:alternate-player', 'fetch:page:alternate-player'];
const successfulAcquisitionEvents = [...initialAcquisitionEvents,
  'execute:page-timed-text:alternate:json3', 'fetch:page:alternate:json3'];
const panelEvents = ['execute:silent-panel-metadata', 'execute:get-panel', 'fetch:page:get-panel'];

function makeResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  };
}

function captionBody() {
  return JSON.stringify({
    events: [
      {
        tStartMs: 1000,
        dDurationMs: 2000,
        segs: [{ utf8: 'First alternate cue' }]
      },
      {
        tStartMs: 4000,
        dDurationMs: 2500,
        segs: [{ utf8: 'Second alternate cue' }]
      }
    ]
  });
}

async function runLoadScenario(mode) {
  const events = [];
  const playerRequests = [];
  let pageExecutionDepth = 0;
  let currentVideoIdentity = VIDEO_ID;

  const player = {
    getPlayerResponse: () => ({
      videoDetails: { videoId: currentVideoIdentity }
    })
  };

  const locationMock = {
    get href() {
      return `https://www.youtube.com/watch?v=${currentVideoIdentity}`;
    },
    origin: 'https://www.youtube.com',
    hostname: 'www.youtube.com',
    pathname: '/watch'
  };

  const documentMock = {
    addEventListener: () => {},
    removeEventListener: () => {},
    getElementById: (id) => (id === 'movie_player' ? player : null),
    querySelector: () => null,
    querySelectorAll: () => mode === 'panel-metadata-failure' ? [] : [{ data: {
      primaryButton: { buttonRenderer: { command: { commandExecutorCommand: { commands: [{
        updateEngagementPanelContentCommand: { contentSourcePanelIdentifier: { tag: 'transcript' },
          globalConfiguration: { params: 'test-panel-params' } }
      }] } } } }
    } }]
  };

  const pageContext = {
    client: {
      hl: 'en',
      gl: 'US',
      visitorData: 'test-visitor-data'
    }
  };
  const windowMock = {
    ytcfg: {
      get: (key) => ({
        INNERTUBE_CONTEXT: pageContext,
        INNERTUBE_API_KEY: 'test-page-api-key',
        VISITOR_DATA: pageContext.client.visitorData
      })[key]
    }
  };

  const fetchMock = async (urlString, options = {}) => {
    const url = new URL(urlString);

    if (url.pathname === '/youtubei/v1/player') {
      events.push('fetch:page:alternate-player');
      if (mode === 'player-network-failure') throw new TypeError('network failed');
      const request = JSON.parse(String(options.body || '{}'));
      const client = request?.context?.client || {};
      playerRequests.push({
        clientName: client.clientName,
        clientVersion: client.clientVersion,
        videoId: request.videoId,
        apiKey: url.searchParams.get('key')
      });

      if (
        client.clientName !== 'ANDROID'
        || client.clientVersion !== '21.26.364'
        || mode === 'profile-failure'
      ) {
        return makeResponse(404, JSON.stringify({ error: { code: 404 } }));
      }

      let alternateTracks;
      if (mode === 'wrong-identity') {
        alternateTracks = [{
          baseUrl: ALTERNATE_TIMED_TEXT_URL,
          languageCode: 'ja',
          kind: '',
          vssId: otherTrack.vssId
        }];
      } else if (mode === 'duplicate-identity') {
        const duplicate = {
          baseUrl: ALTERNATE_TIMED_TEXT_URL,
          languageCode: 'en',
          kind: 'asr',
          vssId: selectedTrack.vssId
        };
        alternateTracks = [duplicate, { ...duplicate }];
      } else {
        alternateTracks = [{
          baseUrl: ALTERNATE_TIMED_TEXT_URL,
          languageCode: 'en',
          kind: 'asr',
          vssId: selectedTrack.vssId
        }];
      }

      const body = JSON.stringify({
        playabilityStatus: { status: 'OK' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: alternateTracks
          }
        }
      });

      if (mode === 'context-changed') {
        currentVideoIdentity = 'different-video';
      }

      return makeResponse(200, body);
    }

    if (url.pathname === '/youtubei/v1/get_panel') {
      events.push('fetch:page:get-panel');
      if (mode === 'both-network-failure') throw new TypeError('panel network failed');
      return makeResponse(mode === 'panel-http-failure' ? 503 : 200, JSON.stringify({
        transcriptSegmentRenderer: { startMs: '0', endMs: '2000', snippet: { simpleText: 'Panel fallback cue' } }
      }));
    }

    if (url.pathname === '/api/timedtext') {
      const source = url.searchParams.get('source') || 'unknown';
      const format = url.searchParams.get('fmt') || 'original';
      const context = pageExecutionDepth ? 'page' : 'extension';
      events.push(`fetch:${context}:${source}:${format}`);

      if (source === 'alternate' && format === 'json3') {
        if (['caption-network-failure', 'both-network-failure'].includes(mode)) throw new TypeError('caption network failed');
        if (mode === 'caption-timeout') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
        if (mode === 'malformed-json3') return makeResponse(200, '{invalid json');
        if (mode === 'caption-http-failure') return makeResponse(403, 'denied');
        if (['empty-json3', 'panel-http-failure', 'panel-metadata-failure'].includes(mode)) return makeResponse(200, '');
        return makeResponse(200, captionBody());
      }

      return makeResponse(200, '');
    }

    throw new Error(`Unexpected test fetch: ${url.pathname}`);
  };

  const chromeMock = {
    scripting: {
      executeScript: async ({ func, args }) => {
        if (!Array.isArray(args)) {
          events.push('execute:unexpected-dom-fallback');
          return [{ result: { cues: [], diagnostics: [] } }];
        }

        if (args.length === 4) {
          events.push('execute:get-panel');
        } else if (args.length === 1) {
          events.push('execute:silent-panel-metadata');
        } else if (typeof args[1] === 'object') {
          events.push('execute:alternate-player');
          if (mode === 'player-injection-failure') throw new Error('injection failed');
        } else {
          const url = new URL(args[0]);
          const source = url.searchParams.get('source') || 'unknown';
          events.push(
            `execute:page-timed-text:${source}:${args[1] || 'original'}`
          );
        }

        pageExecutionDepth += 1;
        try {
          return [{ result: await func(...args) }];
        } finally {
          pageExecutionDepth -= 1;
        }
      }
    }
  };

  if (mode.startsWith('observed-')) chromeMock.runtime = { sendMessage: async message => {
    if (message.type === 'caption-probe-start') return { token: 'probe' };
    if (message.type === 'caption-probe-end') return { ok: true };
    if (mode === 'observed-exception') throw new Error('https://youtube.com/?signature=PRIVATE_SIGNATURE');
    if (mode === 'observed-malformed') return { ok: true, status: 200, body: '{invalid' };
    if (mode === 'observed-empty') return { ok: true, status: 200, body: '' };
    if (mode === 'observed-http-error') return { ok: false, status: 403, body: '' };
    return { ok: false, errorCode: mode === 'observed-expired' ? 'observed-caption-url-expired' : 'observed-caption-url-unavailable' };
  } };

  const replacements = {
    chrome: chromeMock,
    document: documentMock,
    fetch: fetchMock,
    location: locationMock,
    window: windowMock
  };
  const previousDescriptors = new Map();

  for (const [name, value] of Object.entries(replacements)) {
    previousDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value
    });
  }

  try {
    const result = await loadCaptionTrack({
      tabId: 17,
      track: mode === 'non-xpe' ? { ...selectedTrack, baseUrl: selectedTrack.baseUrl.replace('&exp=xpe', '') } : selectedTrack,
      availableTracks: [selectedTrack, otherTrack],
      expectedVideoIdentity: VIDEO_ID
    });

    return { events, playerRequests, result };
  } finally {
    for (const [name, descriptor] of previousDescriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }
}

test('normal acquisition executes alternate JSON3 first and falls back only to panel', async (t) => {
  for (const mode of ['success', 'non-xpe']) await t.test(`${mode}: exact alternate JSON3 succeeds without panel or other formats`, async () => {
    const { events, playerRequests, result } = await runLoadScenario(mode);
    assert.equal(result.method, 'alternate-player-timed-text');
    assert.equal(result.cues.length, 2);
    assert.deepEqual(events, successfulAcquisitionEvents);
    assert.deepEqual(playerRequests, [{ clientName: 'ANDROID', clientVersion: '21.26.364', videoId: VIDEO_ID, apiKey: 'test-page-api-key' }]);
    assert.ok(result.diagnostics.some(line => line.startsWith('alternate-player:json3 HTTP 200 ') && line.endsWith('2 cues')));
  });
  for (const mode of ['observed-unavailable', 'observed-expired', 'observed-empty',
    'observed-malformed', 'observed-http-error', 'observed-exception']) await t.test(`${mode}: existing alternate JSON3 fallback succeeds`, async () => {
    const { events, result } = await runLoadScenario(mode);
    assert.equal(result.method, 'alternate-player-timed-text');
    assert.equal(result.cues.length, 2);
    assert.deepEqual(events, successfulAcquisitionEvents);
    assert.doesNotMatch(JSON.stringify(result.diagnostics), /PRIVATE_SIGNATURE/);
  });
  for (const mode of ['profile-failure', 'wrong-identity', 'duplicate-identity', 'empty-json3',
    'malformed-json3', 'caption-http-failure', 'caption-network-failure', 'caption-timeout',
    'player-network-failure', 'player-injection-failure']) await t.test(`${mode}: panel fallback succeeds`, async () => {
    const { events, result } = await runLoadScenario(mode);
    assert.equal(result.method, 'silent-panel-data');
    assert.equal(result.cues[0].text, 'Panel fallback cue');
    assert.deepEqual(events.slice(-3), panelEvents);
    assert.equal(events[0], 'execute:alternate-player');
    assert.ok(events.every(e => !e.includes(':web:') && !e.includes(':srv3') && !e.includes(':vtt') && !e.includes('dom')));
    if (['wrong-identity', 'duplicate-identity'].includes(mode)) assert.ok(!events.includes('fetch:page:alternate:json3'));
  });
  for (const mode of ['panel-http-failure', 'panel-metadata-failure', 'both-network-failure']) await t.test(`${mode}: both routes unavailable returns no cues`, async () => {
    const { events, result } = await runLoadScenario(mode);
    assert.equal(result.method, 'none');
    assert.deepEqual(result.cues, []);
    assert.ok(events.includes('execute:silent-panel-metadata'));
    assert.ok(!events.some(e => e.includes(':web:') || e.includes('dom')));
  });
  await t.test('context-changed: stops immediately without panel or wrong-video captions', async () => {
    const { events, result } = await runLoadScenario('context-changed');
    assert.equal(result.method, 'none');
    assert.deepEqual(result.cues, []);
    assert.deepEqual(events, initialAcquisitionEvents);
    assert.ok(result.diagnostics.some(line => line.includes('video-context-changed')));
  });
});
