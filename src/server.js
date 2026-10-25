// Static file server over the project root, with Range support (needed for <video> seeking)
// and /api/runs for the runs viewer.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT } from './paths.js';
import { library } from './discover.js';

export { ROOT };
const OUT = path.join(ROOT, 'out');

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data ? JSON.parse(data) : {}));
  });

// Start a loop run in the background; the viewer follows it through run.json.
function startRun({ url, quick }) {
  const id = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ id, input: url, event: url, model: '…', status: 'starting', iterations: [] }));
  const logFd = fs.openSync(path.join(dir, 'loop.log'), 'a');
  const args = ['src/loop.js', '--url', url, '--run-id', id, ...(quick ? ['--maxSeg', '6'] : [])];
  spawn(process.execPath, args, { cwd: ROOT, env: process.env, stdio: ['ignore', logFd, logFd], detached: true }).unref();
  return id;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt',
};

function listRuns() {
  if (!fs.existsSync(OUT)) return [];
  return fs
    .readdirSync(OUT)
    .filter((d) => fs.existsSync(path.join(OUT, d, 'run.json')))
    .sort()
    .reverse()
    .map((d) => JSON.parse(fs.readFileSync(path.join(OUT, d, 'run.json'), 'utf8')));
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/runs' && req.method === 'POST') {
    const body = await readBody(req).catch(() => ({}));
    if (!body.url?.trim()) return json(res, 400, { error: 'Paste a video link' });
    return json(res, 200, { id: startRun({ url: body.url.trim(), quick: body.quick }) });
  }
  if (url.pathname === '/api/runs') return json(res, 200, listRuns());
  if (url.pathname === '/api/library') return json(res, 200, library());
  if (url.pathname === '/') {
    res.writeHead(302, { location: '/launch/' });
    return res.end();
  }

  let file = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end('not found');

  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    res.writeHead(206, {
      'content-type': type,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
      'content-length': end - start + 1,
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

export function startServer(port = 0) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ server, url });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { url } = await startServer(Number(process.env.PORT) || 4317);
  console.log(`Two Lenses at ${url}  (runs viewer: ${url}/viewer/)`);
  console.log(`Model: ${process.env.GEMINI_API_KEY ? process.env.GEMINI_MODEL || 'gemini-4-argon' : 'stub (no GEMINI_API_KEY in .env)'}`);
}
