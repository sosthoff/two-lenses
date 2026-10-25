const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pct = (v) => Math.round(v * 100);
const quality = (v) => (v >= 0.9 ? 'var(--good)' : v >= 0.6 ? 'var(--warn)' : 'var(--bad)');

const STEPS = [
  ['Find sources', 'Other outlets, same event'],
  ['Analyze', 'Watch every source'],
  ['Render', 'Play & record explainer'],
  ['Watch & critique', 'Review the recording'],
  ['Fix', 'Patch the explainer'],
];
const DISCOVERY_STAGES = {
  resolving: 'Reading the video',
  searching: 'Searching for other coverage',
  ranking: 'Ranking candidates',
  downloading: 'Downloading selected reports',
};
const shortDate = (d) => (d ? new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const lensVar = (k) => (k == null ? 'var(--ink-3)' : `var(--lens-${k % 3})`);
let lastDiscovery = '';

let selected = new URLSearchParams(location.search).get('run');
let lastJson = '';
const lensCache = new Map();
const cardHtml = new Map();

async function getLens(url) {
  if (!lensCache.has(url)) lensCache.set(url, fetch(`/${url}`).then((r) => r.json()));
  return lensCache.get(url);
}

function stageOf(run) {
  if (run.status === 'passed' || run.status === 'stopped') return STEPS.length;
  if (run.status === 'starting' || run.status === 'discovering' || !run.sources) return run.discovery || run.status !== 'analyzing' ? 0 : 1;
  if (run.status === 'analyzing' || !run.iterations.length) return 1;
  const s = run.iterations.at(-1)?.status;
  return { recording: 2, critiquing: 3, critiqued: 3, fixing: 4, done: 4 }[s] ?? 2;
}

function statusPill(run) {
  const el = $('status');
  const error = run.status === 'error';
  const live = !['passed', 'stopped'].includes(run.status) && !error;
  el.className = `status ${live ? 'live' : error ? 'error' : run.status}`;
  el.textContent = run.status === 'passed' ? `Passed in ${run.iterations.length} iteration${run.iterations.length > 1 ? 's' : ''}`
    : run.status === 'stopped' ? 'Stopped: iteration limit'
    : error ? 'Stopped with an error'
    : run.status === 'discovering' ? `Finding sources · ${DISCOVERY_STAGES[run.discovery?.stage] || 'starting'}`
    : run.status === 'starting' ? 'Starting…'
    : `Running · ${run.status}`;
}

function renderStepper(run) {
  const stage = stageOf(run);
  const failed = run.status === 'error';
  const n = run.iterations.length || 1;
  // A run started from a set file (CLI) skips discovery.
  const skipped = (i) => i === 0 && !run.discovery && run.status !== 'starting';
  $('stepper').innerHTML =
    STEPS.map(([t, sub], i) => `
      <div class="step ${failed && i === stage ? 'failed' : i < stage ? 'done' : i === stage ? 'active' : ''}">
        <span class="dot">${failed && i === stage ? '✕' : skipped(i) ? '–' : i < stage ? '✓' : i + 1}</span>
        <span class="lbl"><b>${t}</b><small>${sub}</small></span>
        <span class="bar"></span>
      </div>`).join('') +
    `<div class="loopback">↺ until it passes · <b>${n}</b></div>`;
}

function renderProgress(run) {
  const its = run.iterations.filter((it) => it.scores);
  if (!its.length) return ($('progress').hidden = true);
  $('progress').hidden = false;
  const crits = Object.keys(its[0].scores);
  const head = `<span></span>${its.map((it) => `<span class="head">Iteration ${it.n}</span>`).join('')}`;
  const rows = crits.map((k) => `<span class="crit">${k}</span>` + its.map((it, j) => {
    const v = it.scores[k];
    const d = j ? v - its[j - 1].scores[k] : 0;
    return `<div class="cell"><div class="meter"><i style="width:${pct(v)}%;--q:${quality(v)}"></i></div><span class="v">${pct(v)}</span><span class="delta">${d > 0 ? '+' + pct(d) : ''}</span></div>`;
  }).join('')).join('');
  const errs = `<span class="crit">Open errors</span>` + its.map((it) => {
    const c = it.issues.filter((i) => i.severity === 'error').length;
    return `<div class="cell"><span class="count ${c ? 'some' : 'zero'}">${c}</span></div>`;
  }).join('');
  $('progress').innerHTML = `
    <h2>Quality over iterations</h2>
    <div class="prog-grid" style="--n:${its.length}">${head}${rows}${errs}</div>`;
}

function diffLens(a, b) {
  const labels = Object.fromEntries((b.sources || []).map((s) => [s.id, s.label]));
  const out = [];
  for (const m of b.moments) {
    const prev = a.moments.find((x) => x.id === m.id);
    if (!prev) { out.push({ where: m.title, rows: [['moment', '', 'added']] }); continue; }
    for (const [sid, seg] of Object.entries(m.segments)) {
      const old = prev.segments[sid] || {};
      const rows = [];
      if (old.start !== seg.start || old.end !== seg.end)
        rows.push(['clip', old.start != null ? `${fmt(old.start)}–${fmt(old.end)}` : '', `${fmt(seg.start)}–${fmt(seg.end)}`]);
      for (const f of ['technique', 'note', 'quote']) if ((old[f] || '') !== (seg[f] || '')) rows.push([f, old[f] || '', seg[f] || '']);
      if (rows.length) out.push({ where: `${m.title} · ${labels[sid] || sid}`, rows });
    }
  }
  return out;
}

async function iterCard(run, it, i) {
  const badge = it.pass === true ? '<span class="badge pass">Pass</span>'
    : it.pass === false ? '<span class="badge fail">Fail</span>'
    : `<span class="badge live">${esc(it.status)}…</span>`;
  const media = it.recording
    ? `<video src="/${it.recording}#t=6" controls muted preload="metadata" playsinline></video>`
    : `<div class="wait"><div class="spinner"></div>Rendering &amp; recording the explainer</div>`;

  const cur = it.lens ? await getLens(it.lens) : { moments: [], sources: [] };
  const momentName = (id) => cur.moments.find((m) => m.id === id)?.title || id;
  const sourceName = (id) => cur.sources?.find((s) => s.id === id)?.label || id;
  const issues = (it.issues || []).map((x) => `
    <div class="issue ${x.severity}">
      <span class="sev"></span>
      <div>
        <div class="where"><span class="tag">${esc(x.kind)}</span>${x.momentId ? `<span>${esc(momentName(x.momentId))}${x.sourceId ? ' · ' + esc(sourceName(x.sourceId)) : ''}</span>` : ''}<span class="tag by">${esc(x.by)}</span></div>
        <p>${esc(x.message)}</p>
      </div>
    </div>`).join('');

  let changes = '';
  const next = run.iterations[i + 1];
  if (next?.lens) {
    const [a, b] = await Promise.all([getLens(it.lens), getLens(next.lens)]);
    changes = diffLens(a, b).map((d) => `
      <div class="change">
        <div class="where"><b>${esc(d.where)}</b></div>
        <div class="stack">${d.rows.map(([f, before, after]) => `
          <div><span class="tag">${f}</span> ${before ? `<del>${esc(before)}</del><span class="arrow">→</span>` : ''}<ins>${esc(after)}</ins></div>`).join('')}
        </div>
      </div>`).join('');
  } else if (it.changes?.length) {
    changes = it.changes.map((c) => `<div class="change">${esc(c)}</div>`).join('');
  }

  return `
    <article class="iter">
      <header><h3>Iteration <span>${it.n}</span></h3>${badge}</header>
      <div class="media">${media}</div>
      <div class="body">
        ${it.summary ? `<p class="summary">${esc(it.summary)}</p>` : ''}
        ${issues ? `<div class="sect"><div class="eyebrow"><span>Critique</span><span>${it.issues.length} issue${it.issues.length > 1 ? 's' : ''}</span></div>${issues}</div>` : ''}
        ${it.pass && !issues ? `<div class="sect"><div class="eyebrow">Critique</div><p class="summary">No issues found. Explainer is grounded, balanced and readable.</p></div>` : ''}
        ${changes ? `<div class="sect"><div class="eyebrow">Fixed for next iteration</div>${changes}</div>` : ''}
      </div>
    </article>`;
}

function clipInfo(c) {
  return `
    <div class="info">
      <div class="ch">${esc(c.channel)}</div>
      <div class="ttl">${esc(c.title)}</div>
      <div class="meta">${[shortDate(c.date), c.duration ? fmt(c.duration) : ''].filter(Boolean).join(' · ')}</div>
    </div>`;
}

function renderDiscovery(run) {
  const d = run.discovery;
  $('discovery').hidden = !d;
  if (!d) return;
  const key = JSON.stringify(d) + run.status;
  if (key === lastDiscovery) return;
  lastDiscovery = key;

  const working = (label) =>
    run.status === 'error' ? '<div class="working">Not available</div>' : `<div class="working"><span class="spinner sm"></span>${label}</div>`;
  const how = d.mode === 'library'
    ? '<span class="lib">● Matched in local library</span>'
    : d.queries?.length ? `Searched YouTube for ${d.queries.map((q) => `<span class="q">${esc(q)}</span>`).join('')}` : '';
  const input = d.input
    ? `<div class="big" style="--c:${lensVar(0)}"><div class="thumb"><img src="${esc(d.input.thumbnail)}" alt=""><span class="dur">${fmt(d.input.duration)}</span></div>${clipInfo(d.input)}</div>`
    : working(DISCOVERY_STAGES.resolving);
  const cands = d.candidates?.length
    ? d.candidates.map((c, i) => `
        <div class="cand ${c.selected ? 'selected' : ''}" style="--c:${lensVar(c.lens)};animation-delay:${i * 60}ms">
          <div class="thumb"><img src="${esc(c.thumbnail)}" alt="" loading="lazy"></div>
          ${clipInfo(c)}
          ${c.selected ? '<span class="pick">Selected</span>' : ''}
        </div>`).join('') +
      (d.stage && d.stage !== 'done' ? working(DISCOVERY_STAGES[d.stage] || d.stage) : '')
    : working(DISCOVERY_STAGES[d.stage] || 'Searching for other coverage');

  $('discovery').innerHTML = `
    <div class="disc-head"><h2>Coverage</h2><div class="disc-how">${how}</div></div>
    <div class="disc-grid">
      <div><div class="eyebrow">Your video</div>${input}</div>
      <div><div class="eyebrow">Other outlets on the same event</div><div class="cands">${cands}</div></div>
    </div>`;
}

async function render(run) {
  const sources = run.sources || (await getLens(run.iterations[0]?.lens || '').catch(() => ({})))?.sources || [];
  $('event').textContent = run.event;
  $('error').hidden = run.status !== 'error';
  if (run.status === 'error') $('error').innerHTML = `<b>Run stopped</b>${esc(run.error || 'Unknown error')}`;
  renderDiscovery(run);
  $('meta').textContent = `Run ${run.id.replace('T', ' · ')} · model ${run.model}`;
  $('versus').innerHTML = sources
    .map((s, k) => `<span class="src" style="--c:var(--lens-${k % 3})">${esc(s.label)}</span>`)
    .join('<span class="vs">vs</span>');
  statusPill(run);
  renderStepper(run);
  renderProgress(run);

  const lens = run.final || run.iterations.at(-1)?.lens;
  $('open').href = lens ? `/player/?lens=/${lens}` : '#';
  $('open').setAttribute('aria-disabled', String(!lens));

  // Only replace cards whose content changed, so playing videos aren't reset.
  const html = await Promise.all(run.iterations.map((it, i) => iterCard(run, it, i)));
  const container = $('iters');
  html.forEach((h, i) => {
    const key = `${run.id}:${i}`;
    if (cardHtml.get(key) === h && container.children[i]) return;
    cardHtml.set(key, h);
    const tpl = document.createElement('template');
    tpl.innerHTML = h.trim();
    if (container.children[i]) container.children[i].replaceWith(tpl.content.firstChild);
    else container.append(tpl.content.firstChild);
  });
  while (container.children.length > html.length) container.lastChild.remove();
}

async function refresh() {
  const runs = await (await fetch('/api/runs')).json();
  const json = JSON.stringify(runs);
  if (json === lastJson) return;
  lastJson = json;
  $('empty').hidden = runs.length > 0;
  if (!selected && runs[0]) selected = runs[0].id;
  $('runs').innerHTML = runs
    .map((r) => `<option value="${r.id}" ${r.id === selected ? 'selected' : ''}>${esc(r.event)} · ${r.id.slice(5, 16).replace('T', ' ')}</option>`)
    .join('');
  const run = runs.find((r) => r.id === selected);
  if (run) await render(run);
}

$('runs').onchange = (e) => {
  selected = e.target.value;
  history.replaceState(null, '', `?run=${selected}`);
  lastJson = '';
  lastDiscovery = '';
  $('iters').innerHTML = '';
  refresh();
};
refresh();
setInterval(refresh, 1500);
