// Builds a read-only showcase of finished runs for static hosting (Cloudflare Pages):
// the launch page, loop viewer and player, plus the runs' data, recordings and source clips.
// The /api/* endpoints become static JSON via _redirects rewrites.
// Usage: node scripts/export-static.mjs <runId> [runId…] [--featured runId] → dist/
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/paths.js';
import { library } from '../src/discover.js';

const args = process.argv.slice(2);
const featured = args.includes('--featured') ? args[args.indexOf('--featured') + 1] : null;
const runIds = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--featured');
if (!runIds.length) throw new Error('Pass the run ids to include');

const DIST = path.join(ROOT, 'dist');
const MAX_FILE = 25 * 1024 * 1024; // Cloudflare Pages per-file limit
fs.rmSync(DIST, { recursive: true, force: true });

const copy = (rel) => {
  const from = path.join(ROOT, rel);
  if (fs.statSync(from).size > MAX_FILE) throw new Error(`${rel} is over 25 MiB`);
  fs.mkdirSync(path.dirname(path.join(DIST, rel)), { recursive: true });
  fs.cpSync(from, path.join(DIST, rel), { recursive: true });
};
const write = (rel, data) => {
  fs.mkdirSync(path.dirname(path.join(DIST, rel)), { recursive: true });
  fs.writeFileSync(path.join(DIST, rel), typeof data === 'string' ? data : JSON.stringify(data));
};

for (const dir of ['launch', 'viewer', 'player']) fs.cpSync(path.join(ROOT, dir), path.join(DIST, dir), { recursive: true });

const runs = [];
const sourceFiles = new Set();
for (const id of runIds) {
  const run = JSON.parse(fs.readFileSync(path.join(ROOT, 'out', id, 'run.json'), 'utf8'));
  runs.push(run);
  copy(`out/${id}/run.json`);
  for (const it of run.iterations) {
    copy(it.lens);
    if (it.recording) copy(it.recording);
    const lens = JSON.parse(fs.readFileSync(path.join(ROOT, it.lens), 'utf8'));
    for (const s of lens.sources) sourceFiles.add(s.file);
  }
}
for (const f of sourceFiles) copy(f);

const lib = library()
  .map((set) => ({ ...set, clips: set.clips.filter((c) => sourceFiles.has(c.file)) }))
  .filter((set) => set.clips.length);

write('api/runs.json', runs.sort((a, b) => b.id.localeCompare(a.id)));
write('api/library.json', lib);
write('api/config.json', { readonly: true, featuredRun: featured || runIds[0], repo: 'https://github.com/sosthoff/two-lenses' });
write(
  '_redirects',
  ['/ /launch/ 302', '/api/runs /api/runs.json 200', '/api/library /api/library.json 200', '/api/config /api/config.json 200', ''].join('\n')
);

const files = [];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : files.push(path.join(d, e.name))));
walk(DIST);
const bytes = files.reduce((a, f) => a + fs.statSync(f).size, 0);
console.log(`dist/: ${files.length} files, ${(bytes / 1e6).toFixed(1)} MB, runs: ${runIds.join(', ')}, featured: ${featured || runIds[0]}`);
