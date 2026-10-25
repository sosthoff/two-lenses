// Render the explainer in headless Chrome and record it to video.
// Uses the installed Chrome (channel: 'chrome') because Playwright's Chromium can't decode H.264.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';

export async function record({ baseUrl, lensUrl, outDir, maxSeg }) {
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const size = { width: 1280, height: 720 };
  const context = await browser.newContext({ viewport: size, recordVideo: { dir: outDir, size } });
  const page = await context.newPage();
  const t0 = Date.now();
  page.on('console', (m) => m.type() === 'error' && console.error('  [player]', m.text()));
  page.on('pageerror', (e) => console.error('  [player]', e.message));

  const q = new URLSearchParams({ lens: lensUrl, mode: 'reel' });
  if (maxSeg) q.set('maxSeg', String(maxSeg));
  await page.goto(`${baseUrl}/player/?${q}`);
  await page.waitForFunction(() => window.__reelDone === true, null, { timeout: 15 * 60 * 1000, polling: 500 });

  const marks = (await page.evaluate(() => window.__marks)).map((m) => ({ id: m.id, t: +((m.t - t0) / 1000).toFixed(2) }));
  const video = page.video();
  await context.close();
  await browser.close();

  const recording = path.join(outDir, 'recording.webm');
  fs.renameSync(await video.path(), recording);
  fs.writeFileSync(path.join(outDir, 'marks.json'), JSON.stringify(marks, null, 2));

  // Playwright writes variable-frame-rate WebM; the critic misreads it as frozen video.
  // Give it a constant-frame-rate H.264 copy.
  const forCritic = path.join(outDir, 'recording.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', recording, '-r', '25', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', forCritic]);
  return { recording, forCritic, marks };
}
