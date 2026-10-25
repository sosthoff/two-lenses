const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

const [lib, runs] = await Promise.all([fetch('/api/library').then((r) => r.json()), fetch('/api/runs').then((r) => r.json())]);

// Curated clips first: they run end to end offline.
const clips = lib.flatMap((set) => set.clips).sort((a, b) => b.curated - a.curated);
$('samples').innerHTML = clips
  .slice(0, 4)
  .map((c) => `
    <button type="button" class="sample" data-url="${esc(c.url)}">
      <div class="thumb"><img src="${esc(c.thumbnail)}" alt="" loading="lazy">${c.curated ? '<span class="ready">Full demo</span>' : ''}<span class="dur">${fmt(c.duration)}</span></div>
      <div class="ch">${esc(c.channel)}</div>
      <div class="t">${esc(c.title)}</div>
    </button>`)
  .join('');

const select = (url) => {
  $('url').value = url;
  document.querySelectorAll('.sample').forEach((b) => b.classList.toggle('active', b.dataset.url === url));
};
document.querySelectorAll('.sample').forEach((b) => (b.onclick = () => { select(b.dataset.url); $('url').focus(); }));
$('url').oninput = () => select($('url').value.trim());
if (clips[0]) select(clips[0].url);

if (runs.length) {
  $('recentWrap').hidden = false;
  $('recent').innerHTML = runs
    .slice(0, 5)
    .map((r) => `
      <a href="/viewer/?run=${r.id}">
        <span class="ev">${esc(r.event || r.input)}</span>
        <span class="st ${r.status === 'passed' ? 'passed' : r.status === 'error' ? 'error' : ''}">${esc(r.status)}</span>
        <span class="when">${r.id.slice(5, 16).replace('T', ' ').replace(/-(\d\d)$/, ':$1')}</span>
      </a>`)
    .join('');
}

$('form').onsubmit = async (e) => {
  e.preventDefault();
  $('err').textContent = '';
  $('go').disabled = true;
  $('go').firstChild.textContent = 'Starting… ';
  try {
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: $('url').value.trim(), quick: $('quick').checked }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    location.href = `/viewer/?run=${body.id}`;
  } catch (err) {
    $('err').textContent = err.message;
    $('go').disabled = false;
    $('go').firstChild.textContent = 'Find other coverage ';
  }
};
