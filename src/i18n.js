/**
 * UI language handling for CC Sidecar.
 *
 * Scope: this module translates only the fixed wording the extension itself
 * renders. Video titles, video URLs, caption text, and YouTube-supplied caption
 * track labels are never translated or rewritten.
 *
 * The selection is stored in localStorage on the extension origin, so no
 * additional Chrome permission is required.
 */

const STORAGE_KEY = 'transcriptSidecar.uiLanguage';
const SUPPORTED_LANGUAGES = ['ja', 'en'];
const FALLBACK_LANGUAGE = 'en';

const MESSAGES = {
  ja: {
    'header.refresh': '読み込み直す',
    'header.languageGroup': '表示言語',
    'header.switchToJa': '日本語に切り替え',
    'header.switchToEn': '英語に切り替え',
    'header.jaSelected': '日本語を選択中',
    'header.enSelected': '英語を選択中',

    'app.tagline': 'YouTube字幕を、すぐコピー。',

    'status.idle': 'YouTube動画を開いて、拡張機能アイコンを押してください。',
    'status.loadingVideo': 'YouTube動画と字幕情報を読み込んでいます…',
    'status.loadingTrack': '「{label}」の字幕を読み込んでいます…',
    'status.loaded': '字幕を読み込みました：{count} セグメント',

    'diagnostics.summary': '診断情報',
    'diagnostics.copy': '診断情報をコピー',

    'field.captions': '字幕',

    'button.loadCaptions': '字幕を取得',
    'button.copyPlain': '全文をコピー',
    'button.copyReadable': '読みやすくコピー',
    'button.copyReadableHint': '内容は変えず、段落だけ整えます',
    'button.copyTimestamp': '時刻付きコピー',
    'button.copyMarkdown': 'Markdownコピー',
    'button.saveTxt': 'TXT保存',
    'button.saveMd': 'MD保存',

    'transcript.heading': 'Transcript',
    'transcript.segments': '{count}件',
    'transcript.seekTitle': 'この位置から再生',

    'footer.headline': 'アカウント不要。トラッキングなし。外部字幕サーバーなし。',
    'footer.note': '字幕データは、この拡張機能から第三者サーバーへ送信しません。',
    'footer.publisher': 'naruo4によるオープンソースツール。',
    'footer.upstream': '原作：Transcript Sidecar（Tokumaru Labs）',

    'toast.copiedPlain': '全文をコピーしました',
    'toast.copiedReadable': '読みやすい段落でコピーしました',
    'toast.copiedTimestamp': 'タイムスタンプ付きでコピーしました',
    'toast.copiedMarkdown': 'Markdownをコピーしました',
    'toast.savedTxt': 'TXTを保存しました',
    'toast.savedMd': 'Markdownを保存しました',
    'toast.copiedDiagnostics': '診断情報をコピーしました',
    'toast.seekFailed': '動画位置を変更できませんでした',

    'error.noTab': '現在のタブを取得できませんでした。',
    'error.noMetadata': '動画情報を取得できませんでした。ページを再読み込みして、もう一度試してください。',
    'error.notYouTube': 'YouTubeの動画ページを開いてから、拡張機能アイコンを押してください。',
    'error.noTracks': 'この動画には取得できる字幕が見つかりませんでした。現在は字幕付き動画に対応しています。',
    'error.trackLoadFailed': '字幕トラックを読み込めませんでした。',
    'error.bodyFetchFailed': '字幕トラックは見つかりましたが本文を取得できませんでした。右上の↻を一度押して再試行してください。',
    'error.noHostPermission': 'YouTubeページへのアクセス権がありません。拡張機能を再読み込みして、YouTubeページを更新してください。',
    'error.nothingToCopy': 'コピーする字幕がありません',
    'error.nothingToSave': '保存する字幕がありません',
    'error.unknown': '不明なエラーが発生しました。'
  },

  en: {
    'header.refresh': 'Reload',
    'header.languageGroup': 'Display language',
    'header.switchToJa': 'Switch to Japanese',
    'header.switchToEn': 'Switch to English',
    'header.jaSelected': 'Japanese selected',
    'header.enSelected': 'English selected',

    'app.tagline': 'Copy YouTube transcripts instantly.',

    'status.idle': 'Open a YouTube video, then click the extension icon.',
    'status.loadingVideo': 'Loading video and caption details…',
    'status.loadingTrack': 'Loading captions for “{label}”…',
    'status.loaded': 'Transcript loaded: {count} segments',

    'diagnostics.summary': 'Diagnostics',
    'diagnostics.copy': 'Copy diagnostics',

    'field.captions': 'Captions',

    'button.loadCaptions': 'Get captions',
    'button.copyPlain': 'Copy full transcript',
    'button.copyReadable': 'Copy readable',
    'button.copyReadableHint': 'Keeps the wording and adds paragraph breaks',
    'button.copyTimestamp': 'Copy with timestamps',
    'button.copyMarkdown': 'Copy as Markdown',
    'button.saveTxt': 'Save TXT',
    'button.saveMd': 'Save MD',

    'transcript.heading': 'Transcript',
    'transcript.segments': '{count} segments',
    'transcript.seekTitle': 'Play from here',

    'footer.headline': 'No account. No tracking. No external server.',
    'footer.note': 'This extension never sends transcript data to a third-party server.',
    'footer.publisher': 'An open-source tool maintained by naruo4.',
    'footer.upstream': 'Based on Transcript Sidecar by Tokumaru Labs',

    'toast.copiedPlain': 'Full transcript copied',
    'toast.copiedReadable': 'Copied as readable paragraphs',
    'toast.copiedTimestamp': 'Copied with timestamps',
    'toast.copiedMarkdown': 'Markdown copied',
    'toast.savedTxt': 'TXT saved',
    'toast.savedMd': 'Markdown saved',
    'toast.copiedDiagnostics': 'Diagnostics copied',
    'toast.seekFailed': 'Could not change the playback position',

    'error.noTab': 'Could not read the current tab.',
    'error.noMetadata': 'Could not read video details. Reload the page and try again.',
    'error.notYouTube': 'Open a YouTube video page, then click the extension icon.',
    'error.noTracks': 'No captions were found for this video. Videos with captions are supported.',
    'error.trackLoadFailed': 'Could not load the caption track.',
    'error.bodyFetchFailed': 'The caption track was found, but its text could not be loaded. Press ↻ at the top right to retry.',
    'error.noHostPermission': 'No access to the YouTube page. Reload the extension, then refresh the YouTube page.',
    'error.nothingToCopy': 'There is no transcript to copy',
    'error.nothingToSave': 'There is no transcript to save',
    'error.unknown': 'An unknown error occurred.'
  }
};

