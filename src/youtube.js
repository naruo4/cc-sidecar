import { withCaptionProbe } from './caption-observer-client.js';
import {
  findTranscriptPanelRequest,
  getCaptionTrackIdentity,
  resolveAlternatePlayerCaptionTrack,
  resolveSilentPanelTrackSelection,
  selectCaptionTrackByIdentity
} from './silent-transcript.js';

// YouTube requires a valid version for non-WEB player clients. This is an
// internal compatibility profile, not an API credential. The route fails
// closed with diagnostics if YouTube retires it.
const ALTERNATE_PLAYER_CLIENT = Object.freeze({
  clientName: 'ANDROID',
  clientVersion: '21.26.364'
});

/**
 * Chrome scripting helpers for interacting with the active YouTube page.
 *
 * Functions passed to chrome.scripting.executeScript() are deliberately
 * self-contained because Chrome serializes them into the page's MAIN world.
 */

/**
 * Read video metadata and available caption tracks from YouTube's player.
 *
 * @param {number} tabId
 * @returns {Promise<{isYouTubeVideo: boolean, title: string, url: string, tracks: Array}>}
 */
export async function readVideoMetadata(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const hostname = location.hostname.replace(/^www\./, '');
      const isYouTubeHost = hostname === 'youtube.com' || hostname === 'm.youtube.com';
      const isVideoPath = location.pathname === '/watch'
        || location.pathname.startsWith('/shorts/')
        || location.pathname.startsWith('/live/');

      if (!isYouTubeHost || !isVideoPath) {
        return {
          isYouTubeVideo: false,
          title: document.title,
          url: location.href,
          tracks: []
        };
      }

      const player = document.getElementById('movie_player');
      const ytdPlayer = document.querySelector('ytd-player');

      let response = null;

      try {
        response = player?.getPlayerResponse?.() || null;
      } catch {
        response = null;
      }

      if (!response) {
        try {
          response = ytdPlayer?.getPlayerResponse?.() || null;
        } catch {
          response = null;
        }
      }

      if (!response && typeof window.ytInitialPlayerResponse !== 'undefined') {
        response = window.ytInitialPlayerResponse;
      }

      const url = new URL(location.href);
      const pathVideoIdentity = url.pathname === '/watch'
        ? String(url.searchParams.get('v') || '')
        : String(url.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/)?.[1] || '');
      const responseVideoIdentity = String(response?.videoDetails?.videoId || '');
      const videoIdentity = responseVideoIdentity
        && pathVideoIdentity
        && responseVideoIdentity !== pathVideoIdentity
        ? ''
        : responseVideoIdentity || pathVideoIdentity;

      const captionTracks = response
        ?.captions
        ?.playerCaptionsTracklistRenderer
        ?.captionTracks || [];

      const getTrackLabel = (track) => {
        const name = track?.name;

        if (name?.simpleText) return name.simpleText;
        if (Array.isArray(name?.runs)) {
          return name.runs.map((run) => run.text || '').join('');
        }

        return track?.languageCode || 'Unknown';
      };

      return {
        isYouTubeVideo: true,
        videoIdentity,
        title: response?.videoDetails?.title
          || document.title.replace(/\s*-\s*YouTube\s*$/, ''),
        url: location.href,
        tracks: (videoIdentity ? captionTracks : []).map((track) => ({
          baseUrl: track.baseUrl,
          languageCode: track.languageCode || '',
          label: getTrackLabel(track),
          kind: track.kind || '',
          vssId: track.vssId || '',
          isTranslatable: Boolean(track.isTranslatable)
        }))
      };
    }
  });

  const metadata = results?.[0]?.result || null;
  if (!metadata) return null;

  return {
    ...metadata,
    tracks: (Array.isArray(metadata.tracks) ? metadata.tracks : [])
      .map((track) => ({
        ...track,
        trackIdentity: getCaptionTrackIdentity(track)
      }))
  };
}

/**
 * Fetch one timed-text payload from the YouTube page context.
 *
 * @param {number} tabId
 * @param {string} baseUrl
 * @param {string} format
 * @returns {Promise<{ok: boolean, status: number, body: string}>}
 */
