# CC Sidecar

[English](README.md) | [日本語](README_JA.md)

<img src="icons/icon128.png" width="96" height="96" alt="CC Sidecar icon">

A Manifest V3 Chrome extension for reading, copying, formatting and exporting YouTube captions in the Side Panel.

**Version: 0.5.0 · Maintainer: [naruo4](https://github.com/naruo4)**

An independent fork of **[Transcript Sidecar](https://github.com/tokumaru-labs/transcript-sidecar) 0.4.2 by Tokumaru Labs**, licensed under **GPL-3.0-only**. Original authorship and upstream Git history are preserved. See [NOTICE.md](NOTICE.md) and [LICENSE](LICENSE).

## Features

- Japanese / English panel interface.
- Public videos and members-only videos that your current YouTube account can already watch.
- Exact observed player caption URL fetched in the logged-in page with `credentials: "include"`.
- Full-text, readable, timestamped and Markdown copy; TXT and Markdown downloads.
- Click a segment timestamp to seek playback.
- Independent acquisition-route diagnostics, with one comparison TXT and one detailed JSON per run for analysis in an LLM of your choice.
- No analytics, ads, developer backend or automatic LLM upload. No build step or runtime packages.

## Install and use

1. Clone this repository or use **Code → Download ZIP** and extract it.
2. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**.
3. Select the repository root containing `manifest.json`.
4. Reload the YouTube video tab, turn on captions and choose the desired language. Wait until player captions appear.
5. Open **CC Sidecar**, choose the matching track and press **Get captions**.
6. Copy or download the result. To compare routes, run **字幕取得診断**, then save the comparison TXT and detailed JSON.

After updating local files, reload the extension and the YouTube tab, then reopen the panel. Upgrading from the original project requires the added `webRequest` permission. No Chrome Web Store publication is implied by this repository update.

## Acquisition order

1. **player-webrequest-timedtext**: passively observe top-frame YouTube `/api/timedtext` requests with `chrome.webRequest`, then fetch the exact URL in the current logged-in page.
2. **alternate-player-timedtext (JSON3)**: obtain an exact matching track from the ANDROID compatibility player.
3. **get_panel**: use the current page's transcript-panel metadata.

Unavailable, expired, empty, invalid or unsuccessful observed resources fall back to the existing routes. Video identity changes stop acquisition. Language, ASR/manual kind, track name, translation and unique track identity are checked; ambiguous tracks are rejected. Other formats and DOM sources remain diagnostic-only. VTT character references are decoded in formatted text; diagnostic original text is preserved.

This uses existing YouTube access, not a way to grant membership or bypass playback restrictions. Caption availability depends on YouTube and the current page session. There is no audio transcription or inferred repair of missing words.

## Permissions and privacy

- `scripting`: read video/track metadata, fetch in the page, hold temporary extension-private tab memory and seek playback.
- `sidePanel`: display the interface.
- `webRequest`: passively observe YouTube timedtext URLs. No blocking or request/response header collection.
- Host access is restricted to `https://www.youtube.com/*`, `https://youtube.com/*`, `https://m.youtube.com/*`.

Signed URLs are held only in worker and extension-private tab RAM, never persistent storage, logs, exports or third-party services. Tab memory supports worker restart without keepalive. Navigation, tab closure, expiration and failed HTTP replay invalidate entries. Entries expire at the earlier of the signed expiry or one hour; at most 12 track entries are retained per tab. No polling or fetch/XHR replacement is used. The only stored preference is the panel language, under the legacy `transcriptSidecar.uiLanguage` key for compatibility.

See [PRIVACY.md](PRIVACY.md) and [the comparison guide](DIAGNOSTICS_JA.md) for output fields, partial-source limits and test procedures.

## Development and validation

```sh
git clone https://github.com/naruo4/cc-sidecar.git
cd cc-sidecar
node --test tests/*.test.mjs
node tests/run-browser-diagnostics.mjs
```

The browser check uses an isolated temporary Chrome profile and fixture captions. Set `CHROME_BIN` if Chrome is not in the default macOS location or available as `chromium` on other platforms. Public/members-only cases, HTTP 200/0B recovery, fallback, video/track isolation, URL cleanup, worker restart, VTT decoding and exports are covered. Fixture results do not guarantee success on every live YouTube video; verify accessible public and members-only videos in your own session.

## License and attribution

The original software is **Transcript Sidecar by Tokumaru Labs**. This fork is maintained by **naruo4**. Source code remains **GPL-3.0-only**; [LICENSE](LICENSE) is unchanged. See [NOTICE.md](NOTICE.md) for modifications and [TRADEMARKS.md](TRADEMARKS.md) for branding notices. YouTube is a third-party service; this project is not endorsed by YouTube or Tokumaru Labs.
