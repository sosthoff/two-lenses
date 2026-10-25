// Cloudflare static assets ignore Range requests, so <video> can't seek and Safari won't play.
// This runs in front of the video folders only (run_worker_first) and answers ranges with 206s.
export default {
  async fetch(request, env) {
    const res = await env.ASSETS.fetch(request);
    if (res.status !== 200) return res;

    const headers = new Headers(res.headers);
    headers.set('accept-ranges', 'bytes');
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
    if (!range) return new Response(res.body, { status: 200, headers });

    const buf = await res.arrayBuffer();
    const size = buf.byteLength;
    let start, end;
    if (range[1] === '') {
      start = Math.max(0, size - Number(range[2])); // suffix range: last N bytes
      end = size - 1;
    } else {
      start = Number(range[1]);
      end = range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    headers.set('content-range', `bytes ${start}-${end}/${size}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(new Uint8Array(buf, start, end - start + 1), { status: 206, headers });
  },
};
