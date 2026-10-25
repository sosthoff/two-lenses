// Two Lenses explainer player.
// ?lens=<url to lens.json>  &mode=reel (auto-play intro → moments → outro, for recording)
// &maxSeg=<seconds> caps each moment's length (quick dev runs).
const params = new URLSearchParams(location.search);
const mode = params.get('mode') || 'interactive';
const maxSeg = Number(params.get('maxSeg')) || 30;

window.__marks = [];
const mark = (id) => window.__marks.push({ id, t: Date.now() });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const lensColor = (k) => `var(--lens-${k % 3})`;

const lens = await (await fetch(params.get('lens'))).json();
const sources = lens.sources;
document.body.classList.toggle('reel', mode === 'reel');
// In a reel, cover the layout until the intro card is up, so the recording doesn't open on a flash of it.
if (mode === 'reel') $('card').classList.remove('hidden');
document.title = `${lens.event} · Two Lenses`;
$('cols').style.setProperty('--n', sources.length);

const cols = sources.map((s) => {
  const el = document.createElement('section');
  el.className = 'col';
  el.innerHTML = `
    <div class="vwrap">
      <video muted playsinline preload="auto" src="/${s.file}"></video>
      <span class="chip outlet">${esc(s.label)}</span>
      <span class="chip ts"></span>
      <i class="progress"></i>
    </div>
    <div class="note"><span class="technique"></span><p class="text"></p><q></q></div>`;
  $('cols').append(el);
  return {
    source: s,
    wrap: el.querySelector('.vwrap'),
    video: el.querySelector('video'),
    ts: el.querySelector('.ts'),
    progress: el.querySelector('.progress'),
    note: el.querySelector('.note'),
  };
});

lens.moments.forEach((m, i) => {
  const b = document.createElement('button');
  b.title = m.title;
  b.onclick = () => playMoment(i);
  $('timeline').append(b);
});

function waitFor(el, event, timeout = 8000) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeout);
    el.addEventListener(event, () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

async function seek(video, time) {
  if (video.readyState < 1) await waitFor(video, 'loadedmetadata');
  video.currentTime = time;
  await waitFor(video, 'seeked');
  if (video.readyState < 3) await waitFor(video, 'canplay');
}

function playUntil(col, end) {
  const v = col.video;
  v.play();
  const tick = () => {
    if (v.currentTime >= end || v.ended) {
      v.pause();
      col.wrap.classList.add('ended');
    } else if (!v.paused) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Restart a CSS animation on an element.
function restart(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

let current = -1;
let token = 0;

async function playMoment(i) {
  const my = ++token;
  current = i;
  const m = lens.moments[i];
  $('momentTitle').textContent = m.title;
  restart($('momentTitle'), 'swap');
  $('counter').textContent = `Moment ${i + 1} of ${lens.moments.length}`;
  $('takeaway').classList.remove('show');
  $('takeaway').querySelector('p').textContent = m.takeaway || '';

  const segs = cols.map((c) => m.segments[c.source.id]);
  cols.forEach((c, k) => {
    const s = segs[k];
    c.video.pause();
    c.wrap.classList.remove('ended');
    c.wrap.classList.toggle('absent', !s);
    c.note.classList.remove('show');
    c.progress.classList.remove('run');
    c.ts.textContent = s ? `${fmt(s.start)} – ${fmt(s.end)}` : '';
    if (!s) return;
    const tech = c.note.querySelector('.technique');
    tech.textContent = s.technique || 'none';
    tech.classList.toggle('none', !s.technique || s.technique === 'none');
    c.note.querySelector('.text').textContent = s.note || '';
    c.note.querySelector('q').textContent = s.quote || '';
  });

  await Promise.all(cols.map((c, k) => segs[k] && seek(c.video, segs[k].start)));
  if (my !== token) return;

  const lengths = segs.map((s) => (s ? Math.min(maxSeg, s.end - s.start) : 0));
  const dur = Math.max(...lengths);
  [...$('timeline').children].forEach((b, k) => {
    b.classList.toggle('done', k < i);
    b.classList.remove('active');
    if (k === i) {
      b.style.setProperty('--dur', `${dur}s`);
      restart(b, 'active');
    }
  });

  mark(`moment:${m.id}:start`);
  cols.forEach((c, k) => {
    if (!segs[k]) return;
    c.progress.style.setProperty('--dur', `${lengths[k]}s`);
    restart(c.progress, 'run');
    playUntil(c, segs[k].start + lengths[k]);
  });
  setTimeout(() => my === token && cols.forEach((c) => c.note.classList.add('show')), 500);
  setTimeout(() => {
    if (my !== token) return;
    $('takeaway').classList.add('show');
    restart($('takeaway'), 'swap');
  }, 1500);

  await sleep(dur * 1000 + 1000);
  if (my !== token) return;
  cols.forEach((c) => c.video.pause());
  mark(`moment:${m.id}:end`);
}

async function showCard(html, ms, { keep = false } = {}) {
  $('card').innerHTML = html;
  $('card').classList.remove('hidden');
  await sleep(ms);
  if (!keep) $('card').classList.add('hidden');
}

const intro = () => `
  <div class="eyebrow">Same event · ${sources.length} lenses</div>
  <h1>${esc(lens.event)}</h1>
  <div class="versus">${sources
    .map((s, k) => `<span class="src" style="--c:${lensColor(k)}">${esc(s.label)}</span>`)
    .join('<span class="vs">vs</span>')}</div>`;
const outro = () => `
  <div class="eyebrow">Before you share it, ask</div>
  <h1>Questions <em>for any</em> coverage</h1>
  <div class="questions">${(lens.questions || [])
    .map((q, k) => `<div><span>${String(k + 1).padStart(2, '0')}</span>${esc(q)}</div>`)
    .join('')}</div>`;

async function playReel() {
  mark('intro:start');
  const shown = showCard(intro(), 3500);
  document.documentElement.classList.remove('boot');
  await shown;
  for (let i = 0; i < lens.moments.length; i++) await playMoment(i);
  mark('outro:start');
  // The reel ends on the questions; the recording stops while they're still on screen.
  await showCard(outro(), 6000, { keep: mode === 'reel' });
  mark('reel:end');
  window.__reelDone = true;
}

$('playBtn').onclick = () => playReel();
$('prevBtn').onclick = () => playMoment(Math.max(0, current - 1));
$('nextBtn').onclick = () => playMoment(Math.min(lens.moments.length - 1, current + 1));
$('muteBtn').onclick = () => {
  const muted = !cols[0].video.muted;
  cols.forEach((c) => (c.video.muted = muted));
  $('muteBtn').textContent = muted ? 'Sound off' : 'Sound on';
};

await document.fonts.ready;
if (mode === 'reel') {
  await Promise.all(cols.map((c) => c.video.readyState >= 1 || waitFor(c.video, 'loadedmetadata')));
  playReel();
} else {
  playMoment(0);
}
