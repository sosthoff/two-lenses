// Given one news video, find how other outlets covered the same event.
// A video already in the local library resolves to its curated set; anything else goes through
// YouTube: metadata → search queries → search → rank → download → new set.json.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './paths.js';

const sh = promisify(execFile);
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const MAX_ALTERNATIVES = 2;

export const youtubeId = (s) => /(?:v=|youtu\.be\/|shorts\/|embed\/|^)([\w-]{11})(?:[&?#/]|$)/.exec(String(s).trim())?.[1];
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

const brief = (j) => ({
  id: j.id,
  title: j.title,
  channel: j.channel || j.uploader || '',
  date: j.upload_date || null,
  duration: Math.round(j.duration || 0),
  url: j.webpage_url || `https://www.youtube.com/watch?v=${j.id}`,
  thumbnail: `https://i.ytimg.com/vi/${j.id}/mqdefault.jpg`,
});

// Every sample folder with a set.json, plus the clips downloaded into it.
// Cached briefly: the .info.json files are large.
let cached = { at: 0, value: null };
export function library() {
  if (cached.value && Date.now() - cached.at < 30_000) return cached.value;
  cached = { at: Date.now(), value: scanLibrary() };
  return cached.value;
}

function scanLibrary() {
  const base = path.join(ROOT, 'samples');
  return fs
    .readdirSync(base)
    .filter((d) => fs.existsSync(path.join(base, d, 'set.json')))
    .map((d) => {
      const dir = path.join(base, d);
      const set = read(path.join(dir, 'set.json'));
      const clips = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith('.info.json'))
        .map((f) => ({ ...brief(read(path.join(dir, f))), file: path.relative(ROOT, path.join(dir, f.replace('.info.json', '.mp4'))) }))
        .filter((c) => fs.existsSync(path.join(ROOT, c.file)));
      // Curated = part of a set with a hand-written draft, so it runs end to end without a model.
      const offline = fs.existsSync(path.join(dir, 'stub', 'draft.json'));
      const inSet = new Set(set.sources.map((s) => s.file));
      for (const c of clips) c.curated = offline && inSet.has(c.file);
      return { dir: path.relative(ROOT, dir), setPath: path.relative(ROOT, path.join(dir, 'set.json')), event: set.event, clips };
    });
}

function fromLibrary(id, runDir) {
  for (const lib of library()) {
    const input = lib.clips.find((c) => c.id === id);
    if (!input) continue;
    const set = read(path.join(ROOT, lib.setPath));
    let setPath = path.join(ROOT, lib.setPath);
    let sources = set.sources;
    const own = sources.find((s) => s.file === input.file);
    if (own) {
      sources = [own, ...sources.filter((s) => s !== own)];
    } else {
      // Input is in the library but not part of the curated pair: pair it with the other outlets.
      sources = [{ id: slug(input.channel), label: input.channel, file: input.file }, ...sources.filter((s) => s.label !== input.channel)];
      setPath = path.join(runDir, 'set.json');
      fs.writeFileSync(setPath, JSON.stringify({ ...set, sources }, null, 2));
    }
    const chosen = new Map(sources.slice(1).map((s, k) => [s.file, k + 1]));
    const candidates = lib.clips
      .filter((c) => c.id !== id && c.channel !== input.channel)
      .map((c) => ({ ...c, selected: chosen.has(c.file), lens: chosen.get(c.file) }))
      .sort((a, b) => b.selected - a.selected);
    return { mode: 'library', setPath, input: { ...input, lens: 0 }, queries: [], candidates };
  }
  return null;
}

const STOP = new Set(
  'the a an and or of in on at to for as is are was were be by with from this that it its after over into amid says say said new news live watch see breaking video full latest update just developing exclusive report reports what how why who'.split(' ')
);
const keywords = (title, channel = '') => {
  const skip = new Set(channel.toLowerCase().split(/\W+/));
  return title.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !skip.has(w));
};

function heuristicQueries(input) {
  const words = keywords(input.title, input.channel);
  return [...new Set([words.slice(0, 6).join(' '), `${words.slice(0, 3).join(' ')} news`])].filter(Boolean);
}

