// Gemini 4 Argon: watches the source videos and the rendered recording.
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, createUserContent, createPartFromUri } from '@google/genai';
import { ROOT } from '../paths.js';

export const name = process.env.GEMINI_MODEL || 'gemini-4-argon';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const uploads = new Map();

const prompt = (file, vars) =>
  fs.readFileSync(path.join(ROOT, 'prompts', file), 'utf8').replace(/{{(\w+)}}/g, (_, k) => vars[k] ?? '');

async function upload(file) {
  if (uploads.has(file)) return uploads.get(file);
  const mimeType = file.endsWith('.webm') ? 'video/webm' : 'video/mp4';
  let f = await ai.files.upload({ file, config: { mimeType } });
  while (f.state === 'PROCESSING') {
    await new Promise((r) => setTimeout(r, 3000));
    f = await ai.files.get({ name: f.name });
  }
  if (f.state === 'FAILED') throw new Error(`Upload failed: ${file}`);
  const part = createPartFromUri(f.uri, f.mimeType);
  uploads.set(file, part);
  return part;
}

async function generateJson(parts) {
  const res = await ai.models.generateContent({
    model: name,
    contents: createUserContent(parts),
    config: { responseMimeType: 'application/json' },
  });
  return JSON.parse(res.text);
}

const sourceList = (sources) => sources.map((s, i) => `${i + 1}. id="${s.id}" ${s.label} (${s.duration}s)`).join('\n');
const sourceParts = (sources) => Promise.all(sources.map((s) => upload(path.join(ROOT, s.file))));

export async function searchQueries(input) {
  const { queries } = await generateJson([
    `A viewer pasted this news video:
Title: ${input.title}
Channel: ${input.channel}
Published: ${input.date}
Description: ${input.description}

Write 3 short YouTube search queries that would find OTHER outlets' video reports on the same specific event (same day/incident), not commentary on the outlet. Prefer neutral wording: drop the outlet's loaded words. Return JSON {"queries": ["…"]}`,
  ]);
  return queries;
}

export async function rankCandidates(input, candidates) {
  const { ids } = await generateJson([
    `Input video: "${input.title}" by ${input.channel} (${input.date}).
Candidates (id | channel | title | seconds):
${candidates.map((c) => `${c.id} | ${c.channel} | ${c.title} | ${c.duration}`).join('\n')}

Rank the candidates that are news reports from professional outlets on the SAME event, best first. Prefer outlets with a different editorial perspective from ${input.channel}, and straight reports over opinion shows. Exclude unrelated videos, reaction channels, and live streams. Return JSON {"ids": ["…"]}`,
  ]);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// The model reads and writes segment times as "m:ss" strings: given bare numbers it sometimes
// writes 1:05 as 105. Internally (lens.json, player, checks) times stay in seconds.
const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(0).padStart(2, '0')}`;
const seconds = (v) => {
  const m = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(String(v).trim());
  return m ? +m[1] * 60 + +m[2] : Number(v);
};
const mapTimes = (moments = [], f) =>
  moments.map((m) => ({
    ...m,
    segments: Object.fromEntries(Object.entries(m.segments || {}).map(([k, s]) => [k, { ...s, start: f(s.start), end: f(s.end) }])),
  }));
const forModel = ({ sources, ...data }) => ({ ...data, moments: mapTimes(data.moments, clock) });

export async function analyze({ set }) {
  const text = prompt('analyze.md', { n: set.sources.length, event: set.event, goal: set.goal, sources: sourceList(set.sources) });
  const draft = await generateJson([...(await sourceParts(set.sources)), text]);
  return { event: set.event, goal: set.goal, ...draft, moments: mapTimes(draft.moments, seconds) };
}

export async function critique({ lens, recording, marks, checks, maxSeg }) {
  const { sources } = lens;
  const data = forModel(lens);
  const text = prompt('critique.md', {
    render: maxSeg
      ? `This is a quick PREVIEW render: every clip is cut off after ${maxSeg} seconds. That is intentional. Do not report clips being cut short or quotes falling after the cut; judge grounding against each segment's full start–end range in the source videos.`
      : 'Clips play their full start–end range.',
    sources: sourceList(sources),
    goal: lens.goal,
    lens: JSON.stringify(data, null, 2),
    marks: JSON.stringify(marks),
    checks: JSON.stringify(checks, null, 2),
  });
  const result = await generateJson([await upload(recording), ...(await sourceParts(sources)), text]);
  return { ...result, issues: (result.issues || []).map((i) => ({ ...i, by: 'model' })) };
}

export async function fix({ lens, critique }) {
  const { sources } = lens;
  const text = prompt('fix.md', {
    sources: sourceList(sources),
    goal: lens.goal,
    lens: JSON.stringify(forModel(lens), null, 2),
    issues: JSON.stringify(critique.issues, null, 2),
  });
  const { changes = [], ...patched } = await generateJson([...(await sourceParts(sources)), text]);
  return { lens: { ...lens, ...patched, moments: mapTimes(patched.moments, seconds) }, changes };
}
