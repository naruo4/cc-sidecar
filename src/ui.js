import { getLanguage, setLanguage, syncDocumentLanguage, translate } from './i18n.js';
import { formatTimestamp } from './text.js';

const elements = {};
let toastTimer = null;

/**
 * Live UI state that has to survive a language switch.
 *
 * Status messages and caption tracks are kept as descriptors (translation key
 * plus params) rather than finished strings, so switching language re-renders
 * them without reloading the page or refetching the transcript.
 */
let currentStatus = null;
let currentCueCount = null;

/**
 * Resolve and cache all required DOM elements once.
 *
 * @returns {typeof elements}
 */
export function initializeUi() {
  const ids = [
    'statusCard',
    'statusSpinner',
    'statusText',
    'content',
    'videoTitle',
    'videoUrl',
    'trackSelect',
    'loadCaptionsButton',
    'copyPlainButton',
    'copyReadableButton',
    'copyTimestampButton',
    'copyMarkdownButton',
    'downloadTxtButton',
    'downloadMarkdownButton',
    'refreshButton',
    'transcript',
    'cueCount',
    'toast',
    'diagnostics',
    'diagnosticsList',
    'copyDiagnosticsButton'
  ];

  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing required UI element: #${id}`);
    elements[id] = element;
  }

  return elements;
}

export function getUiElements() {
  return elements;
}

/**
 * Resolve a message that may be a plain string or a {key, params} descriptor.
 *
 * Raw strings are passed through untouched so browser-supplied error text is
 * never mangled by the translation layer.
 *
 * @param {string|{key: string, params?: Record<string, unknown>}} message
 * @returns {string}
 */
function resolveMessage(message) {
  if (message && typeof message === 'object' && typeof message.key === 'string') {
    return translate(message.key, message.params);
  }

  return String(message ?? '');
}

/**
 * Wire the JP / EN toggle and paint the interface in the active language.
 */
export function setupLanguageToggle() {
  const buttons = document.querySelectorAll('[data-lang]');

  for (const button of buttons) {
    button.addEventListener('click', () => {
      if (button.dataset.lang === getLanguage()) return;
      setLanguage(button.dataset.lang);
      applyTranslations();
    });
  }

  applyTranslations();
}

/**
 * Re-render every string the extension owns in the active language.
 *
 * Video title, video URL, caption text, and YouTube-supplied track labels are
 * deliberately left untouched.
 */
export function applyTranslations() {
  syncDocumentLanguage();

  for (const node of document.querySelectorAll('[data-i18n]')) {
    node.textContent = translate(node.dataset.i18n);
  }

  for (const node of document.querySelectorAll('[data-i18n-title]')) {
    node.title = translate(node.dataset.i18nTitle);
  }

  for (const node of document.querySelectorAll('[data-i18n-aria-label]')) {
    node.setAttribute('aria-label', translate(node.dataset.i18nAriaLabel));
  }

  // The language buttons describe their own state: the active one reports that
  // it is already selected, the other offers to switch.
  for (const button of document.querySelectorAll('[data-lang]')) {
    const isSelected = button.dataset.lang === getLanguage();
    const description = translate(
      isSelected ? button.dataset.i18nSelected : button.dataset.i18nUnselected
    );

    button.setAttribute('aria-pressed', String(isSelected));
    button.title = description;
    button.setAttribute('aria-label', description);
  }

  // Restore live state that the static pass above may have overwritten.
  // The track dropdown is deliberately left alone: it holds only YouTube text.
  renderStatus();
  renderCueCount();
  refreshSeekTitles();
}

function renderStatus() {
  if (!currentStatus) return;
  elements.statusText.textContent = resolveMessage(currentStatus.message);
}

function renderCueCount() {
  if (currentCueCount === null) return;
  elements.cueCount.textContent = translate('transcript.segments', {
    count: currentCueCount
  });
}

