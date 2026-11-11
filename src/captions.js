import { fetchObservedPlayerCaption } from './caption-observer-client.js';
import { parseJson3CaptionBody, parseCaptionBody } from './caption-parsers.js';
import { normalizeCueList, removeRepeatedTranscriptBlock } from './text.js';
import {
  fetchAlternatePlayerCaptionFromPage,
  fetchSilentTranscriptPanelFromPage,
  fetchCaptionBodyFromPage
} from './youtube.js';
import { getCaptionTrackIdentity, parseTranscriptPanelResponse } from './silent-transcript.js';

/**
 * Normal acquisition: observed player URL, alternate-player JSON3, get_panel.
 * All other routes/formats remain independently available in diagnostics.
 */
export async function loadCaptionTrack({ tabId, track, availableTracks, expectedVideoIdentity }) {
  const diagnostics = [];
  const expectedTrackIdentity = getCaptionTrackIdentity(track);
  let cues = [];
  let method = '';

  const observed = await fetchObservedPlayerCaption({ tabId, track, availableTracks, expectedVideoIdentity });
  cues = observed.ok ? parseCaptionBody(observed.body || '') : [];
  diagnostics.push(`player-webrequest-timedtext:HTTP ${observed.status || 0} ${new TextEncoder().encode(observed.body || '').length}B ${cues.length} cues`);
  if (observed.errorCode) diagnostics.push(`player-webrequest-timedtext:${observed.errorCode}`);
  if (observed.errorCode === 'video-context-changed') return { cues: [], diagnostics, method: 'none' };
  if (cues.length) return { cues: removeRepeatedTranscriptBlock(normalizeCueList(cues)), diagnostics, method: 'player-webrequest-timedtext' };

  try {
    const alternateResult = await fetchAlternatePlayerCaptionFromPage(
      tabId, track, availableTracks, expectedVideoIdentity
    );
    diagnostics.push(
      `alternate-player:ANDROID HTTP ${alternateResult.status} `
      + `${alternateResult.bodyBytes || 0}B ${alternateResult.trackCount || 0} tracks`
    );
    if (alternateResult.errorCode) diagnostics.push(`alternate-player:error-code ${alternateResult.errorCode}`);
    if (alternateResult.error) diagnostics.push(`alternate-player:error ${alternateResult.error}`);
    if (alternateResult.errorCode === 'video-context-changed') {
      return { cues: [], diagnostics, method: 'none' };
    }

    if (alternateResult.ok && alternateResult.baseUrl) {
      const result = await fetchCaptionBodyFromPage(tabId, alternateResult.baseUrl, 'json3');
      cues = result.ok ? parseJson3CaptionBody(result.body || '') : [];
      diagnostics.push(
        `alternate-player:json3 HTTP ${result.status} ${(result.body || '').length}B ${cues.length} cues`
      );
      if (cues.length) method = 'alternate-player-timed-text';
    }
  } catch {
    // A page injection/network exception must still allow the second route.
    // Browser error strings may contain signed URLs; do not copy them here.
    diagnostics.push('alternate-player:request-failed');
  }

  if (!cues.length) {
    try {
      const result = await fetchSilentTranscriptPanelFromPage(
        tabId, track, availableTracks, expectedVideoIdentity
      );
      cues = result.ok ? parseTranscriptPanelResponse({
        body: result.body || '', expectedTrackIdentity,
        responseTrackIdentity: result.trackIdentity || ''
      }) : [];
      diagnostics.push(
        `silent-panel:${result.commandType || 'metadata-unavailable'} `
        + `HTTP ${result.status} ${(result.body || '').length}B ${cues.length} cues`
      );
      if (result.error) diagnostics.push(`silent-panel:error ${result.error}`);
      if (result.unsafeSelection) diagnostics.push('track-selection:fail-closed');
      if (cues.length) method = 'silent-panel-data';
    } catch {
      diagnostics.push('silent-panel:request-failed');
    }
  }

  return { cues: removeRepeatedTranscriptBlock(normalizeCueList(cues)),
    diagnostics, method: method || 'none' };
}
