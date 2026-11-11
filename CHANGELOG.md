# CC Sidecar changelog

## 0.5.0 — 2026-11-11

- Fork maintained by naruo4, based on Transcript Sidecar 0.4.2 by Tokumaru Labs.
- Rename the extension, action, panel and exports to CC Sidecar; add a CC icon badge.
- Prefer exact player timedtext URLs observed by chrome.webRequest; replay in the logged-in page.
- Keep signed URLs only in worker/tab RAM, with track/video checks, expiry and navigation cleanup.
- Fall back to alternate-player JSON3, then get_panel; preserve existing copy/TXT/Markdown exports.
- Decode VTT character references while retaining original text in diagnostics.
- Compare all acquisition routes and export one comparison TXT and one detailed JSON per run.
- Add public/members-only, worker restart, privacy, fallback and export regression tests.
- Preserve the upstream GPL-3.0-only LICENSE and original authorship/history.

## Upstream history (preserved)

# Changelog

## 0.4.2 — 2026-08-22

### Fixed

- Restored real-video caption acquisition when YouTube timed-text URLs gated by `exp=xpe` return empty bodies. After the existing silent routes yield no cues, a YouTube-owned same-origin player fallback accepts alternate timed-text only when its `vssId` is a unique exact match for the selected track.
- Added regression coverage for fallback success, compatibility-profile failure, mismatched or duplicate track identity, and SPA stale-result rejection.

### Preserved

- Silent acquisition, fail-closed track selection, no YouTube UI manipulation, YouTube-only host access, existing permissions and privacy boundaries, runtime features, and the dependency-free package remain unchanged.

## 0.4.1 — 2026-08-19

### Added

- Silent transcript-panel data retrieval through YouTube's own same-origin `get_panel` route when both timed-text paths return no cues. The request uses transcript metadata already attached to the current video page and does not execute YouTube page commands.
- Local acquisition-method diagnostics distinguish extension timed-text, page-context timed-text, silent panel data, and read-only already-open DOM fallbacks without logging transcript text.
- English and Japanese manifest metadata under `_locales/` so the Chrome Web Store Developer Dashboard can provide separate localized listing fields. The existing Side Panel JP / EN runtime interface remains unchanged.

### Changed

- Caption fallback order is now: extension timed-text, page-context timed-text, silent transcript-panel data, visible legacy transcript DOM (read-only), then visible modern transcript DOM (read-only).
- Chrome Web Store listing material now contains release-ready English and Japanese summaries and detailed descriptions, plus the manual localization steps for the Developer Dashboard.
- Manifest version is set to `0.4.1` for the approved release package.

### Fixed

- Transcript Sidecar no longer expands the YouTube description or clicks YouTube's transcript controls when caption requests return no data. If every silent path fails, it reports local diagnostics and leaves the page state untouched.

### Preserved

- Permissions and YouTube-only host access are unchanged.
- No account, analytics, ads, tracking, remote runtime code, runtime dependencies, paid API, third-party transcript service, or developer-operated transcript server.

## 0.4.0 — 2026-07-22

### Added

- Japanese / English UI language toggle (**JP** / **EN**) in the Side Panel header, next to the reload button.
- `src/i18n.js`: a dependency-free translation layer holding the `ja` and `en` dictionaries, with `{placeholder}` substitution and a safe fallback chain (active language → English → key name).

### Changed

- Interface wording that the extension owns — tagline, caption label, buttons, transcript heading, status messages, toasts, error messages, diagnostics panel, footer, and `title` / `aria-label` attributes — now follows the selected language.
- Switching language re-renders immediately, without reloading the Side Panel or refetching the transcript. The current status message, segment count, caption-track marker, and cue tooltips all update in place.
- The language choice is stored in `localStorage` under `transcriptSidecar.uiLanguage` and restored the next time the Side Panel opens. With no stored choice, the initial language is taken from `navigator.languages` / `navigator.language`: `ja` for Japanese, English otherwise.

### Fixed

- The caption-track dropdown no longer appends its own "auto-generated" marker on top of the one YouTube already includes in the track label (for example `English (auto-generated) (auto-generated) · en`). Tracks are now shown as `label · languageCode`, using YouTube's text verbatim.
- The segment count beside the **Transcript** heading no longer risks being clipped in a narrow Side Panel: the Japanese form is now `{count}件`, and the count is pinned to the heading's line.

