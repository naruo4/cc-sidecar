// Real Chromium DOMParser/UI/download checks with fixture caption responses.
// Run: node tests/run-browser-diagnostics.mjs (optionally set CHROME_BIN).
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'sidecar-diagnostic-chrome-'));
const chrome = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium');
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    let content;
    let extension = extname(pathname);
    if (pathname === '/browser-check.html') {
      content = (await readFile(join(root, 'sidepanel.html'), 'utf8')).replace(
        '<script type="module" src="src/app.js"></script>',
        '<pre id="browserCheck">RUNNING</pre><script type="module" src="tests/browser-diagnostics.js"></script>');
    } else {
      const file = resolve(root, '.' + pathname);
      if (!file.startsWith(root)) throw new Error('outside-root');
      content = await readFile(file);
    }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extension] || 'text/plain');
    res.end(content);
  } catch { res.writeHead(404); res.end(); }
});
try {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const child = spawn(chrome, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--timeout=45000', '--virtual-time-budget=30000', '--dump-dom',
    `http://127.0.0.1:${server.address().port}/browser-check.html`]);
  let output = '', errors = '';
  child.stdout.on('data', b => output += b);
  child.stderr.on('data', b => errors += b);
  const code = await new Promise((r, reject) => { child.once('error', reject); child.once('close', r); });
  if (code !== 0 || !output.includes('data-test="PASS"')) throw new Error(output.match(/FAIL:[^<]*/)?.[0] || `Browser exit ${code}; output: ${output.slice(-2500)}; log: ${errors.slice(-1500)}`);
  console.log(output.match(/PASS: browser[^<]*/)?.[0]);
} finally {
  server.closeAllConnections();
  await new Promise(r => server.close(r));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