export async function fetchCaptionBodyFromPage(tabId, baseUrl, format) {
  const results = await withCaptionProbe(tabId, () => chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [baseUrl, format],
    func: async (urlString, requestedFormat) => {
      try {
        const url = new URL(urlString);
        if (requestedFormat) url.searchParams.set('fmt', requestedFormat);

        const response = await fetch(url.toString(), {
          credentials: 'include',
          cache: 'no-store',
          signal: AbortSignal.timeout(15000)
        });

        return {
          ok: response.ok,
          status: response.status,
          body: await response.text()
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          body: '',
          error: String(error?.message || error)
        };
      }
    }
  }));

  return results?.[0]?.result || { ok: false, status: 0, body: '' };
}

/**
 * Ask YouTube's own player endpoint for an alternate copy of the current
 * caption-track metadata for the primary JSON3 acquisition route.
 * No page command or visible UI is executed. The result is usable only when
 * one alternate track has the exact selected vssId.
 *
 * @param {number} tabId
 * @param {unknown} selectedTrack
 * @param {unknown[]} availableTracks
 * @param {string} expectedVideoIdentity
 * @returns {Promise<{ok: boolean, status: number, bodyBytes: number, trackCount: number, baseUrl?: string, trackIdentity?: string, playabilityStatus?: string, skipped?: boolean, unsafeSelection?: boolean, errorCode?: string, error?: string}>}
 */
export async function fetchAlternatePlayerCaptionFromPage(
  tabId,
  selectedTrack,
  availableTracks,
  expectedVideoIdentity
) {
  const selectedIdentity = getCaptionTrackIdentity(selectedTrack);
  if (!selectedIdentity) {
    return {
      ok: false,
      status: 0,
      bodyBytes: 0,
      trackCount: 0,
      unsafeSelection: true,
      errorCode: 'track-identity-unavailable',
      error: 'selected caption track identity unavailable'
    };
  }

  if (!selectCaptionTrackByIdentity(availableTracks, selectedIdentity)) {
    return {
      ok: false,
      status: 0,
      bodyBytes: 0,
      trackCount: 0,
      unsafeSelection: true,
      errorCode: 'track-identity-not-unique',
      error: 'selected caption track identity is stale or not unique'
    };
  }

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [
      String(expectedVideoIdentity || ''),
      ALTERNATE_PLAYER_CLIENT
    ],
    func: async (expectedIdentity, clientProfile) => {
      let navigationStarted = false;
      const markNavigation = () => {
        navigationStarted = true;
      };
      document.addEventListener('yt-navigate-start', markNavigation);

      const readVideoIdentity = () => {
        const url = new URL(location.href);
        const pathIdentity = url.pathname === '/watch'
          ? String(url.searchParams.get('v') || '')
          : String(url.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/)?.[1] || '');
        const player = document.getElementById('movie_player');
        const ytdPlayer = document.querySelector('ytd-player');
        let response = null;

        try {
          response = player?.getPlayerResponse?.() || null;
        } catch {
          response = null;
        }

        if (!response) {
          try {
            response = ytdPlayer?.getPlayerResponse?.() || null;
          } catch {
            response = null;
          }
        }

        const responseIdentity = String(response?.videoDetails?.videoId || '');
        if (responseIdentity && pathIdentity && responseIdentity !== pathIdentity) {
          return '';
        }
        return responseIdentity || pathIdentity;
      };

      try {
        if (!expectedIdentity || readVideoIdentity() !== expectedIdentity) {
          return {
            ok: false,
            status: 0,
            bodyBytes: 0,
            trackCount: 0,
            contextChanged: true,
            error: 'video identity changed before alternate player request'
          };
        }

        const pageContext = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
        const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');
        const pageClient = pageContext?.client;

        if (!pageClient || !apiKey) {
          return {
            ok: false,
            status: 0,
            bodyBytes: 0,
            trackCount: 0,
            error: 'YouTube player request context unavailable'
          };
        }

        const client = {
          clientName: String(clientProfile?.clientName || ''),
          clientVersion: String(clientProfile?.clientVersion || ''),
          hl: String(pageClient.hl || 'en'),
          gl: String(pageClient.gl || 'US')
        };
        const visitorData = pageClient.visitorData
          || window.ytcfg?.get?.('VISITOR_DATA');
        if (visitorData) client.visitorData = visitorData;

        const url = new URL('/youtubei/v1/player', location.origin);
        url.searchParams.set('key', apiKey);
        url.searchParams.set('prettyPrint', 'false');

        const headers = { 'content-type': 'application/json' };
        if (visitorData) headers['x-goog-visitor-id'] = visitorData;

        const response = await fetch(url.toString(), {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
          headers,
          body: JSON.stringify({
            context: { client },
            videoId: expectedIdentity,
            contentCheckOk: true,
            racyCheckOk: true
          })
        });

        const body = await response.text();
        const bodyBytes = new TextEncoder().encode(body).length;
        if (navigationStarted || readVideoIdentity() !== expectedIdentity) {
          return {
            ok: false,
            status: response.status,
            bodyBytes,
            trackCount: 0,
            contextChanged: true,
            error: 'video identity changed during alternate player request'
          };
        }

        let data = null;
        try {
          data = JSON.parse(body);
        } catch {
          data = null;
        }

        const tracks = data
          ?.captions
          ?.playerCaptionsTracklistRenderer
          ?.captionTracks || [];
        const playabilityStatus = String(data?.playabilityStatus?.status || '');

        return {
          ok: response.ok && playabilityStatus === 'OK',
          status: response.status,
          bodyBytes,
          trackCount: Array.isArray(tracks) ? tracks.length : 0,
          playabilityStatus,
          tracks: (Array.isArray(tracks) ? tracks : []).map((track) => ({
            baseUrl: String(track?.baseUrl || ''),
            languageCode: String(track?.languageCode || ''),
            kind: String(track?.kind || ''),
            vssId: String(track?.vssId || '')
          })),
          error: response.ok && playabilityStatus === 'OK'
            ? ''
            : `alternate player response unavailable (${playabilityStatus || response.status})`
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          bodyBytes: 0,
          trackCount: 0,
          contextChanged: navigationStarted
            || readVideoIdentity() !== expectedIdentity,
          error: String(error?.message || error)
        };
      } finally {
        document.removeEventListener('yt-navigate-start', markNavigation);
      }
    }
  });

  const result = results?.[0]?.result || {
    ok: false,
    status: 0,
    bodyBytes: 0,
    trackCount: 0,
    error: 'alternate player request returned no result'
  };

  if (result.contextChanged) {
    return {
      ...result,
      tracks: undefined,
      unsafeSelection: true,
      errorCode: 'video-context-changed'
    };
  }

  if (!result.ok) {
    return { ...result, tracks: undefined };
  }

  const selection = resolveAlternatePlayerCaptionTrack(
    selectedTrack,
    availableTracks,
    result.tracks
  );
  if (!selection.ok) {
    return {
      ...result,
      ok: false,
      tracks: undefined,
      errorCode: selection.errorCode,
      error: selection.error
    };
  }

  const baseUrl = String(selection.track?.baseUrl || '');
  if (!baseUrl) {
    return {
      ...result,
      ok: false,
      tracks: undefined,
      errorCode: 'alternate-track-url-unavailable',
      error: 'alternate player caption URL unavailable'
    };
  }

  return {
    ...result,
    tracks: undefined,
    baseUrl,
    trackIdentity: selection.trackIdentity
  };
}

