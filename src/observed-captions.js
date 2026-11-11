import { getCaptionTrackIdentity } from './silent-transcript.js';

const HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);
const MAX_AGE_MS = 60 * 60 * 1000;
export function videoIdFromUrl(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return '';
    return u.pathname === '/watch' ? u.searchParams.get('v') || ''
      : u.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/)?.[1] || '';
  } catch { return ''; }
}
function captionDescriptor(value) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || !HOSTS.has(u.hostname) || u.pathname !== '/api/timedtext'
      || !u.searchParams.get('v') || !u.searchParams.get('lang')
      || ['seq', 'sq', 'tseq'].some(k => u.searchParams.has(k))) return null;
    return { videoId: u.searchParams.get('v'), languageCode: u.searchParams.get('lang'),
      kind: u.searchParams.get('kind') || '', name: u.searchParams.get('name') || '',
      translation: u.searchParams.get('tlang') || '' };
  } catch { return null; }
}
const descriptorKey = d => JSON.stringify([d.videoId, d.languageCode, d.kind, d.name, d.translation]);

/** Reject indistinguishable same-language tracks rather than guessing. No URL
 * or request credential is included in the selector sent by the side panel. */
export function buildObservedCaptionSelector({ track, availableTracks, expectedVideoIdentity }) {
  const identity = getCaptionTrackIdentity(track);
  const selected = (availableTracks || []).filter(t => getCaptionTrackIdentity(t) === identity);
  const d = captionDescriptor(track?.baseUrl);
  if (!identity || selected.length !== 1 || !d || d.videoId !== expectedVideoIdentity
    || d.languageCode !== track.languageCode || d.kind !== (track.kind || '')) return null;
  const matches = availableTracks.filter(t => {
    const other = captionDescriptor(t.baseUrl);
    return other && descriptorKey(other) === descriptorKey(d);
  });
  return matches.length === 1 ? { ...d, trackIdentity: identity } : null;
}

/** Signed URLs live only in worker/tab RAM; probe tokens only in worker RAM.
 * No storage, worker keepalive or polling. */
export function createObservedCaptionCache(now = Date.now) {
  const tabs = new Map();
  const generations = new Map();
  const probes = new Map();
  function pruneProbes(tabId) {
    const active = probes.get(tabId);
    if (!active) return false;
    for (const [token, expiry] of active) if (expiry <= now()) active.delete(token);
    if (!active.size) probes.delete(tabId);
    return active.size > 0;
  }
  function capture(details, currentTabUrl, generation) {
    if (generation !== (generations.get(details.tabId) || 0) || details.tabId < 0
      || details.frameId !== 0 || details.type !== 'xmlhttprequest'
      || (details.documentLifecycle && details.documentLifecycle !== 'active')
      || pruneProbes(details.tabId)) return;
    try { const initiator = new URL(details.initiator);
      if (initiator.protocol !== 'https:' || !HOSTS.has(initiator.hostname)) return; } catch { return; }
    const d = captionDescriptor(details.url);
    if (!d || d.videoId !== videoIdFromUrl(currentTabUrl)) return;
    const u = new URL(details.url);
    const expiry = u.searchParams.has('expire') ? Number(u.searchParams.get('expire')) * 1000 : Infinity;
    if (!(expiry > now())) return;
    const entries = tabs.get(details.tabId) || new Map();
    const key = descriptorKey(d);
    entries.delete(key);
    entries.set(key, { url: details.url, expiresAt: Math.min(expiry, now() + MAX_AGE_MS) });
    while (entries.size > 12) entries.delete(entries.keys().next().value);
    tabs.set(details.tabId, entries);
    return { selector: d, entry: entries.get(key) };
  }
  function lookup(tabId, selector) {
    const key = descriptorKey(selector);
    const entry = tabs.get(tabId)?.get(key);
    if (!entry) return { errorCode: 'observed-caption-url-unavailable' };
    if (entry.expiresAt <= now()) {
      tabs.get(tabId).delete(key);
      return { errorCode: 'observed-caption-url-expired' };
    }
    return entry;
  }
  return { capture, lookup, isSuppressed: pruneProbes,
    restore(tabId, selector, entry) {
      const descriptor = captionDescriptor(entry?.url);
      if (!descriptor || descriptorKey(descriptor) !== descriptorKey(selector) || !(entry.expiresAt > now())) return;
      const entries = tabs.get(tabId) || new Map();
      entries.set(descriptorKey(selector), { url: entry.url, expiresAt: entry.expiresAt });
      tabs.set(tabId, entries);
    },
    generation: tabId => generations.get(tabId) || 0,
    clear(tabId) { tabs.delete(tabId); probes.delete(tabId); generations.set(tabId, (generations.get(tabId) || 0) + 1); },
    discard(tabId, selector, url) {
      const key = descriptorKey(selector);
      if (tabs.get(tabId)?.get(key)?.url === url) tabs.get(tabId).delete(key);
    },
    suppress(tabId) {
      const token = crypto.randomUUID();
      const active = probes.get(tabId) || new Map();
      active.set(token, now() + 45000);
      probes.set(tabId, active);
      return token;
    },
    resume(tabId, token) { probes.get(tabId)?.delete(token); }
  };
}

