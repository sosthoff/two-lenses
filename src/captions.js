// YouTube auto-caption (.vtt) parsing and quote lookup, used to ground annotations.
import fs from 'node:fs';

export function parseVtt(file) {
  const cues = [];
  let last = '';
  for (const block of fs.readFileSync(file, 'utf8').split(/\n\n+/)) {
    const m = /(\d+):(\d+):(\d+)\.(\d+) -->/.exec(block);
    if (!m) continue;
    const t = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const lines = block
      .split('\n')
      .slice(1)
      .map((l) => l.replace(/<[^>]+>/g, '').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim())
      .filter((l) => l && !l.includes('-->'));
    // Auto-captions roll: each cue repeats the previous line, the new text is the last line.
    const text = lines.at(-1);
    if (!text || text === last) continue;
    last = text;
    cues.push({ t, text });
  }
  return cues;
}

const FILLER = new Set(['uh', 'um', 'er', 'ah', 'like', 'you', 'know']);
// Lowercase words without punctuation, filler and immediate repeats ("the the", "of of").
const words = (s) =>
  s
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w, i, a) => w && !FILLER.has(w) && w !== a[i - 1])
    .map((w) => (w.length > 3 ? w.replace(/s$/, '') : w)); // crude plural folding: communists ≈ communist

// Returns the time (s) where the quote starts, or null if not found.
// Speech is messy, so quote words must appear in order with at most 2 extra words between them.
export function findQuote(cues, quote) {
  const q = words(quote);
  if (!q.length) return null;
  const toks = [];
  for (const c of cues) for (const w of words(c.text)) if (w !== toks.at(-1)?.w) toks.push({ w, t: c.t });
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].w !== q[0]) continue;
    let j = i, k = 1;
    while (k < q.length) {
      let found = -1;
      for (let g = j + 1; g <= j + 3 && g < toks.length; g++) if (toks[g].w === q[k]) { found = g; break; }
      if (found < 0) break;
      j = found;
      k++;
    }
    if (k === q.length) return toks[i].t;
  }
  return null;
}
