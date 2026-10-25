// [discover →] analyze → [render+record → checks + model critique → fix] until it passes.
// Usage:
//   node src/loop.js <set.json> [--max 3] [--maxSeg 5]
//   node src/loop.js --url <youtube url> [--run-id id] [--max 3] [--maxSeg 5]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, startServer } from './server.js';
import { record } from './record.js';
import { runChecks, scoreIssues } from './checks.js';
import { discover } from './discover.js';

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d);
const url = opt('url');
let setPath = !url && path.resolve(args.find((a) => a.endsWith('.json') && !a.startsWith('--')) || 'samples/france-protests/set.json');
const maxIter = Number(opt('max', 3));
const maxSeg = opt('maxSeg') && Number(opt('maxSeg'));

const provider = process.env.MODEL_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'stub');
const model = await import(`./models/${provider}.js`);

const rel = (p) => path.relative(ROOT, p);
const duration = (file) =>
  +Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString()).toFixed(2);

const runId = opt('run-id') || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const runDir = path.join(ROOT, 'out', runId);
fs.mkdirSync(runDir, { recursive: true });
const run = { id: runId, input: url || rel(setPath), event: url || '', model: model.name, status: url ? 'discovering' : 'analyzing', iterations: [] };
const save = () => fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2));
save();

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

const { server, url: baseUrl } = await startServer();
try {
  if (url) {
    log(`run ${runId} · discovering coverage for ${url}`);
    run.discovery = {};
    const found = await discover({
      url,
      model,
      runDir,
      update: (patch) => {
        Object.assign(run.discovery, patch);
        if (patch.input) run.event = patch.input.title;
        if (patch.stage) log(`  discover: ${patch.stage}`);
        save();
      },
    });
    setPath = found.setPath;
  }

  const setDir = path.dirname(setPath);
  const set = JSON.parse(fs.readFileSync(setPath, 'utf8'));
  for (const s of set.sources) {
    s.duration = duration(path.join(ROOT, s.file));
    const vtt = s.file.replace(/\.mp4$/, '.en.vtt');
    if (fs.existsSync(path.join(ROOT, vtt))) s.captions = vtt;
  }
  Object.assign(run, { set: rel(setPath), event: set.event, sources: set.sources, status: 'analyzing' });
  save();
  log(`run ${runId} · model=${model.name} · ${set.sources.map((s) => s.label).join(' vs ')}`);

  let lens;
  if (opt('lens')) lens = JSON.parse(fs.readFileSync(opt('lens'), 'utf8'));
  else {
    log('analyzing sources…');
    lens = await model.analyze({ set, setDir });
  }

  for (let n = 1; n <= maxIter; n++) {
    lens.sources = set.sources;
    const dir = path.join(runDir, `iter-${n}`);
    fs.mkdirSync(dir, { recursive: true });
    const lensFile = path.join(dir, 'lens.json');
    fs.writeFileSync(lensFile, JSON.stringify(lens, null, 2));
    const iter = { n, lens: rel(lensFile), status: 'recording' };
    run.iterations.push(iter);
    run.status = `iteration ${n}`;
    save();

    log(`iter ${n}: rendering + recording…`);
    const { recording, forCritic, marks } = await record({ baseUrl, lensUrl: `/${rel(lensFile)}`, outDir: dir, maxSeg });
    iter.recording = rel(recording);

    log(`iter ${n}: critiquing…`);
    iter.status = 'critiquing';
    save();
    const checks = runChecks(lens);
    const critic = await model.critique({ lens, recording: forCritic, marks, checks, setDir, maxSeg });
    const issues = [...checks, ...critic.issues];
    const scores = critic.scores
      ? Object.fromEntries(Object.entries(scoreIssues(checks)).map(([k, v]) => [k, Math.min(v, critic.scores[k] ?? 1)]))
      : scoreIssues(issues);
    const pass = !issues.some((i) => i.severity === 'error');
    const critique = { scores, pass, summary: critic.summary, issues };
    fs.writeFileSync(path.join(dir, 'critique.json'), JSON.stringify(critique, null, 2));
    Object.assign(iter, { scores, pass, issues, summary: critic.summary, status: 'critiqued' });
    save();

    log(`iter ${n}: ${pass ? 'PASS' : 'FAIL'} ${JSON.stringify(scores)}`);
    for (const i of issues) log(`  ${i.severity.padEnd(5)} ${i.kind.padEnd(11)} ${i.momentId ?? '-'}/${i.sourceId ?? '-'}: ${i.message}`);
    if (pass || n === maxIter) break;

    log(`iter ${n}: fixing…`);
    iter.status = 'fixing';
    save();
    const fixed = await model.fix({ lens, critique, setDir });
    iter.changes = fixed.changes;
    iter.status = 'done';
    save();
    for (const c of fixed.changes) log(`  fix: ${c}`);
    lens = fixed.lens;
  }

  const last = run.iterations.at(-1);
  run.status = last.pass ? 'passed' : 'stopped';
  run.final = last.lens;
  save();
  log(`${run.status} after ${run.iterations.length} iteration(s) · viewer: npm run serve → /viewer/?run=${runId}`);
} catch (e) {
  run.status = 'error';
  run.error = e.message;
  save();
  console.error(e);
  process.exitCode = 1;
} finally {
  server.close();
}
