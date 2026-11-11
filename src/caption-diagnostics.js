import { fetchObservedPlayerCaption } from './caption-observer-client.js';
import { parseVttCaptionBody } from './caption-parsers.js';
import { normalizeCueList, removeRepeatedTranscriptBlock, buildReadableTranscript } from './text.js';
import { getCaptionTrackIdentity, parseTimestampText, parseTranscriptPanelBody, canUseUnverifiedDomFallback } from './silent-transcript.js';
import { fetchSilentTranscriptPanelFromPage, fetchAlternatePlayerCaptionFromPage,
  readRenderedTranscript, readRenderedTranscriptV2, readCurrentVideoIdentity } from './youtube.js';
import { readPlayerDiagnosticSources, fetchDiagnosticCaptionFromPage } from './diagnostic-page.js';

const FORMATS = ['json3', 'srv3', 'vtt', ''];
const bytes = value => new TextEncoder().encode(value).length;
const KNOWN_FAILURES = new Map([
  ['transcript panel request metadata unavailable', 'panel-request-metadata-unavailable'],
  ['YouTube request context unavailable', 'youtube-request-context-unavailable'],
  ['YouTube player request context unavailable', 'youtube-player-context-unavailable'],
  ['silent transcript request returned no result', 'panel-result-unavailable']
]);
const failureReason = (result, fallback) => result.errorCode || KNOWN_FAILURES.get(result.error)
  || (result.status >= 400 ? 'http-error' : fallback);

// Output uses an allowlist: never export API response objects, request context,
// URLs, headers, cookies, tracking fields, or arbitrary browser error messages.
// Subtitle content is also redacted when it contains a URL or credential syntax.
export function redactDiagnosticText(value) {
  return String(value ?? '')
    .replace(/https?(?::|%3a)(?:\/|%2f|\\\/){2}[^\s<>"']+/gi, '[URL REDACTED]')
    .replace(/\b(?:Bearer\s+|SAPISIDHASH\s+)[A-Za-z0-9_.:+/=-]+/gi, '[AUTH REDACTED]')
    .replace(/\b(cookie|set-cookie|authorization)\s*[:=][^\r\n]*/gi, '$1: [REDACTED]')
    .replace(/\b(signature|sig|token|access_token|poToken|pot|key|visitorData)\s*[=:]\s*[^\s&,;]+/gi, '$1=[REDACTED]');
}
const readText = value => typeof value === 'string' ? value
  : String(value?.simpleText ?? value?.content ?? (value?.runs || []).map(r => r.text || '').join(''));

/** Extract original text in response order. No deduplication, whitespace cleanup,
 * duration inference, repetition removal or missing-word reconstruction. */
export function extractDiagnosticSegments(body, format = '') {
  const source = String(body || '');
  if (format === 'panel' || source.trim().startsWith('{')) {
    const data = JSON.parse(source);
    if (format !== 'panel') return (data.events || []).filter(e => Array.isArray(e.segs)).map(e => ({
      startMs: Number(e.tStartMs || 0), durationMs: Number(e.dDurationMs || 0),
      text: e.segs.map(s => s.utf8 || '').join(''),
      parts: e.segs.map(s => ({ text: String(s.utf8 || ''), offsetMs: Number(s.tOffsetMs || 0) })),
      append: e.aAppend === 1, windowId: e.wWinId ?? null
    }));
    const cues = [];
    const visit = (obj, depth = 0) => {
      if (!obj || typeof obj !== 'object' || depth > 40) return;
      const vm = obj.transcriptSegmentViewModel;
      const r = obj.transcriptSegmentRenderer;
      if (vm) cues.push({ startMs: parseTimestampText(vm.timestamp || readText(vm.startTimeText)),
        durationMs: 0, text: readText(vm.simpleText || vm.snippet || vm.text) });
      if (r) {
        const start = Number(r.startMs ?? r.startTimeMs ?? parseTimestampText(readText(r.startTimeText)));
        const end = Number(r.endMs ?? r.endTimeMs ?? parseTimestampText(readText(r.endTimeText)));
        cues.push({ startMs: start, durationMs: Math.max(0, end - start), text: readText(r.snippet || r.text) });
      }
      Object.values(obj).forEach(child => visit(child, depth + 1));
    };
    visit(data);
    return cues;
  }
  if (format === 'vtt' || source.trim().startsWith('WEBVTT')) {
    return source.replace(/\r/g, '').split(/\n\n+/).flatMap(block => {
      const lines = block.split('\n');
      const i = lines.findIndex(l => l.includes('-->'));
      if (i < 0) return [];
      const times = lines[i].split('-->').map(t => parseTimestampText(t.trim().split(/\s/)[0]));
      return [{ startMs: times[0], durationMs: Math.max(0, times[1] - times[0]), text: lines.slice(i + 1).join('\n') }];
    });
  }
  if (!source.trim()) return [];
  const xml = new DOMParser().parseFromString(source, 'text/xml');
  if (xml.querySelector('parsererror')) throw new Error('invalid-xml');
  return [...xml.querySelectorAll('text, p')].map(n => ({
    startMs: n.hasAttribute('t') ? Number(n.getAttribute('t')) : Number(n.getAttribute('start') || 0) * 1000,
    durationMs: n.hasAttribute('d') ? Number(n.getAttribute('d')) : Number(n.getAttribute('dur') || 0) * 1000,
    text: n.textContent || ''
  }));
}

export function makeDiagnosticRoute(method, result = {}, format = '') {
  let segments = result.segments || [];
  let reason = result.reason || result.errorCode || '';
  try {
    if (!result.segments && result.ok) segments = extractDiagnosticSegments(result.body, format);
  } catch { reason = 'response-parse-failed'; }
  // Explicit projection also keeps secrets out of DOM and injected-page results.
  const rawSegments = segments.map(s => ({
    startMs: Number(s.startMs || 0), durationMs: Number(s.durationMs || 0), text: redactDiagnosticText(s.text),
    ...(s.parts ? { parts: s.parts.map(p => ({ text: redactDiagnosticText(s.text) !== String(s.text ?? '') ? '[REDACTED WITH SEGMENT]' : redactDiagnosticText(p.text), offsetMs: Number(p.offsetMs || 0) })),
      append: Boolean(s.append), windowId: Number.isFinite(Number(s.windowId)) ? Number(s.windowId) : null } : {})
  }));
  const isVtt = format === 'vtt' || String(result.body || '').trim().startsWith('WEBVTT');
  const formattedSource = isVtt && result.ok && result.body
    ? parseVttCaptionBody(result.body).map(s => ({ ...s, text: redactDiagnosticText(s.text) }))
    : format === 'panel' && result.ok && result.body
    ? parseTranscriptPanelBody(result.body).map(s => ({ ...s, text: redactDiagnosticText(s.text) })) : rawSegments;
  const processed = removeRepeatedTranscriptBlock(normalizeCueList(formattedSource));
  const rawFullText = rawSegments.map(s => s.text).join('\n');
  if (!reason && !rawSegments.some(s => s.text)) reason = result.ok
    ? (result.body ? 'no-caption-segments' : 'empty-response') : (result.status >= 400 ? 'http-error' : 'request-failed');
  return { method, format: format || 'original', httpStatus: result.status || null,
    responseBytes: typeof result.body === 'string' ? bytes(result.body) : (result.bodyBytes ?? null),
    sizeMeaning: typeof result.body === 'string' ? 'UTF-8 decoded response body (not compressed transfer bytes)' : 'not available or metadata response',
    segmentCount: rawSegments.length, rawSegments, rawFullText,
    formattedSegments: processed, formattedFullText: buildReadableTranscript(processed),
    reason: redactDiagnosticText(reason), outcome: reason ? (rawSegments.length ? 'partial' : 'unavailable') : 'success',
    coverage: result.coverage || 'returned payload; completeness not guaranteed',
    trackVerification: result.trackVerification || 'selected track request; server response identity not independently verified',
    redacted: rawSegments.some((s, i) => s.text !== String(segments[i]?.text ?? '')) };
}

function withTimeout(action) {
  let timer;
  return Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), 20000);
  })]).finally(() => clearTimeout(timer));
}