/**
 * Fetch transcript data without opening or changing any YouTube page UI.
 *
 * The page already carries get_panel request metadata on its transcript-button
 * command. Reading that data and calling the same YouTube-owned endpoint is
 * independent from executing the command: no page element is clicked, no panel
 * is shown, and the description state is untouched.
 *
 * @param {number} tabId
 * @param {unknown} selectedTrack
 * @param {unknown[]} availableTracks
 * @param {string} expectedVideoIdentity
 * @returns {Promise<{ok: boolean, status: number, body: string, commandType?: string, trackIdentity?: string, unsafeSelection?: boolean, errorCode?: string, error?: string}>}
 */
export async function fetchSilentTranscriptPanelFromPage(
  tabId,
  selectedTrack,
  availableTracks,
  expectedVideoIdentity
) {
  const selection = resolveSilentPanelTrackSelection(
    selectedTrack,
    availableTracks
  );

  if (!selection.ok) {
    return {
      ok: false,
      status: 0,
      body: '',
      unsafeSelection: true,
      errorCode: selection.errorCode,
      error: selection.error
    };
  }

  const commandResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [String(expectedVideoIdentity || '')],
    func: (expectedIdentity) => {
      const readVideoIdentity = () => {
        const url = new URL(location.href);
        const pathIdentity = url.pathname === '/watch'
          ? String(url.searchParams.get('v') || '')
          : String(url.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/)?.[1] || '');
        const player = document.getElementById('movie_player');
        const ytdPlayer = document.querySelector('ytd-player');
        let response = null;

        try {
          response = player?.getPlayerResponse?.() || null;
        } catch {
          response = null;
        }

        if (!response) {
          try {
            response = ytdPlayer?.getPlayerResponse?.() || null;
          } catch {
            response = null;
          }
        }

        const responseIdentity = String(response?.videoDetails?.videoId || '');
        if (responseIdentity && pathIdentity && responseIdentity !== pathIdentity) {
          return '';
        }
        return responseIdentity || pathIdentity;
      };

      const videoIdentity = readVideoIdentity();
      if (!expectedIdentity || videoIdentity !== expectedIdentity) {
        return { videoIdentity, commandGroups: [], contextChanged: true };
      }

      return {
        videoIdentity,
        contextChanged: false,
        commandGroups: Array
          .from(document.querySelectorAll('ytd-video-description-transcript-section-renderer'))
          .map((section) => (
            section
              ?.data
              ?.primaryButton
              ?.buttonRenderer
              ?.command
              ?.commandExecutorCommand
              ?.commands || []
          ))
      };
    }
  });

  const commandResult = commandResults?.[0]?.result || null;
  if (
    !commandResult
    || commandResult.contextChanged
    || commandResult.videoIdentity !== expectedVideoIdentity
  ) {
    return {
      ok: false,
      status: 0,
      body: '',
      unsafeSelection: true,
      errorCode: 'video-context-changed',
      error: 'video identity changed before silent transcript request'
    };
  }

  const commandGroups = commandResult.commandGroups || [];
  const request = findTranscriptPanelRequest(commandGroups);

  if (!request) {
    return {
      ok: false,
      status: 0,
      body: '',
      error: 'transcript panel request metadata unavailable'
    };
  }

  const fetchResults = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [
      request.panelId,
      request.params,
      selection.languageCode,
      String(expectedVideoIdentity || '')
    ],
    func: async (panelId, params, requestedLanguage, expectedIdentity) => {
      let navigationStarted = false;
      const markNavigation = () => {
        navigationStarted = true;
      };
      document.addEventListener('yt-navigate-start', markNavigation);

      const readVideoIdentity = () => {
        const url = new URL(location.href);
        const pathIdentity = url.pathname === '/watch'
          ? String(url.searchParams.get('v') || '')
          : String(url.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/)?.[1] || '');
        const player = document.getElementById('movie_player');
        const ytdPlayer = document.querySelector('ytd-player');
        let response = null;

        try {
          response = player?.getPlayerResponse?.() || null;
        } catch {
          response = null;
        }

        if (!response) {
          try {
            response = ytdPlayer?.getPlayerResponse?.() || null;
          } catch {
            response = null;
          }
        }

        const responseIdentity = String(response?.videoDetails?.videoId || '');
        if (responseIdentity && pathIdentity && responseIdentity !== pathIdentity) {
          return '';
        }
        return responseIdentity || pathIdentity;
      };

      try {
        if (!expectedIdentity || readVideoIdentity() !== expectedIdentity) {
          return {
            ok: false,
            status: 0,
            body: '',
            contextChanged: true,
            error: 'video identity changed before silent transcript fetch'
          };
        }

        const pageContext = window.ytcfg?.get?.('INNERTUBE_CONTEXT');
        const apiKey = window.ytcfg?.get?.('INNERTUBE_API_KEY');

        if (!pageContext || !apiKey) {
          return {
            ok: false,
            status: 0,
            body: '',
            error: 'YouTube request context unavailable'
          };
        }

        const context = JSON.parse(JSON.stringify(pageContext));
        const language = String(requestedLanguage || '');

        if (/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) {
          context.client = context.client || {};
          context.client.hl = language;
        }

        const url = new URL('/youtubei/v1/get_panel', location.origin);
        url.searchParams.set('key', apiKey);
        url.searchParams.set('prettyPrint', 'false');

        const headers = {
          'content-type': 'application/json',
          'x-youtube-client-name': String(
            window.ytcfg?.get?.('INNERTUBE_CONTEXT_CLIENT_NAME') || 1
          ),
          'x-youtube-client-version': String(
            window.ytcfg?.get?.('INNERTUBE_CONTEXT_CLIENT_VERSION')
            || context?.client?.clientVersion
            || ''
          )
        };

        const visitorData = context?.client?.visitorData
          || window.ytcfg?.get?.('VISITOR_DATA');
        if (visitorData) headers['x-goog-visitor-id'] = visitorData;

        const response = await fetch(url.toString(), {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          signal: AbortSignal.timeout(15000),
          headers,
          body: JSON.stringify({ context, panelId, params })
        });

        const body = await response.text();
        if (navigationStarted || readVideoIdentity() !== expectedIdentity) {
          return {
            ok: false,
            status: response.status,
            body: '',
            contextChanged: true,
            error: 'video identity changed during silent transcript fetch'
          };
        }

        return {
          ok: response.ok,
          status: response.status,
          body
        };
      } catch (error) {
        return {
          ok: false,
          status: 0,
          body: '',
          contextChanged: navigationStarted
            || readVideoIdentity() !== expectedIdentity,
          error: String(error?.message || error)
        };
      } finally {
        document.removeEventListener('yt-navigate-start', markNavigation);
      }
    }
  });

  const fetchResult = fetchResults?.[0]?.result || {
    ok: false,
    status: 0,
    body: '',
    error: 'silent transcript request returned no result'
  };

  return {
    ...fetchResult,
    commandType: request.commandType,
    trackIdentity: selection.trackIdentity,
    unsafeSelection: Boolean(fetchResult.contextChanged),
    errorCode: fetchResult.contextChanged ? 'video-context-changed' : undefined
  };
}

