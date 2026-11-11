# CC Sidecar 0.5.0 — listing draft

Maintainer/publisher: naruo4. Independent fork of Transcript Sidecar by Tokumaru Labs.
This document describes the fork; it is not a Chrome Web Store submission.

- Name: CC Sidecar
- Summary (EN/JA): use `_locales/en/messages.json` / `_locales/ja/messages.json`.
- Privacy URL: https://github.com/naruo4/cc-sidecar/blob/main/PRIVACY.md
- Source: https://github.com/naruo4/cc-sidecar
- License: GPL-3.0-only; original attribution retained in NOTICE.md and README.

Purpose: display, copy and export captions from the current YouTube video,
including accessible members-only videos. Passively observe player caption
URLs, replay them in the current page, and fall back to alternate JSON3/get_panel.
Compare routes via local TXT/JSON exports. No audio transcription or access grants.

Permissions: scripting, sidePanel, webRequest; the same three YouTube-only host
patterns as manifest.json. No request blocking, cookie/header capture, polling,
fetch/XHR replacement, analytics, ads, third-party transcript server or remote code.
Signed URLs remain only in worker/tab RAM and never enter logs or exported files.
Stored data is limited to the JP/EN interface preference. See PRIVACY.md for details.

Before any future store submission, validate live public/members-only flows,
review screenshots and listing fields, and confirm privacy disclosures match the
exact version being uploaded. This repository update does not publish to the store.
