// Deterministic checks that run every iteration, before the model critic.
// Issue: { kind: grounding|fairness|readability, severity: error|warn, momentId, sourceId, message, data }
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './paths.js';
import { parseVtt, findQuote } from './captions.js';

const MAX_NOTE = 140;
const MAX_SEG = 30;
const MIN_SEG = 3;

export function runChecks(lens) {
  const issues = [];
  const add = (kind, severity, momentId, sourceId, message, data) =>
    issues.push({ kind, severity, momentId, sourceId, message, ...(data && { data }), by: 'checks' });

  const captions = {};
  for (const s of lens.sources) {
    if (s.captions && fs.existsSync(path.join(ROOT, s.captions))) captions[s.id] = parseVtt(path.join(ROOT, s.captions));
  }

  for (const m of lens.moments) {
    const present = lens.sources.filter((s) => m.segments[s.id]);
    for (const s of present) {
      const seg = m.segments[s.id];
      const len = seg.end - seg.start;

      if (seg.start < 0 || seg.end <= seg.start || (s.duration && seg.end > s.duration + 0.5))
        add('grounding', 'error', m.id, s.id, `Invalid range ${seg.start}–${seg.end} (video is ${s.duration}s)`);
      if (len > MAX_SEG) add('readability', 'warn', m.id, s.id, `Segment is ${len}s; keep under ${MAX_SEG}s`);
      if (len < MIN_SEG) add('readability', 'warn', m.id, s.id, `Segment is ${len}s; too short to follow`);
      if ((seg.note || '').length > MAX_NOTE)
        add('readability', 'error', m.id, s.id, `Note is ${seg.note.length} chars; max ${MAX_NOTE} to be readable on screen`);

      if (captions[s.id] && seg.quote) {
        const at = findQuote(captions[s.id], seg.quote);
        if (at === null) add('grounding', 'warn', m.id, s.id, `Quote "${seg.quote}" not found in captions`);
        else if (at < seg.start - 2 || at > seg.end)
          add('grounding', 'error', m.id, s.id, `Quote "${seg.quote}" is said at ${at.toFixed(1)}s, outside segment ${seg.start}–${seg.end}`, { quoteAt: at });
      }
    }

    // Fairness: every outlet shown in a moment gets the same scrutiny.
    const scrutinized = present.filter((s) => m.segments[s.id].technique && m.segments[s.id].technique !== 'none');
    if (scrutinized.length && scrutinized.length < present.length) {
      for (const s of present.filter((p) => !scrutinized.includes(p)))
        add('fairness', 'error', m.id, s.id, `Asymmetric scrutiny: ${scrutinized.map((x) => x.label).join(', ')} gets a framing note here but ${s.label} does not`);
    }
  }

  // Fairness across the whole explainer.
  const counts = Object.fromEntries(lens.sources.map((s) => [s.id, 0]));
  for (const m of lens.moments)
    for (const [id, seg] of Object.entries(m.segments)) if (seg.technique && seg.technique !== 'none') counts[id]++;
  const vals = Object.values(counts);
  if (Math.max(...vals) - Math.min(...vals) > 1)
    add('fairness', 'warn', null, null, `Uneven number of framing notes per outlet: ${JSON.stringify(counts)}`);

  return issues;
}

export function scoreIssues(issues) {
  const score = (kind) => {
    const of = issues.filter((i) => i.kind === kind);
    const penalty = of.reduce((p, i) => p + (i.severity === 'error' ? 0.25 : 0.1), 0);
    return Math.max(0, +(1 - penalty).toFixed(2));
  };
  return { grounding: score('grounding'), fairness: score('fairness'), readability: score('readability') };
}