/**
 * Read the stable identity of the video currently represented by both the
 * YouTube URL and player response. A mismatch during SPA navigation returns an
 * empty identity so callers fail closed.
 *
 * @param {number} tabId
 * @returns {Promise<string>}
 */
export async function readCurrentVideoIdentity(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: () => {
      const url = new URL(location.href);
      const pathIdentity = url.pathname === '/watch'
        ? String(url.searchParams.get('v') || '')
        : String(url.pathname.match(/^\/(?:shorts|live)\/([^/?#]+)/)?.[1] || '');
      const player = document.getElementById('movie_player');
      const ytdPlayer = document.querySelector('ytd-player');
      let response = null;

      try {
        response = player?.getPlayerResponse?.() || null;
      } catch {
        response = null;
      }

      if (!response) {
        try {
          response = ytdPlayer?.getPlayerResponse?.() || null;
        } catch {
          response = null;
        }
      }

      const responseIdentity = String(response?.videoDetails?.videoId || '');
      if (responseIdentity && pathIdentity && responseIdentity !== pathIdentity) {
        return '';
      }

      return responseIdentity || pathIdentity;
    }
  });

  return String(results?.[0]?.result || '');
}

/**
 * Read legacy rendered transcript segments only when the user has already
 * opened a visible YouTube transcript panel. Read-only: no clicks, waits, or
 * page-state changes.
 *
 * @param {number} tabId
 * @returns {Promise<{cues: Array, diagnostics: string[]}>}
 */
export async function readRenderedTranscript(tabId, preserveOriginalText = false) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [preserveOriginalText],
    func: (preserveOriginalText) => {
      const cleanText = (value) => String(value || '')
        .replace(/\u200b/g, '')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const parseTimestamp = (value) => {
        const parts = String(value || '').trim().split(':').map(Number);
        if (parts.some(Number.isNaN)) return 0;
        if (parts.length === 3) {
          return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
        }
        if (parts.length === 2) {
          return Math.round((parts[0] * 60 + parts[1]) * 1000);
        }
        return 0;
      };

      const isVisible = (element) => {
        if (!element?.getBoundingClientRect) return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const cues = Array
        .from(document.querySelectorAll('ytd-transcript-segment-renderer'))
        .filter(isVisible)
        .map((segment) => {
          const timestamp = segment.querySelector('.segment-timestamp')?.textContent
            || segment.querySelector('[class*="timestamp"]')?.textContent
            || '';
          const text = segment.querySelector('.segment-text')?.textContent
            || segment.querySelector('[class*="segment-text"]')?.textContent
            || '';

          return {
            startMs: parseTimestamp(timestamp),
            durationMs: 0,
            text: preserveOriginalText ? text : cleanText(text)
          };
        })
        .filter((cue) => cue.text);

      return {
        cues,
        diagnostics: [
          cues.length
            ? 'dom-legacy:read-only visible transcript panel'
            : 'dom-legacy:no visible rendered segments'
        ]
      };
    }
  });

  return results?.[0]?.result || { cues: [], diagnostics: [] };
}

