import { normalizeCaptionText, normalizeCueList } from './text.js';

/**
 * Parse YouTube's JSON3 timed-text format.
 *
 * @param {string} body
 * @returns {import('./text.js').CaptionCue[]}
 */
export function parseJson3CaptionBody(body) {
  try {
    const data = JSON.parse(body);
    const events = Array.isArray(data?.events) ? data.events : [];

    return normalizeCueList(
      events
        .filter((event) => Array.isArray(event.segs) && event.segs.length > 0)
        .map((event) => ({
          startMs: Number(event.tStartMs || 0),
          durationMs: Number(event.dDurationMs || 0),
          text: event.segs.map((segment) => segment.utf8 || '').join('')
        }))
    );
  } catch {
    return [];
  }
}

/**
 * Parse YouTube XML/SRV timed-text formats.
 *
 * @param {string} body
 * @returns {import('./text.js').CaptionCue[]}
 */
export function parseXmlCaptionBody(body) {
  try {
    const xml = new DOMParser().parseFromString(body, 'text/xml');
    if (xml.querySelector('parsererror')) return [];

    return normalizeCueList(
      Array.from(xml.querySelectorAll('text, p')).map((node) => {
        const startAttr = node.getAttribute('start');
        const durationAttr = node.getAttribute('dur');
        const timeAttr = node.getAttribute('t');
        const durationMsAttr = node.getAttribute('d');

        return {
          startMs: timeAttr !== null
            ? Number(timeAttr || 0)
            : Math.round(Number(startAttr || 0) * 1000),
          durationMs: durationMsAttr !== null
            ? Number(durationMsAttr || 0)
            : Math.round(Number(durationAttr || 0) * 1000),
          text: node.textContent || ''
        };
      })
    );
  } catch {
    return [];
  }
}

/**
 * Parse WebVTT captions.
 *
 * @param {string} body
 * @returns {import('./text.js').CaptionCue[]}
 */
export function parseVttCaptionBody(body) {
  const blocks = String(body || '').replace(/\r/g, '').split(/\n\n+/);
  const cues = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const timingIndex = lines.findIndex((line) => line.includes('-->'));
    if (timingIndex === -1) continue;

    const timing = lines[timingIndex]
      .split('-->')
      .map((part) => part.trim().split(/\s+/)[0]);

    if (timing.length !== 2) continue;

    const startMs = parseVttTimestamp(timing[0]);
    const endMs = parseVttTimestamp(timing[1]);
    const text = normalizeCaptionText(decodeVttEntities(lines.slice(timingIndex + 1).join(' ')));

    if (text) {
      cues.push({
        startMs,
        durationMs: Math.max(0, endMs - startMs),
        text
      });
    }
  }

  return normalizeCueList(cues);
}

/**
 * Try all supported parsers against an unknown caption payload.
 *
 * @param {string} body
 * @returns {import('./text.js').CaptionCue[]}
 */
export function parseCaptionBody(body) {
  const json = parseJson3CaptionBody(body);
  if (json.length) return json;

  const xml = parseXmlCaptionBody(body);
  if (xml.length) return xml;

  return parseVttCaptionBody(body);
}

function parseVttTimestamp(value) {
  const parts = String(value || '').trim().split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;

  if (parts.length === 3) {
    return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  }

  if (parts.length === 2) {
    return Math.round((parts[0] * 60 + parts[1]) * 1000);
  }

  return 0;
}

// WebVTT named escapes plus common quote/numeric HTML references. Decode once:
// &amp;gt; represents the literal text &gt;, not >. Never interpret text as HTML.
export function decodeVttEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', nbsp: '\u00a0',
    lrm: '\u200e', rlm: '\u200f', quot: '"', apos: "'" };
  return String(text).replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|nbsp|lrm|rlm|quot|apos);/gi, (entity, name) => {
    if (!name.startsWith('#')) return named[name.toLowerCase()] ?? entity;
    const point = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : entity;
  });
}
