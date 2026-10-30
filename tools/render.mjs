// Render the film to MP4 on this machine's GPU: headless Chrome draws each frame with WebGPU,
// frames stream to ffmpeg, the Web Audio mix is muxed in.
//
// Usage:
//   npm run render                     # 3840x2160, 60 fps -> out/live-motion-labs-promo-4k.mp4 (GPU encoder when available)
//   npm run render -- --width 1920 --height 1080 --out out/promo-1080p.mp4
//   npm run render -- --from 20 --to 26           # just a section (seconds)
// Options: --fps 60  --crf 16  --preset medium  --encoder auto|x264|nvenc|videotoolbox|qsv|amf  --ffmpeg <path>
//          --browser chrome|msedge|chromium  --headed  --software (allow software WebGPU)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const flag = (k) => argv.includes('--' + k);

const W = +opt('width', 3840), H = +opt('height', 2160), FPS = +opt('fps', 60);
const OUT = path.resolve(ROOT, opt('out', W >= 3840 ? 'out/live-motion-labs-promo-4k.mp4' : `out/live-motion-labs-promo-${H}p.mp4`));
const CRF = opt('crf', W >= 3840 ? '16' : '17');
const PRESET = opt('preset', 'medium');
let ENC = opt('encoder', 'auto'); // auto: GPU hardware encoder when available, else x264

// Find a working ffmpeg: --ffmpeg <path>, then the ffmpeg-static package (downloading its binary if npm skipped
// that step), then ffmpeg on PATH. Fails early with clear instructions, before any rendering starts.
async function ffmpegPath() {
  const works = (p) => { try { return spawnSync(p, ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } };
  if (opt('ffmpeg')) return opt('ffmpeg');
  let bundled = null;
  try { bundled = (await import('ffmpeg-static')).default; } catch { /* package not installed */ }
  if (bundled && !fs.existsSync(bundled)) {
    const installer = path.join(ROOT, 'node_modules', 'ffmpeg-static', 'install.js');
    if (fs.existsSync(installer)) {
      console.log('Downloading the ffmpeg binary (npm skipped this step during install)...');
      spawnSync(process.execPath, [installer], { cwd: path.dirname(installer), stdio: 'inherit' });
    }
  }
  if (bundled && fs.existsSync(bundled) && works(bundled)) return bundled;
  if (works('ffmpeg')) return 'ffmpeg';
  throw new Error('ffmpeg was not found.\n' +
    '  Fix: run  npm rebuild ffmpeg-static  (downloads the bundled ffmpeg), or install ffmpeg\n' +
    '  (Windows: winget install Gyan.FFmpeg, macOS: brew install ffmpeg), or pass --ffmpeg <path to ffmpeg>.');
}
async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* try CommonJS global */ }
  const { createRequire } = await import('node:module');
  return createRequire(import.meta.url)('playwright');
}

function videoArgs() {
  const color = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
  switch (ENC) {
    case 'nvenc': return ['-c:v', 'h264_nvenc', '-preset', 'p7', '-tune', 'hq', '-rc', 'vbr', '-cq', '17', '-b:v', '0', '-profile:v', 'high', ...color];
    case 'videotoolbox': return ['-c:v', 'h264_videotoolbox', '-b:v', W >= 3840 ? '60M' : '20M', '-profile:v', 'high', ...color];
    case 'qsv': return ['-c:v', 'h264_qsv', '-global_quality', '18', ...color];
    case 'amf': return ['-c:v', 'h264_amf', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '17', '-qp_p', '19', ...color];
    default: return ['-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-tune', 'film', '-profile:v', 'high', '-level:v', W >= 3840 ? '5.2' : '4.2', ...color];
  }
}

