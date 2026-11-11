import { buildObservedCaptionSelector } from './observed-captions.js';

export async function fetchObservedPlayerCaption(input) {
  const selector = buildObservedCaptionSelector(input);
  if (!selector) return { ok: false, errorCode: 'observed-caption-track-unverifiable' };
  try {
    if (!chrome.runtime?.sendMessage) return { ok: false, errorCode: 'caption-observer-unavailable' };
    return await chrome.runtime.sendMessage({ type: 'fetch-observed-caption', tabId: input.tabId, selector })
      || { ok: false, errorCode: 'caption-observer-unavailable' };
  } catch { return { ok: false, errorCode: 'caption-observer-unavailable' }; }
}

// Mark every Sidecar page fetch so diagnostics/alternate requests cannot be
// misidentified as the player's own traffic. No signed URL is sent in messages.
export async function withCaptionProbe(tabId, action) {
  if (!chrome.runtime?.sendMessage) return action(); // isolated test fixtures
  const result = await chrome.runtime.sendMessage({ type: 'caption-probe-start', tabId });
  if (!result?.token) throw new Error('caption-probe-unavailable');
  try { return await action(); }
  finally {
    try { await chrome.runtime.sendMessage({ type: 'caption-probe-end', tabId, token: result.token }); }
    catch { /* Memory-only probe tokens also expire without timers. */ }
  }
}
