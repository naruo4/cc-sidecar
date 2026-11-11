/** Replay the EXACT observed URL in the logged-in page. Validate the current
 * video and exact selected track both before and after the bounded request. */
export async function fetchObservedCaptionFromPage(tabId, captionUrl, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', args: [captionUrl, selector],
    func: async (value, selected) => {
      let navigating = false;
      const markNavigation = () => { navigating = true; };
      document.addEventListener('yt-navigate-start', markNavigation);
      const matchesContext = () => {
        if (navigating) return false;
        const page = new URL(location.href);
        const videoId = page.pathname === '/watch' ? page.searchParams.get('v')
          : page.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/)?.[1];
        if (videoId !== selected.videoId) return false;
        let response;
        try { response = document.getElementById('movie_player')?.getPlayerResponse?.()
          || document.querySelector('ytd-player')?.getPlayerResponse?.() || window.ytInitialPlayerResponse; }
        catch { return false; }
        if (response?.videoDetails?.videoId !== selected.videoId) return false;
        const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
        const matches = tracks.filter(t => {
          try {
            const u = new URL(t.baseUrl);
            return u.searchParams.get('v') === selected.videoId
              && u.searchParams.get('lang') === selected.languageCode
              && (u.searchParams.get('kind') || '') === selected.kind
              && (u.searchParams.get('name') || '') === selected.name
              && (u.searchParams.get('tlang') || '') === selected.translation;
          } catch { return false; }
        });
        return matches.length === 1 && String(matches[0].vssId || '').trim() === selected.trackIdentity;
      };
      try {
        const u = new URL(value);
        if (u.protocol !== 'https:' || !['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(u.hostname)
          || u.pathname !== '/api/timedtext' || u.searchParams.get('v') !== selected.videoId
          || u.searchParams.get('lang') !== selected.languageCode
          || (u.searchParams.get('kind') || '') !== selected.kind
          || (u.searchParams.get('name') || '') !== selected.name
          || (u.searchParams.get('tlang') || '') !== selected.translation) {
          return { ok: false, errorCode: 'observed-caption-track-unverifiable' };
        }
        if (!matchesContext()) return { ok: false, errorCode: 'observed-caption-context-mismatch' };
        const response = await fetch(u.href, { credentials: 'include', cache: 'no-store', redirect: 'error',
          signal: AbortSignal.timeout(15000) });
        const body = await response.text();
        if (!matchesContext()) return { ok: false, status: response.status, errorCode: 'video-context-changed' };
        return { ok: response.ok, status: response.status, body, format: u.searchParams.get('fmt') || 'original',
          errorCode: response.ok ? (body ? '' : 'empty-response') : 'http-error' };
      } catch (error) {
        return { ok: false, errorCode: ['TimeoutError', 'AbortError'].includes(error?.name)
          ? 'request-timeout' : 'observed-caption-request-failed' };
      } finally { document.removeEventListener('yt-navigate-start', markNavigation); }
    }
  });
  return results?.[0]?.result || { ok: false, errorCode: 'observed-caption-result-unavailable' };
}
