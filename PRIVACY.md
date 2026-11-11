# Privacy Policy — CC Sidecar

Updated: 2026-11-11 · Maintainer: [naruo4](https://github.com/naruo4) · Version: 0.5.0

CC Sidecar is an independent fork of Transcript Sidecar by Tokumaru Labs. This policy describes this fork. It has no analytics, advertising, tracking, developer-operated transcript server or automatic external AI upload.

## Data processed locally

The extension reads the current supported YouTube video's identity, title, URL, available caption-track metadata and caption text to display, format, copy and export captions or seek playback. Opening or refreshing the Side Panel can initiate acquisition. The **Get captions** button retries acquisition for the selected track.

The background observer passively receives top-frame YouTube timedtext request URLs even when the Side Panel is closed. It does not request cookie access or collect authentication headers, request headers or response bodies from webRequest. URLs may contain signed/authentication parameters and are treated as secrets.

## Temporary URL retention

Observed caption URLs are held only in background-worker RAM and extension-private isolated-world RAM of the corresponding tab. They are never written to chrome.storage, localStorage, sessionStorage, IndexedDB, CacheStorage, DOM attributes, files or logs. Signed URLs are not included in comparison TXT/JSON files, sent to another tab, or returned to the panel; the panel receives caption text and sanitized result codes.

At most 12 track entries are retained per tab, valid until the earlier of the URL's `expire` value or one hour after observation. Expired entries are removed when accessed. Video navigation, reload, pagehide and tab closure discard corresponding memory; failed HTTP/empty replays invalidate the URL. Worker restart can read a still-valid entry from that same tab's private RAM without persistence or a keepalive. Browser shutdown destroys this in-memory state.

The observer does not poll, block or rewrite fetch/XHR. Sidecar's own page caption requests are excluded from observation while they run, so alternate/diagnostic requests do not replace the player's observed URL.

## Communication with YouTube

Observed URLs are replayed unchanged in the logged-in YouTube page with `credentials: "include"`, `cache: "no-store"` and a timeout. The browser handles the existing page credentials; CC Sidecar does not extract or store cookies or authentication tokens separately. Video and unique selected-track checks run before and after replay. Unavailable observations fall back to alternate-player JSON3 and then get_panel.

This applies to public videos and members-only videos the current account can already access. It does not grant viewing rights. The extension communicates only with YouTube resources on its declared hosts, not with naruo4, Tokumaru Labs, analytics, advertising, external LLMs or transcript providers. YouTube is governed by its own terms and privacy policies.

## Stored preferences and user exports

Only the JP/EN interface preference is persistently stored, in extension-origin localStorage under the legacy `transcriptSidecar.uiLanguage` key. It contains no browsing history, video IDs, caption URLs, credentials or transcript text.

Clipboard, TXT, Markdown and comparison JSON outputs are created only at the user's request. They can contain video titles/IDs, selected language and caption text, including private captions. They remain under the user's control. No automatic LLM upload is performed. Users choose whether to share these files for analysis.

Comparison files contain caption-only projections, timings, source methods, byte counts, coverage limitations and sanitized failure codes. Request context, cookies, signed URLs, API keys, visitor data and arbitrary browser error messages are excluded. URL/credential-like text inside captions is redacted in comparison outputs. Ordinary transcript copy/export preserves transcript content as selected by the user.

## Permissions

- `scripting`: read video/track context, fetch captions in the page, maintain extension-private tab RAM, and seek playback.
- `sidePanel`: display the transcript interface.
- `webRequest`: observe YouTube timedtext request URLs without blocking or reading headers/body.
- Hosts: `https://www.youtube.com/*`, `https://youtube.com/*`, `https://m.youtube.com/*`. No `<all_urls>`, cookies, debugger, storage or tabs permission is requested.

No remote runtime code is loaded. There is no developer backend, sale of user data, viewing profile or unrelated use of YouTube data. See [the source](https://github.com/naruo4/cc-sidecar) and [NOTICE.md](NOTICE.md) for implementation and upstream attribution.
