// Stand-in for Argon until we have access. analyze() returns a hand-written draft (with deliberate
// flaws), critique() adds nothing beyond the deterministic checks, fix() applies mechanical fixes
// plus hand-written replacement text from stub/fixes.json.
import fs from 'node:fs';
import path from 'node:path';

export const name = 'stub';

export async function analyze({ set, setDir }) {
  const draftFile = path.join(setDir, 'stub', 'draft.json');
  if (!fs.existsSync(draftFile))
    throw new Error('Sources found and downloaded. Analyzing new videos needs Gemini 4 Argon: set GEMINI_API_KEY. The offline stub only knows the curated France sample.');
  const draft = JSON.parse(fs.readFileSync(draftFile, 'utf8'));
  return { event: set.event, goal: set.goal, ...draft };
}

export async function critique() {
  return { issues: [], summary: 'Stub critic: recording not inspected, deterministic checks only.' };
}

export async function fix({ lens, critique, setDir }) {
  const fixesFile = path.join(setDir, 'stub', 'fixes.json');
  const fixes = fs.existsSync(fixesFile) ? JSON.parse(fs.readFileSync(fixesFile, 'utf8')) : {};
  const next = structuredClone(lens);
  const changes = [];

  for (const issue of critique.issues.filter((i) => i.severity === 'error' && i.momentId)) {
    const seg = next.moments.find((m) => m.id === issue.momentId)?.segments[issue.sourceId];
    if (!seg) continue;
    const key = `${issue.momentId}.${issue.sourceId}`;

    if (issue.kind === 'grounding' && issue.data?.quoteAt != null) {
      const len = seg.end - seg.start;
      seg.start = Math.max(0, Math.floor(issue.data.quoteAt - 2));
      seg.end = seg.start + len;
      changes.push(`${key}: moved segment to ${seg.start}–${seg.end} to match quote`);
    } else if (fixes[key]) {
      Object.assign(seg, fixes[key]);
      changes.push(`${key}: rewrote ${Object.keys(fixes[key]).join(', ')}`);
    }
  }
  return { lens: next, changes };
}