/** Independent routes, never stop at first successful caption payload. */
export async function runCaptionDiagnostics(input, onRoute = () => {}, overrides = {}) {
  const { tabId, track, availableTracks, expectedVideoIdentity } = input;
  const collectionStartedAt = new Date().toISOString();
  const deps = { fetchPage: fetchDiagnosticCaptionFromPage, panel: fetchSilentTranscriptPanelFromPage,
    alternate: fetchAlternatePlayerCaptionFromPage, legacy: readRenderedTranscript, modern: readRenderedTranscriptV2,
    observed: fetchObservedPlayerCaption, player: readPlayerDiagnosticSources, identity: readCurrentVideoIdentity, fetch: globalThis.fetch, ...overrides };
  const routes = [];
  const attempt = async (method, action, format = '') => {
    let result;
    try {
      if (await deps.identity(tabId) !== expectedVideoIdentity) result = { reason: 'video-context-changed' };
      else {
        result = await withTimeout(action);
        if (await deps.identity(tabId) !== expectedVideoIdentity) result = { reason: 'video-context-changed' };
      }
    } catch (error) { result = { reason: ['TimeoutError', 'AbortError'].includes(error?.name)
      ? 'request-timeout' : error?.name === 'TypeError' ? 'invalid-request-or-network-error' : 'route-execution-failed' }; }
    const route = makeDiagnosticRoute(method, result, format || result.format || '');
    routes.push(route);
    onRoute(route);
    return result;
  };
  const player = await attempt('player-displayed-snapshot', async () => {
    const r = await deps.player(tabId, expectedVideoIdentity, track);
    return { ...r, ok: !r.errorCode, segments: r.displayed?.text ? [r.displayed] : [],
      reason: r.errorCode || (r.displayed?.text ? '' : 'no-displayed-player-caption'),
      coverage: 'current displayed caption only; timestamp is playback position, not cue start',
      trackVerification: 'player current selection; may differ from Sidecar selection' };
  });
  await attempt('player-webrequest-timedtext', async () => ({
    ...await deps.observed(input), coverage: 're-fetch of webRequest-observed page caption URL; not historical response bytes',
    trackVerification: 'video/lang/kind/name/tlang and unique opaque track identity verified before and after fetch'
  }));
  for (const format of FORMATS) await attempt(`extension-timedtext-${format || 'original'}`, async () => {
    const u = new URL(track?.baseUrl);
    if (u.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname)
      || u.pathname !== '/api/timedtext') return { reason: 'caption-url-unavailable' };
    if (format) u.searchParams.set('fmt', format);
    const r = await deps.fetch(u.href, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) });
    return { ok: r.ok, status: r.status, body: await r.text() };
  }, format);
  for (const format of FORMATS) await attempt(`page-timedtext-${format || 'original'}`,
    () => deps.fetchPage(tabId, track?.baseUrl || '', format), format);
  await attempt('get-panel', async () => {
    const r = await deps.panel(tabId, track, availableTracks, expectedVideoIdentity);
    if (!r.ok || r.trackIdentity !== getCaptionTrackIdentity(track)) return {
      status: r.status, bodyBytes: bytes(r.body || ''), reason: failureReason(r, 'panel-unavailable-or-track-unverified')
    };
    return r;
  }, 'panel');
  const alternate = await attempt('alternate-player-metadata', async () => {
    const r = await deps.alternate(tabId, track, availableTracks, expectedVideoIdentity);
    return { ...r, reason: r.skipped ? 'existing-route-skipped-non-xpe' : r.ok ? 'metadata-only-no-caption-text' : failureReason(r, 'alternate-player-unavailable') };
  });
  for (const format of FORMATS) await attempt(`alternate-player-timedtext-${format || 'original'}`,
    () => alternate.ok && alternate.baseUrl ? deps.fetchPage(tabId, alternate.baseUrl, format)
      : { reason: 'alternate-player-track-unavailable' }, format);
  for (const [method, reader] of [['dom-legacy', deps.legacy], ['dom-modern', deps.modern]]) {
    await attempt(method, async () => {
      if (!canUseUnverifiedDomFallback(track, availableTracks)) return { reason: 'dom-track-unverifiable' };
      const r = await reader(tabId, true);
      return { ok: true, segments: r.cues || [], coverage: 'visible transcript DOM only; original segment text; reader may omit virtualized segments and duplicate DOM rows',
        reason: r.cues?.length ? '' : 'no-visible-transcript-segments', trackVerification: 'single available track; DOM identity not exposed' };
    });
  }
  await attempt('player-native-texttracks', () => {
    const tracks = (player.nativeTracks || []).filter(t => t.language === track?.languageCode);
    return { ok: true, segments: tracks.length === 1 ? tracks[0].cues : [],
      reason: tracks.length === 1 && tracks[0].cues?.length ? '' : 'native-texttrack-unavailable-or-ambiguous',
      coverage: 'browser native TextTrack cues currently exposed only', trackVerification: 'language match only; manual/ASR identity unverified' };
  });
  if (!player.resources?.length) await attempt('player-observed-timedtext', () => ({ reason: 'no-matching-resource-timing-entry' }));
  for (const [index, resource] of (player.resources || []).entries()) await attempt(`player-observed-timedtext-${index + 1}`,
    async () => ({ ...await deps.fetchPage(tabId, resource.url, ''),
      coverage: 're-fetch of observed request URL; not the historical player response',
      trackVerification: 'URL video/lang/kind/name/tlang match; resource initiator not provable' }), resource.format === 'original' ? '' : resource.format);
  const comparisons = [];
  for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
    if (routes[i].segmentCount && routes[j].segmentCount) comparisons.push({
      left: routes[i].method, right: routes[j].method,
      rawFullTextEqual: routes[i].rawFullText === routes[j].rawFullText,
      formattedFullTextEqual: routes[i].formattedFullText === routes[j].formattedFullText
    });
  }
  for (const route of routes) route.comparisonKey = route.method.startsWith('player-observed-timedtext')
    ? `player-observed-timedtext:${route.format}` : route.method;
  return { schemaVersion: 2, collectionStartedAt,
    videoTitle: redactDiagnosticText(input.videoTitle || ''),
    extensionVersion: /^\d+(?:\.\d+){1,3}$/.test(input.extensionVersion || '') ? input.extensionVersion : '',
    createdAt: new Date().toISOString(), videoId: /^[\w-]{1,64}$/.test(expectedVideoIdentity) ? expectedVideoIdentity : '',
    selectedTrack: { label: redactDiagnosticText(track?.label || ''), languageCode: redactDiagnosticText(track?.languageCode), kind: redactDiagnosticText(track?.kind),
      identity: redactDiagnosticText(getCaptionTrackIdentity(track)) },
    notes: ['rawSegments/rawFullText are caption-only projections with secret redaction; not complete HTTP bodies.',
      'rawFullText joins original segment text with LF; duplicates, append events and whitespace are preserved.',
      'formatted fields use ordinary Sidecar whitespace/repetition processing. No missing words are inferred.',
      'null HTTP status means no HTTP response or a non-network source. Failures do not imply absence of captions.'],
    routes, comparisons };
}