// Isolated-world globals are extension-private, document-local RAM, never DOM
// attributes or browser storage. They survive idle worker shutdown but disappear
// when the tab document closes/reloads. Every operation checks the current URL.
export async function observedCaptionTabMemory(api, tabId, operation, selector = null, entry = null) {
  const results = await api.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
    args: [operation, selector, entry], func: (op, selected, record) => {
      const slot = '__transcriptSidecarObservedCaptionMemory';
      if (op === 'clear') { delete globalThis[slot]; return null; }
      // Also clear before SPA navigation/pagehide, including BFCache history.
      // Event listeners affect only our RAM, never the player's network APIs.
      if (!globalThis.__transcriptSidecarCaptionMemoryEvents) {
        const clear = () => { delete globalThis[slot]; };
        globalThis.document?.addEventListener('yt-navigate-start', clear);
        globalThis.addEventListener?.('pagehide', clear);
        globalThis.__transcriptSidecarCaptionMemoryEvents = true;
      }
      const u = new URL(location.href);
      const id = u.pathname === '/watch' ? u.searchParams.get('v')
        : u.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/)?.[1];
      if (!selected || id !== selected.videoId) return null;
      let state = globalThis[slot];
      if (!state || state.videoId !== id) state = globalThis[slot] = { videoId: id, entries: new Map() };
      const key = JSON.stringify([selected.videoId, selected.languageCode, selected.kind, selected.name, selected.translation]);
      for (const [k, item] of state.entries) if (item.expiresAt <= Date.now()) state.entries.delete(k);
      if (op === 'write' && record?.expiresAt > Date.now()) {
        state.entries.delete(key); state.entries.set(key, record);
        while (state.entries.size > 12) state.entries.delete(state.entries.keys().next().value);
      }
      if (op === 'discard' && state.entries.get(key)?.url === record?.url) state.entries.delete(key);
      return op === 'read' ? state.entries.get(key) || null : null;
    }
  });
  return results?.[0]?.result || null;
}

export function installCaptionRequestObserver(api, fetchFromPage, cache = createObservedCaptionCache()) {
  const panelUrl = api.runtime.getURL('sidepanel.html');
  api.webRequest.onBeforeRequest.addListener(details => {
    if (details.tabId < 0 || details.frameId !== 0 || cache.isSuppressed(details.tabId)) return;
    const generation = cache.generation(details.tabId);
    // No URLs enter logs, storage, extension messages or exported diagnostics.
    // The generation check prevents delayed tabs.get from reviving stale data.
    api.tabs.get(details.tabId).then(async tab => {
      const captured = cache.capture(details, tab.url, generation);
      if (captured) {
        await observedCaptionTabMemory(api, details.tabId, 'write', captured.selector, captured.entry);
        if (cache.generation(details.tabId) !== generation) {
          await observedCaptionTabMemory(api, details.tabId, 'discard', captured.selector, captured.entry);
        }
      }
    }).catch(() => {});
  }, { urls: ['https://www.youtube.com/api/timedtext*', 'https://youtube.com/api/timedtext*',
    'https://m.youtube.com/api/timedtext*'], types: ['xmlhttprequest'] });
  api.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url || change.status === 'loading') {
      cache.clear(tabId);
      observedCaptionTabMemory(api, tabId, 'clear').catch(() => {});
    }
  });
  api.tabs.onRemoved.addListener(tabId => cache.clear(tabId));
  api.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== api.runtime.id || sender.url !== panelUrl || !Number.isInteger(message?.tabId)
      || message.tabId < 0) return false;
    if (message.type === 'caption-probe-start') {
      reply({ token: cache.suppress(message.tabId) }); return false;
    }
    if (message.type === 'caption-probe-end') {
      cache.resume(message.tabId, message.token); reply({ ok: true }); return false;
    }
    if (message.type !== 'fetch-observed-caption') return false;
    (async () => {
      const selector = message.selector;
      if (!selector?.videoId || !selector.trackIdentity || !selector.languageCode) {
        return { ok: false, errorCode: 'observed-caption-track-unverifiable' };
      }
      const generation = cache.generation(message.tabId);
      const tab = await api.tabs.get(message.tabId);
      if (videoIdFromUrl(tab.url) !== selector.videoId) return { ok: false, errorCode: 'video-context-changed' };
      let entry = cache.lookup(message.tabId, selector);
      if (!entry.url) {
        try {
          const saved = await observedCaptionTabMemory(api, message.tabId, 'read', selector);
          if (cache.generation(message.tabId) !== generation) return { ok: false, errorCode: 'video-context-changed' };
          if (saved) { cache.restore(message.tabId, selector, saved); entry = cache.lookup(message.tabId, selector); }
        } catch { /* A suspended worker or closed document may have no entry. */ }
      }
      if (!entry.url) return { ok: false, errorCode: entry.errorCode };
      const token = cache.suppress(message.tabId);
      try {
        const result = await fetchFromPage(message.tabId, entry.url, selector);
        if (cache.generation(message.tabId) !== generation) return { ok: false, errorCode: 'video-context-changed' };
        if (!result.ok || !result.body) {
          cache.discard(message.tabId, selector, entry.url);
          try { await observedCaptionTabMemory(api, message.tabId, 'discard', selector, entry); } catch { /* document may be gone */ }
        }
        // Explicit projection: never return the cached entry/URL or arbitrary errors.
        return { ok: Boolean(result.ok), status: Number(result.status) || 0, body: String(result.body || ''),
          format: ['json3', 'srv3', 'srv1', 'vtt'].includes(result.format) ? result.format : 'original',
          errorCode: result.errorCode || (!result.body ? 'empty-response' : '') };
      } finally { cache.resume(message.tabId, token); }
    })().then(reply, () => reply({ ok: false, errorCode: 'observed-caption-request-failed' }));
    return true;
  });
  return cache;
}
