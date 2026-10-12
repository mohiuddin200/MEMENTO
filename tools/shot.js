/*
 * Screenshot a page with headless Chrome — no npm dependencies (Node 22+,
 * built-in WebSocket over the DevTools protocol). Used to regenerate the
 * landing-page and store images from the real UI so they cannot drift.
 *
 * node tools/shot.js --url <url> --out <file.png|.webp> [--width 1280]
 *   [--height 800] [--scale 1] [--eval "<js run before the shot>"]
 *   [--clip "<js returning {x, y, width, height}>"] [--wait 600]
 * CHROME=/path/to/chrome overrides the browser binary.
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.url || !args.out) {
  console.error('usage: node tools/shot.js --url <url> --out <file> [--width --height --scale --eval --clip --wait]');
  process.exit(1);
}
const width = Number(args.width || 1280);
const height = Number(args.height || 800);
const scale = Number(args.scale || 1);
const wait = Number(args.wait || 600);
const chrome = process.env.CHROME || 'google-chrome';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'memento-shot-'));
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--allow-file-access-from-files', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) resolve(m[1]);
    });
    proc.on('exit', () => reject(new Error('chrome exited: ' + buf)));
  });
  const port = new URL(wsUrl).port;
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  const evaluate = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('page error: ' + r.exceptionDetails.text);
    return r.result.value;
  };

  try {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await send('Page.enable');
    await send('Page.navigate', { url: args.url });
    await sleep(wait);
    await evaluate('document.fonts ? document.fonts.ready.then(() => true) : true');
    if (args.eval) { await evaluate(args.eval); await sleep(wait); }

    const format = /\.webp$/.test(args.out) ? 'webp' : /\.jpe?g$/.test(args.out) ? 'jpeg' : 'png';
    const params = { format, captureBeyondViewport: true };
    if (format !== 'png') params.quality = 88;
    if (args.clip) params.clip = Object.assign({ scale: 1 }, await evaluate(args.clip));
    const shot = await send('Page.captureScreenshot', params);
    fs.writeFileSync(args.out, Buffer.from(shot.data, 'base64'));
    console.log('wrote ' + args.out);
  } finally {
    ws.close();
    proc.kill();
    await sleep(200);
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