/**
 * Fallback #4: read the user-opened transcript panel without relying on the
 * legacy ytd-transcript-* markup.
 *
 * Locates the visible transcript panel (an engagement panel whose target-id
 * contains "transcript", else a visible engagement panel holding several
 * timestamps, else the densest visible timestamp cluster outside the player),
 * then pairs each visible M:SS / H:MM:SS leaf element with the segment text
 * around it. Read-only: no clicks, no network requests, and only open shadow
 * roots are traversed.
 *
 * @param {number} tabId
 * @returns {Promise<{cues: Array, diagnostics: string[]}>}
 */
export async function readRenderedTranscriptV2(tabId, preserveOriginalText = false) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [preserveOriginalText],
    func: (preserveOriginalText) => {
      const TS_RE = /^\d{1,2}:\d{2}(?::\d{2})?$/;

      const cleanText = (value) => String(value || '')
        .replace(/\u200b/g, '')
        .replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const parseTimestamp = (value) => {
        const parts = String(value || '').trim().split(':').map(Number);
        if (parts.some(Number.isNaN)) return 0;
        if (parts.length === 3) {
          return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
        }
        if (parts.length === 2) {
          return Math.round((parts[0] * 60 + parts[1]) * 1000);
        }
        return 0;
      };

      const isVisible = (el) => {
        if (!el.getBoundingClientRect) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const parentOf = (node) => {
        if (node.parentElement) return node.parentElement;
        const root = node.getRootNode ? node.getRootNode() : null;
        return root && root.host ? root.host : null;
      };

      // A childless element counts as rendered only if it actually occupies
      // on-screen space. Screen-reader-only time labels ("0 秒", "1 分 5 秒")
      // are hidden structurally — collapsed to ~1px, display:none, or moved
      // off-screen left — so this identifies them without matching any text.
      // The check is restricted to leaf elements so that zero-size layout
      // wrappers can never hide visible spoken text they contain.
      const isRenderedLeaf = (el) => {
        if (typeof el.getBoundingClientRect !== 'function') return true;
        try {
          const rect = el.getBoundingClientRect();
          if (rect.width <= 1 || rect.height <= 1) return false;
          if (rect.right <= 0) return false;
          const style = typeof getComputedStyle === 'function'
            ? getComputedStyle(el)
            : null;
          if (style && (style.display === 'none' || style.visibility === 'hidden')) {
            return false;
          }
        } catch {
          return true;
        }
        return true;
      };

      // Same text coverage as textContent (light DOM only), but with one
      // subtree structurally excluded from the walk and non-rendered leaf
      // elements (accessibility-only labels) skipped.
      const collectTextWithout = (root, excluded) => {
        if (root === excluded) return '';
        if (root.nodeType === 3) return root.nodeValue || '';
        if (
          root.nodeType === 1
          && (!root.children || root.children.length === 0)
          && !isRenderedLeaf(root)
        ) {
          return '';
        }
        let out = '';
        for (const child of root.childNodes || []) {
          out += collectTextWithout(child, excluded);
        }
        return out;
      };

      const collectTimestampLeaves = (scope) => {
        const leaves = [];
        const walk = (root) => {
          let all;
          try {
            all = root.querySelectorAll('*');
          } catch {
            return;
          }
          for (const el of all) {
            if (el.shadowRoot) walk(el.shadowRoot);
            if (
              el.children.length === 0
              && TS_RE.test((el.textContent || '').trim())
              && isVisible(el)
            ) {
              leaves.push(el);
            }
          }
        };
        walk(scope);
        return leaves;
      };

      const isInsidePlayer = (leaf) => {
        let node = leaf;
        while (node) {
          if (
            node.id === 'movie_player'
            || (node.tagName && node.tagName.toLowerCase() === 'ytd-player')
          ) {
            return true;
          }
          node = parentOf(node);
        }
        return false;
      };

      let container = null;
      let containerReason = 'none';

      const panels = Array.from(
        document.querySelectorAll('ytd-engagement-panel-section-list-renderer')
      );

      for (const panel of panels) {
        const targetId = (panel.getAttribute('target-id') || '').toLowerCase();
        if (isVisible(panel) && targetId.includes('transcript')) {
          container = panel;
          containerReason = 'engagement-panel target-id';
          break;
        }
      }

      if (!container) {
        for (const panel of panels) {
          const targetId = (panel.getAttribute('target-id') || '').toLowerCase();
          if (!isVisible(panel)) continue;
          if (targetId.includes('macro-markers') || targetId.includes('chapters')) continue;
          if (collectTimestampLeaves(panel).length >= 3) {
            container = panel;
            containerReason = 'engagement-panel timestamp count';
            break;
          }
        }
      }

      if (!container) {
        const allLeaves = collectTimestampLeaves(document)
          .filter((leaf) => !isInsidePlayer(leaf));
        const buckets = new Map();

        for (const leaf of allLeaves) {
          let anchor = leaf;
          for (let up = 0; up < 5 && parentOf(anchor); up += 1) {
            anchor = parentOf(anchor);
          }
          const bucket = buckets.get(anchor) || [];
          bucket.push(leaf);
          buckets.set(anchor, bucket);
        }

        let best = null;
        for (const entry of buckets) {
          if (entry[1].length >= 5 && (!best || entry[1].length > best[1].length)) {
            best = entry;
          }
        }
        if (best) {
          container = best[0];
          containerReason = 'timestamp cluster';
        }
      }

      if (!container) {
        return { cues: [], diagnostics: ['dom-v2:no transcript container found'] };
      }

      const leaves = collectTimestampLeaves(container)
        .filter((leaf) => !isInsidePlayer(leaf));

      if (leaves.length < 2) {
        return {
          cues: [],
          diagnostics: [
            `dom-v2:container=${containerReason}`,
            `dom-v2:leaves=${leaves.length} (too few)`
          ]
        };
      }

      const chains = leaves.map((leaf) => {
        const set = new Set();
        let node = parentOf(leaf);
        while (node) {
          set.add(node);
          if (node === container) break;
          node = parentOf(node);
        }
        return set;
      });

      const cues = [];
      const seen = new Set();

      for (let i = 0; i < leaves.length; i += 1) {
        const leaf = leaves[i];
        const prevChain = i > 0 ? chains[i - 1] : null;
        const nextChain = i < leaves.length - 1 ? chains[i + 1] : null;

        let segmentRoot = null;
        let node = parentOf(leaf);
        while (node && node !== container) {
          if ((prevChain && prevChain.has(node)) || (nextChain && nextChain.has(node))) {
            break;
          }
          segmentRoot = node;
          node = parentOf(node);
        }
        if (!segmentRoot) continue;

        const tsText = (leaf.textContent || '').trim();

        // Exclude the timestamp control itself from the body walk instead of
        // deleting matching substrings from the finished text: climb from the
        // timestamp leaf to the highest ancestor below the segment root whose
        // exclusion still leaves spoken text. Localized duration labels
        // (e.g. "1 分 5 秒") living inside the same control are dropped with
        // it; the spoken body is never edited.
        let excluded = leaf;
        let candidate = parentOf(leaf);
        while (candidate && candidate !== segmentRoot) {
          const remainder = cleanText(collectTextWithout(segmentRoot, candidate));
          if (!remainder || TS_RE.test(remainder)) break;
          excluded = candidate;
          candidate = parentOf(candidate);
        }

        const body = cleanText(collectTextWithout(segmentRoot, excluded));

        if (!body || TS_RE.test(body)) continue;

        const startMs = parseTimestamp(tsText);
        const key = `${startMs} ${body}`;
        if (seen.has(key)) continue;
        seen.add(key);

        cues.push({ startMs, durationMs: 0, text: preserveOriginalText ? collectTextWithout(segmentRoot, excluded) : body });
      }

      return {
        cues,
        diagnostics: [
          `dom-v2:container=${containerReason}`,
          `dom-v2:leaves=${leaves.length}`
        ]
      };
    }
  });

  return results?.[0]?.result || { cues: [], diagnostics: [] };
}

/**
 * Seek the current YouTube video.
 *
 * @param {number} tabId
 * @param {number} startMs
 * @returns {Promise<void>}
 */
export async function seekVideo(tabId, startMs) {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [startMs / 1000],
    func: (seconds) => {
      const player = document.getElementById('movie_player');

      if (typeof player?.seekTo === 'function') {
        player.seekTo(seconds, true);
        player.playVideo?.();
        return true;
      }

      const video = document.querySelector('video');
      if (video) {
        video.currentTime = seconds;
        video.play().catch(() => {});
        return true;
      }

      return false;
    }
  });
}
