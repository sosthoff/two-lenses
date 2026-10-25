// Records the 1-minute demo video: drives the real app in Chrome, narrates with macOS `say`,
// muxes with ffmpeg. Needs `npm run serve` on :4317 and the runs named below in out/.
// Usage: node scripts/demo-video.mjs   → out/demo/two-lenses-demo.mp4
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4317';
const OUT = path.resolve('out/demo');
const VOICE = process.env.VOICE || 'Samantha';
const CRITIQUE_RUN = '2026-10-25T17-53-00'; // Argon catches its own 1:05 → 105 mistake
const PASSED_RUN = '2026-10-25T18-06-06';
const SAMPLE = 'https://www.youtube.com/watch?v=axeGlqVhwks';

const scenes = [
  { id: 'launch', text: "Most people only ever see one outlet's version of a story. With Two Lenses, you paste a single news video," },
  { id: 'discover', text: 'and it finds how other outlets covered the same event. Here, Fox News and NBC on the French protests.' },
  {
    id: 'explainer',
    min: 21,
    text: "Gemini 4 Argon watches both full reports, and lines up the moments that answer the same question. Fox opens on rioters. NBC, on demonstrators. Same day, same crowd: one predicts worse, the other calls it mostly peaceful. Every note is tied to a timestamp and a verbatim quote.",
  },
  {
    id: 'critique',
    text: 'Then Argon renders the explainer, watches its own recording, and critiques it for grounding, fairness, and readability. Here, it caught itself writing one oh five as a hundred and five seconds, and moved every clip back to where the words are actually said.',
  },
  { id: 'passed', min: 4.5, text: 'It loops, until it passes.' },
  { id: 'end', min: 5, text: 'Two Lenses. Open source, and built with Gemini 4 Argon.' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const duration = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString());

fs.mkdirSync(OUT, { recursive: true });
for (const s of scenes) {
  s.audio = path.join(OUT, `${s.id}.aiff`);
  execFileSync('say', ['-v', VOICE, '-r', '182', '-o', s.audio, s.text]);
  s.speech = duration(s.audio);
  s.length = Math.max(s.min || 0, s.speech + 0.6);
}
console.log(scenes.map((s) => `${s.id} ${s.length.toFixed(1)}s`).join(' · '), `= ${scenes.reduce((a, s) => a + s.length, 0).toFixed(1)}s`);

const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const size = { width: 1280, height: 720 };
const context = await browser.newContext({ viewport: size, recordVideo: { dir: OUT, size } });
const page = await context.newPage();
const t0 = Date.now();
const smooth = (sel, block = 'center') =>
  page.evaluate(([sel, block]) => document.querySelector(sel)?.scrollIntoView({ behavior: 'smooth', block }), [sel, block]);
const highlight = (sel, text) =>
  page.evaluate(([sel, text]) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.textContent.includes(text));
    if (!el) return false;
    el.style.transition = 'box-shadow .4s';
    el.style.boxShadow = 'inset 0 0 0 2px #f5b544, 0 0 30px -6px #f5b544';
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }, [sel, text]);

async function scene(s, actions) {
  s.start = (Date.now() - t0) / 1000;
  const until = Date.now() + s.length * 1000;
  await actions();
  await sleep(Math.max(0, until - Date.now()));
}

// Pre-load the first page so the video doesn't open on a blank tab.
await page.goto(`${BASE}/launch/`);
await page.waitForSelector('.sample');
await page.fill('#url', '');
await sleep(600);

await scene(scenes[0], async () => {
  await sleep(1500);
  await page.type('#url', SAMPLE, { delay: 35 });
});

await scene(scenes[1], async () => {
  await page.click('#go');
  await page.waitForURL(/viewer/);
  await page.waitForSelector('#discovery:not([hidden]) .cand');
  await sleep(900);
  await smooth('#discovery', 'start');
});

await scene(scenes[2], async () => {
  await page.goto(`${BASE}/player/?lens=/out/demo/lens.json&mode=reel&maxSeg=8`);
});

await scene(scenes[3], async () => {
  await page.goto(`${BASE}/viewer/?run=${CRITIQUE_RUN}`);
  await page.waitForSelector('.iter .issue');
  // Single-column, larger text so the highlighted issue is readable at 720p.
  await page.addStyleTag({ content: 'main { zoom: 1.45; max-width: 860px; } .iters { grid-template-columns: 1fr; }' });
  await sleep(1200);
  await highlight('.iter:first-child .issue', 'misconverted');
  await sleep(6500);
  await highlight('.iter:first-child .change', 'Who gets to explain');
});

await scene(scenes[4], async () => {
  await page.goto(`${BASE}/viewer/?run=${PASSED_RUN}`);
  await page.waitForSelector('.prog-grid');
});

await scene(scenes[5], async () => {
  await page.goto(`${BASE}/out/demo/endcard.html`);
});

const video = page.video();
await context.close();
await browser.close();
const raw = path.join(OUT, 'raw.webm');
fs.renameSync(await video.path(), raw);

// Cut to the first scene and lay each narration clip at its scene's start.
const offset = scenes[0].start;
const total = scenes.reduce((a, s) => a + s.length, 0);
const inputs = scenes.flatMap((s) => ['-i', s.audio]);
const delays = scenes.map((s, i) => `[${i + 1}]adelay=${Math.round((s.start - offset) * 1000 + 150)}:all=1[a${i}]`).join(';');
const mix = `${scenes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${scenes.length}:normalize=0[a]`;
const final = path.join(OUT, 'two-lenses-demo.mp4');
execFileSync('ffmpeg', [
  '-v', 'error', '-y',
  '-ss', offset.toFixed(2), '-i', raw, ...inputs,
  '-filter_complex', `${delays};${mix}`,
  '-map', '0:v', '-map', '[a]', '-t', total.toFixed(2),
  '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', final,
]);
console.log(`→ ${final} (${duration(final).toFixed(1)}s)`);