let currentLanguage = resolveInitialLanguage();

/**
 * @returns {'ja'|'en'}
 */
export function getLanguage() {
  return currentLanguage;
}

/**
 * @returns {string[]}
 */
export function getSupportedLanguages() {
  return [...SUPPORTED_LANGUAGES];
}

/**
 * Change the active UI language and persist the choice.
 *
 * @param {string} language
 * @returns {'ja'|'en'} the language actually in effect
 */
export function setLanguage(language) {
  if (!SUPPORTED_LANGUAGES.includes(language)) return currentLanguage;

  currentLanguage = language;
  syncDocumentLanguage();

  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Storage can be unavailable (e.g. blocked site data). The selection still
    // applies for this session.
  }

  return currentLanguage;
}

/**
 * Look up a UI string, substituting {placeholder} tokens.
 *
 * Falls back to English, then to the key itself, so a missing entry can never
 * blank out the interface.
 *
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function translate(key, params) {
  const template = MESSAGES[currentLanguage]?.[key]
    ?? MESSAGES[FALLBACK_LANGUAGE]?.[key]
    ?? key;

  return applyParams(template, params);
}

/**
 * Keep <html lang> aligned with the active UI language.
 */
export function syncDocumentLanguage() {
  document.documentElement.lang = currentLanguage;
}

function applyParams(template, params) {
  if (!params) return template;

  return String(template).replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : match
  ));
}

function resolveInitialLanguage() {
  return readStoredLanguage() || detectPreferredLanguage();
}

function readStoredLanguage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return SUPPORTED_LANGUAGES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Decide the initial language from the browser's single most-preferred locale.
 *
 * Only the top entry is considered: a Japanese tag further down the list means
 * the user merely accepts Japanese, not that they prefer it.
 */
function detectPreferredLanguage() {
  const preferredLanguage = navigator.languages?.[0]
    || navigator.language
    || FALLBACK_LANGUAGE;

  return String(preferredLanguage).toLowerCase().startsWith('ja')
    ? 'ja'
    : FALLBACK_LANGUAGE;
}
