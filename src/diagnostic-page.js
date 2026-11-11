import { withCaptionProbe } from './caption-observer-client.js';
// Diagnostic-only MAIN-world helpers. No hooks, clicks, player setting changes,
// authentication headers, or persistent network logs are installed.
export async function readPlayerDiagnosticSources(tabId, expectedVideoIdentity, track) {
  const results = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    args: [expectedVideoIdentity, { languageCode: track?.languageCode || '', kind: track?.kind || '', baseUrl: track?.baseUrl || '' }],
    func: (expected, selected) => {
      const url = new URL(location.href);
      const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live)\/([^/]+)/)?.[1];
      if (!expected || id !== expected) return { errorCode: 'video-context-changed' };
      const video = document.querySelector('video');
      const displayed = Array.from(document.querySelectorAll('#movie_player .ytp-caption-segment'))
        .map(el => el.textContent || '');
      const nativeTracks = Array.from(video?.textTracks || []).map(t => ({
        language: t.language, kind: t.kind, mode: t.mode,
        cues: Array.from(t.cues || []).map(c => ({ startMs: c.startTime * 1000,
          durationMs: (c.endTime - c.startTime) * 1000, text: c.text || '' }))
      }));
      let selectedUrl;
      try { selectedUrl = new URL(selected.baseUrl); } catch { /* no track */ }
      // Resource Timing exposes request URLs, not historical response bodies.
      // Only replay a current-video, same language/kind/name/translation URL.
      const resources = performance.getEntriesByType('resource').flatMap(entry => {
        try {
          const u = new URL(entry.name);
          if (entry.initiatorType !== 'xmlhttprequest' || u.origin !== location.origin || u.pathname !== '/api/timedtext'
            || u.searchParams.get('v') !== expected || !selectedUrl
            || ['lang', 'kind', 'name', 'tlang'].some(k =>
              (u.searchParams.get(k) || '') !== (selectedUrl.searchParams.get(k) || ''))) return [];
          return [{ url: u.href, format: u.searchParams.get('fmt') || 'original',
            observedStartMs: entry.startTime }];
        } catch { return []; }
      });
      // XHR only: exclude our own fetch probes, including previous runs.
      // Latest distinct URL per format, bounded to avoid replaying old variants.
      const latest = new Map();
      for (const r of resources) latest.set(r.format, r);
      return { resources: [...latest.values()].slice(-8), nativeTracks,
        displayed: { startMs: (video?.currentTime || 0) * 1000,
          durationMs: 0, text: displayed.join('') } };
    }
  });
  return results?.[0]?.result || { errorCode: 'page-result-unavailable' };
}

export async function fetchDiagnosticCaptionFromPage(tabId, url, format) {
  const results = await withCaptionProbe(tabId, () => chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', args: [url, format],
    func: async (value, fmt) => {
      try {
        const u = new URL(value);
        if (u.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname)
          || u.pathname !== '/api/timedtext') return { ok: false, status: null, errorCode: 'invalid-caption-url' };
        if (fmt) u.searchParams.set('fmt', fmt);
        const response = await fetch(u.href, { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(15000) });
        return { ok: response.ok, status: response.status, body: await response.text() };
      } catch (error) { return { ok: false, status: null, errorCode:
        ['TimeoutError', 'AbortError'].includes(error?.name) ? 'request-timeout' : 'network-request-failed' }; }
    }
  }));
  return results?.[0]?.result || { ok: false, status: null, errorCode: 'page-result-unavailable' };
}