async function main() {
  const t0 = Date.now();
  const ff = await ffmpegPath();
  console.log(`ffmpeg: ${ff}`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const { out: page } = build(path.join(ROOT, 'out', 'render-page.html'));
  const html = fs.readFileSync(page);
  const tmpAudio = path.join(ROOT, 'out', 'mix.wav');

  // local server: serves the page, receives audio and frames
  let onFrame = null, onAudio = null;
  const server = http.createServer((req, res) => {
    if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      res.setHeader('access-control-allow-origin', '*');
      try {
        if (req.url.startsWith('/audio')) await onAudio(body);
        else if (req.url.startsWith('/frame')) { const q = new URL(req.url, 'http://x').searchParams; await onFrame(body, +q.get('i'), +q.get('draw'), +q.get('wait')); }
        res.writeHead(200); res.end('ok');
      } catch (e) { console.error(e); res.writeHead(500); res.end(String(e)); }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const { chromium } = await loadPlaywright();
  const browserArgs = ['--enable-unsafe-webgpu', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan,WebGPU', '--disable-gpu-sandbox', '--autoplay-policy=no-user-gesture-required',
    // never throttle the render page (headless pages can be treated as hidden and woken only once per second)
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion', '--disable-frame-rate-limit'];
  const channel = opt('browser', process.platform === 'linux' ? undefined : 'chrome');
  const launch = { headless: !flag('headed'), args: browserArgs };
  if (channel && channel !== 'chromium') launch.channel = channel;
  let browser;
  try { browser = await chromium.launch(launch); } catch (e) {
    console.warn(`Could not launch ${channel}; falling back to Playwright Chromium (${e.message.split('\n')[0]})`);
    delete launch.channel;
    browser = await chromium.launch(launch);
  }
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const pg = await ctx.newPage();
  pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
  pg.on('pageerror', (e) => console.error('[page error]', e.message));
  await pg.goto(`${base}/?render=1&ring=${opt('ring', 6)}&w=${W}&h=${H}&fps=${FPS}${opt('shutter') ? '&shutter=' + opt('shutter') : ''}&server=${encodeURIComponent(base)}`);
  await pg.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  const info = await pg.evaluate(() => window.__info);
  const soft = /swiftshader|llvmpipe|software/i.test(JSON.stringify(info.adapter));
  console.log(`WebGPU adapter: ${info.adapter.vendor} ${info.adapter.architecture} ${info.adapter.description}`.trim());
  if (ENC === 'auto') {
    // encoding 4K on the CPU is the slow part; use the GPU's video encoder when ffmpeg has it
    const encoders = spawnSync(ff, ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout || '';
    const vendor = `${info.adapter.vendor} ${info.adapter.description}`.toLowerCase();
    if (/nvidia/.test(vendor) && encoders.includes('h264_nvenc')) ENC = 'nvenc';
    else if (process.platform === 'darwin' && encoders.includes('h264_videotoolbox')) ENC = 'videotoolbox';
    else if (/intel/.test(vendor) && encoders.includes('h264_qsv')) ENC = 'qsv';
    else if (/amd|ati/.test(vendor) && encoders.includes('h264_amf')) ENC = 'amf';
    else ENC = 'x264';
  }
  console.log(`Encoder: ${ENC}${ENC === 'x264' ? ` (CPU, preset ${PRESET}; add --encoder nvenc|videotoolbox|qsv|amf to use the GPU)` : ' (GPU hardware encoder)'}`);
  if (soft && !flag('software')) {
    console.warn('\nWARNING: Chrome is using SOFTWARE WebGPU (no GPU). Rendering will be very slow.\n' +
      '  Try: --headed, or --browser chrome / --browser msedge, and make sure hardware acceleration is on.\n' +
      '  Add --software to continue anyway.\n');
    await browser.close(); server.close(); process.exit(2);
  }

  const duration = info.duration;
  const from = Math.max(0, Math.round(+opt('from', 0) * FPS));
  const to = Math.min(Math.round(duration * FPS), Math.round(+opt('to', duration) * FPS));
  console.log(`Rendering ${W}x${H} @ ${FPS} fps, frames ${from}-${to - 1} of ${Math.round(duration * FPS)} -> ${path.relative(ROOT, OUT)}`);

  // 1) audio mix (rendered offline in the page, sample-exact)
  await new Promise((resolve, reject) => {
    onAudio = async (body) => { fs.writeFileSync(tmpAudio, body); resolve(); };
    pg.evaluate(() => window.__renderAudio()).catch(reject);
  });

  // 2) video frames -> ffmpeg
  const ffArgs = [
    '-y', '-hide_banner', '-loglevel', 'error', '-nostats',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-framerate', String(FPS), '-i', 'pipe:0',
    '-ss', String(from / FPS), '-t', String((to - from) / FPS), '-i', tmpAudio,
    '-map', '0:v', '-map', '1:a',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    ...videoArgs(), '-g', String(FPS * 2), '-bf', '2',
    '-c:a', 'aac', '-b:a', '320k', '-ar', '48000',
    '-movflags', '+faststart', '-shortest', OUT,
  ];
  const proc = spawn(ff, ffArgs, { stdio: ['pipe', 'inherit', 'inherit'] });
  const ffDone = new Promise((r, j) => {
    proc.on('error', (e) => j(new Error(`could not start ffmpeg (${e.message})`)));
    proc.on('close', (c) => (c === 0 ? r() : j(new Error('ffmpeg exited with ' + c))));
  });
  ffDone.catch(() => {});
  let n = 0, next = from;
  const tStart = Date.now();
  // timing per frame: draw = page builds + GPU renders + reads back; send = page waits for the previous upload;
  // encode = waiting for ffmpeg to accept the frame. The biggest number is the bottleneck.
  let sumDraw = 0, sumSend = 0, sumEnc = 0;
  onFrame = async (body, i, draw, wait) => {
    if (i !== next) throw new Error(`frame order ${i} != ${next}`);
    next++;
    const w0 = Date.now();
    if (!proc.stdin.write(body)) await new Promise((r) => proc.stdin.once('drain', r));
    sumEnc += Date.now() - w0; sumDraw += draw || 0; sumSend += wait || 0;
    n++;
    if (n % 30 === 0 || i === to - 1) {
      const el = (Date.now() - tStart) / 1000, rate = n / el, left = (to - from - n) / rate;
      console.log(`  frame ${i + 1}/${to}  ${rate.toFixed(2)} fps  eta ${Math.ceil(left / 60)} min  |  per frame: draw ${(draw || 0).toFixed(0)} ms, gpu wait ${(wait || 0).toFixed(0)} ms, encode ${(sumEnc / n).toFixed(0)} ms`);
    }
  };
  await pg.evaluate(([a, b]) => window.__renderFrames(a, b), [from, to]);
  proc.stdin.end();
  await ffDone;
  await browser.close();
  server.close();
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