### Preserved

- All four caption-retrieval paths are unchanged, as are transcript parsing, formatting, copying, saving, and click-to-seek.
- Caption track labels supplied by YouTube, along with their `languageCode` and `kind`, are displayed as received and are never translated.
- Video titles, video URLs, and transcript text are never translated or rewritten. Mixed-language output remains possible by design when the interface language differs from the caption language.
- No change to `permissions` or `host_permissions`, and no new Chrome permission: `localStorage` on the extension origin requires none.
- No external libraries, npm dependencies, or build step.
- No account, analytics, ads, tracking, remote runtime code, or developer-operated transcript server.

## 0.3.3 — 2026-07-19

### Changed

- Shortened the manifest description to meet Chrome Web Store length requirements.
- No functional changes.

## 0.3.2 — 2026-07-19

### Added

- Fourth caption-recovery fallback that supports YouTube's newer transcript-panel DOM: a read-only scan of the visible transcript panel that does not rely on legacy `ytd-transcript-*` markup (no clicks, no network requests of its own).
- Collapsible capture-diagnostics panel in the Side Panel with a one-tap copy button, shown only when transcript loading fails.

### Changed

- The fourth fallback runs only when the existing three caption-retrieval paths return nothing.

### Fixed

- Localized accessibility time labels (e.g. "1 分 5 秒") are no longer mixed into transcript text captured by the fourth fallback: timestamp-UI DOM nodes — the visible clock and its screen-reader label — are excluded structurally from body collection instead of being deleted from the finished text.

### Preserved

- The first-through-third caption-retrieval paths are unchanged.
- No account, analytics, ads, tracking, remote runtime code, or developer-operated transcript server.

## 0.3.1 — 2026-07-19

### Changed

- Renamed the extension from **TokuTube Transcript** to **Transcript Sidecar**.
- Updated the Chrome action title, Side Panel branding, documentation, privacy policy, and store-listing copy.
- Bumped the manifest version so the renamed package can replace the previously uploaded 0.3.0 draft.
- License finalized as GPL-3.0-only before the initial public release.
- Added `TRADEMARKS.md`: the Transcript Sidecar and Tokumaru Labs names and logos are not covered by the GPL.

### Preserved

- Full transcript copy.
- Readable paragraph copy using local heuristics only.
- Timestamped copy.
- Markdown copy/export and TXT export.
- YouTube-only host permissions.
- No account, analytics, ads, tracking, remote runtime code, or developer-operated transcript server.

All notable changes to Transcript Sidecar are documented here.

## 0.3.0 — 2026-07-19

### Added

- **Readable copy** action with local, heuristic paragraph formatting.
- Separate full-text and readable-text export modes.
- Project license (now GPL-3.0-only).
- `CONTRIBUTING.md` and `SECURITY.md`.
- Chrome Web Store submission notes and public-release checklist.
- Tokumaru Labs publisher attribution in the Side Panel.

### Changed

- Markdown exports now use paragraph-formatted transcript text.
- TXT exports now use paragraph-formatted transcript text.
- Plain full-text copy remains a continuous transcript with artificial caption line breaks removed.
- Documentation updated for the first public release workflow.

### Privacy

- No new permissions.
- No analytics, advertising, tracking, remote runtime code, external transcript-processing service, or third-party runtime JavaScript dependencies added.

## 0.2.0 — 2026-07-19

### Added

- Readable transcript formatting for plain-text, TXT, and Markdown exports.
- Language-aware spacing when merging caption segments.
- Modular source layout under `src/`.
- `.editorconfig` for consistent formatting.

### Changed

- Refactored caption loading, parsing, YouTube page interaction, UI, and export logic into separate modules.
- Reused one caption-parser implementation for both extension-context and page-context fetches.
- Corrected permission documentation to match the YouTube-only host permissions actually used by the extension.
- Updated project documentation for public code review.

### Preserved

- Timestamped copy output keeps one cue per line.
- Duplicate cue and repeated-full-transcript safeguards remain enabled.
- No account, analytics, ads, external application server, npm dependencies, or build step.
