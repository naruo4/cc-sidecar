# CC Sidecar 0.5.0 verification checklist

## Automated checks

- Run `node --test tests/*.test.mjs`.
- Run `node tests/run-browser-diagnostics.mjs` with Chrome installed.
- Check modified JavaScript syntax and `git diff --check`.
- Verify LICENSE is unchanged from the upstream baseline.
- Verify the runtime name/publisher/icon and README/PRIVACY/manifest agree.
- Verify no real diagnostic exports, signed URLs, credentials, local machine paths or ZIPs are included.

## Manual live checks

- Reload extension and YouTube tab after accepting the webRequest permission.
- Enable captions; select the matching track in Sidecar and press Get captions.
- Verify public and accessible members-only videos, including transcript endings.
- Verify unavailable/expired observation fallback, track/language switch, SPA navigation and tab closure.
- Verify copy/TXT/Markdown, seek, JP/EN and comparison TXT/JSON exports.

## Distribution

Keep GPL-3.0-only, upstream authorship/history and NOTICE.md intact. The fork
publisher is naruo4. Pushes target naruo4/cc-sidecar only. A GitHub update does
not submit a Chrome Web Store item, publish a release or open an upstream PR.
