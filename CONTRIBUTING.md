# Contributing

Thanks for your interest in improving CC Sidecar.

## Principles

- Keep the extension small and easy to audit.
- Prefer browser-native APIs and zero dependencies.
- Request only permissions required for the extension's single purpose.
- Do not add analytics, advertising, tracking, or external transcript processing by default.
- Preserve transcript wording. Formatting features may normalize whitespace, but should not silently rewrite spoken content.

## Development

There is no build step.

1. Clone or download the repository.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select the repository folder.
5. Test changes on captioned YouTube videos.

Before submitting a change, check JavaScript syntax and verify the main flows:

- open Side Panel from the extension action
- load a caption track
- full-text copy
- readable paragraph copy
- timestamped copy
- Markdown copy/export
- TXT/MD download
- timestamp seek

Please keep pull requests focused and explain any new permission request clearly.

Run `node --test tests/*.test.mjs` and, with Chrome installed, `node tests/run-browser-diagnostics.mjs`. Keep observed signed URLs out of logs, storage and exports. Contributions for this fork target `naruo4/cc-sidecar`.