function refreshSeekTitles() {
  const title = translate('transcript.seekTitle');

  for (const button of elements.transcript.querySelectorAll('.cue-time')) {
    button.title = title;
  }
}

/**
 * Show the capture diagnostics block below the status card.
 * Only called when transcript loading has failed.
 *
 * @param {string[]} lines
 */
export function renderDiagnostics(lines) {
  const list = (Array.isArray(lines) ? lines : []).filter(Boolean);

  if (!list.length) {
    clearDiagnostics();
    return;
  }

  elements.diagnosticsList.textContent = list.join('\n');
  elements.diagnostics.hidden = false;
}

/**
 * Hide and empty the diagnostics block (e.g. before loading a new video).
 */
export function clearDiagnostics() {
  elements.diagnostics.hidden = true;
  elements.diagnostics.open = false;
  elements.diagnosticsList.textContent = '';
}

/**
 * @param {string|{key: string, params?: Record<string, unknown>}} message
 * @param {'normal'|'error'|'success'} [type]
 * @param {boolean} [loading]
 */
export function setStatus(message, type = 'normal', loading = false) {
  currentStatus = { message, type, loading };
  elements.statusText.textContent = resolveMessage(message);
  elements.statusSpinner.hidden = !loading;
  elements.statusCard.classList.remove('error', 'success');

  if (type === 'error') elements.statusCard.classList.add('error');
  if (type === 'success') elements.statusCard.classList.add('success');
}

export function setContentVisible(visible) {
  elements.content.hidden = !visible;
}

export function setActionButtonsDisabled(disabled) {
  elements.copyPlainButton.disabled = disabled;
  elements.copyReadableButton.disabled = disabled;
  elements.copyTimestampButton.disabled = disabled;
  elements.copyMarkdownButton.disabled = disabled;
  elements.downloadTxtButton.disabled = disabled;
  elements.downloadMarkdownButton.disabled = disabled;
}

export function renderVideoMetadata(title, url) {
  elements.videoTitle.textContent = title;
  elements.videoUrl.textContent = url;
  elements.videoUrl.href = url;
}

/**
 * Render the caption-track dropdown.
 *
 * Everything shown here comes from YouTube. The label already states when a
 * track is auto-generated, so the extension adds no marker of its own and no
 * translation is applied: label, languageCode, and kind are passed through
 * exactly as received.
 */
export function renderTrackOptions(tracks, selectedIndex) {
  elements.trackSelect.replaceChildren();

  (Array.isArray(tracks) ? tracks : []).forEach((track, index) => {
    const option = document.createElement('option');
    const languageLabel = track.languageCode ? ` · ${track.languageCode}` : '';

    option.value = String(index);
    option.textContent = `${track.label}${languageLabel}`;
    elements.trackSelect.appendChild(option);
  });

  elements.trackSelect.value = String(selectedIndex);
}

export function renderTranscript(cues, onSeek) {
  const fragment = document.createDocumentFragment();

  cues.forEach((cue) => {
    const row = document.createElement('div');
    row.className = 'cue';

    const timeButton = document.createElement('button');
    timeButton.type = 'button';
    timeButton.className = 'cue-time';
    timeButton.textContent = formatTimestamp(cue.startMs);
    timeButton.title = translate('transcript.seekTitle');
    timeButton.addEventListener('click', () => onSeek(cue.startMs));

    const text = document.createElement('p');
    text.className = 'cue-text';
    text.textContent = cue.text;

    row.append(timeButton, text);
    fragment.appendChild(row);
  });

  elements.transcript.replaceChildren(fragment);
  currentCueCount = cues.length;
  renderCueCount();
}

export function clearTranscript() {
  elements.transcript.replaceChildren();
  currentCueCount = null;
  elements.cueCount.textContent = '';
}

/**
 * @param {string|{key: string, params?: Record<string, unknown>}} message
 */
export function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = resolveMessage(message);
  elements.toast.classList.add('show');

  toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove('show');
  }, 1800);
}