// Without a model, prefer established outlets over local stations and commentary channels.
const OUTLETS = new Set(
  ['BBC News', 'CNN', 'Fox News', 'NBC News', 'ABC News', 'CBS News', 'Al Jazeera English', 'Reuters', 'Associated Press', 'Sky News', 'DW News', 'FRANCE 24 English', 'PBS NewsHour', 'MSNBC', 'MS NOW', 'Guardian News', 'The Telegraph', 'Bloomberg Television', 'CBC News: The National', 'euronews', 'WION', 'ITV News', 'Channel 4 News', 'NBC News NOW', 'CBS Evening News', 'The Wall Street Journal', 'The New York Times', 'Washington Post', 'TRT World', 'CGTN', 'NDTV', 'Times Radio', 'GB News', 'Newsmax', 'Fox Business', 'CNBC Television', 'Yahoo Finance', 'LiveNOW from FOX', 'Global News'].map((s) => s.toLowerCase())
);

function heuristicRank(input, candidates) {
  const want = new Set(keywords(input.title, input.channel));
  const overlap = (c) => keywords(c.title, c.channel).filter((w) => want.has(w)).length;
  const score = (c) => overlap(c) + (OUTLETS.has(c.channel.toLowerCase()) && overlap(c) > 0 ? 3 : 0);
  return [...candidates].sort((a, b) => score(b) - score(a));
}

async function ytdlpJson(args) {
  const { stdout } = await sh('yt-dlp', ['-J', '--no-warnings', ...args], { maxBuffer: 1 << 28 });
  return JSON.parse(stdout);
}

async function download(url, dir, name) {
  const base = ['-q', '--no-warnings', '-f', 'bv*[height<=480][ext=mp4]+ba[ext=m4a]/b[height<=480]/b', '--merge-output-format', 'mp4', '--write-info-json', '-o', path.join(dir, `${name}.%(ext)s`)];
  try {
    await sh('yt-dlp', [...base, '--write-auto-subs', '--sub-langs', 'en', '--sub-format', 'vtt', '--', url], { maxBuffer: 1 << 26 });
  } catch {
    // Captions are often rate-limited (429); the video alone is enough.
    await sh('yt-dlp', [...base, '--', url], { maxBuffer: 1 << 26 });
  }
  return path.relative(ROOT, path.join(dir, `${name}.mp4`));
}

async function fromWeb(url, model, update) {
  update({ mode: 'web', stage: 'resolving' });
  const meta = await ytdlpJson(['--skip-download', '--', url]);
  const input = { ...brief(meta), description: (meta.description || '').slice(0, 600), lens: 0 };
  update({ input, stage: 'searching' });

  const queries = (await model.searchQueries?.(input)) || heuristicQueries(input);
  update({ queries });
  const seen = new Map();
  for (const q of queries) {
    const res = await ytdlpJson([`ytsearch10:${q}`, '--flat-playlist']);
    for (const e of res.entries || []) if (e.id && !seen.has(e.id)) seen.set(e.id, brief(e));
  }
  let pool = [...seen.values()].filter((c) => c.id !== input.id && c.channel && c.channel !== input.channel && c.duration >= 45 && c.duration <= 1200);

  update({ stage: 'ranking' });
  pool = (await model.rankCandidates?.(input, pool)) || heuristicRank(input, pool);
  const chosen = [];
  for (const c of pool) if (chosen.length < MAX_ALTERNATIVES && !chosen.some((x) => x.channel === c.channel)) chosen.push(c);
  if (!chosen.length) throw new Error('No coverage from other outlets found for this video');
  const candidates = pool.slice(0, 8).map((c) => ({ ...c, selected: chosen.includes(c), lens: chosen.includes(c) ? chosen.indexOf(c) + 1 : undefined }));
  update({ candidates, stage: 'downloading' });

  const dir = path.join(ROOT, 'samples', `web-${input.id}`);
  fs.mkdirSync(dir, { recursive: true });
  const sources = [];
  for (const c of [input, ...chosen]) {
    let id = slug(c.channel) || c.id;
    while (sources.some((s) => s.id === id)) id += '-2';
    sources.push({ id, label: c.channel, url: c.url, name: `${id}_${c.id}` });
  }
  await Promise.all(sources.map(async (s) => (s.file = await download(s.url, dir, s.name))));
  for (const s of sources) delete s.name;
  const set = {
    event: input.title,
    goal: read(path.join(ROOT, 'samples', 'france-protests', 'set.json')).goal,
    sources,
  };
  const setPath = path.join(dir, 'set.json');
  fs.writeFileSync(setPath, JSON.stringify(set, null, 2));
  return { mode: 'web', setPath, input, queries, candidates };
}

export async function discover({ url, model, runDir, update }) {
  const id = youtubeId(url);
  const local = id && fromLibrary(id, runDir);
  if (local) {
    update({ ...local, stage: 'done' });
    return local;
  }
  const found = await fromWeb(url, model, update);
  update({ stage: 'done' });
  return found;
}
