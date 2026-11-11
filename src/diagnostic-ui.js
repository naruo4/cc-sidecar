import { runCaptionDiagnostics } from './caption-diagnostics.js';
import { readVideoMetadata } from './youtube.js';
import { getCaptionTrackIdentity } from './silent-transcript.js';
import { downloadTextFile, safeFilename } from './files.js';
import { buildDiagnosticExportFiles } from './diagnostic-exports.js';

export function initializeCaptionDiagnosticUi(getSelection) {
  const button = document.getElementById('runCaptionDiagnostics');
  const status = document.getElementById('captionDiagnosticStatus');
  const output = document.getElementById('captionDiagnosticResults');
  const saveJson = document.getElementById('saveCaptionDiagnosticJson');
  const saveTxt = document.getElementById('saveCaptionDiagnosticTxt');
  let report = null;
  saveJson.addEventListener('click', () => {
    if (report) {
      const file = buildDiagnosticExportFiles(report).json;
      downloadTextFile(file.filename, file.content);
    }
  });
  saveTxt.addEventListener('click', () => {
    if (report) {
      const file = buildDiagnosticExportFiles(report).txt;
      downloadTextFile(file.filename, file.content);
    }
  });
  button.addEventListener('click', async () => {
    button.disabled = true;
    saveJson.disabled = true;
    saveTxt.disabled = true;
    report = null;
    output.replaceChildren();
    status.textContent = '診断中… 各形式・各経路を独立して確認します。';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('no-tab');
      const metadata = await readVideoMetadata(tab.id);
      if (!metadata?.isYouTubeVideo || !metadata.videoIdentity) throw new Error('no-video');
      const selection = getSelection();
      const track = metadata.videoIdentity === selection.videoIdentity
        ? metadata.tracks.find(t => getCaptionTrackIdentity(t) === selection.trackIdentity) || metadata.tracks[0]
        : metadata.tracks[0];
      const videoId = safeFilename(metadata.videoIdentity);
      report = await runCaptionDiagnostics({ tabId: tab.id, track,
        availableTracks: metadata.tracks, expectedVideoIdentity: metadata.videoIdentity,
        videoTitle: metadata.title || '', extensionVersion: chrome.runtime?.getManifest?.().version || '' }, route => {
        const row = document.createElement('div');
        row.className = 'caption-diagnostic-row';
        const summary = document.createElement('p');
        summary.textContent = `${route.method} | HTTP ${route.httpStatus ?? '—'} | ${route.responseBytes ?? '—'} bytes | ${route.segmentCount}件${route.reason ? ` | ${route.reason}` : ''}`;
        row.appendChild(summary);
        output.appendChild(row);
        status.textContent = `診断中… ${output.childElementCount}経路完了（動画 ${videoId}）`;
      });
      saveJson.disabled = false;
      saveTxt.disabled = false;
      status.textContent = `診断完了：${report.routes.length}経路（動画 ${videoId}）。比較TXTと詳細JSONを1つずつ保存してください。複数動画のファイルをまとめてLLMに渡せます。`;
    } catch {
      status.textContent = '診断を開始・完了できませんでした。YouTube動画を開き、拡張機能を読み込み直してください。';
    } finally { button.disabled = false; }
  });
}
