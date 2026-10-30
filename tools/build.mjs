// Build one self-contained HTML file: all scripts, fonts, music, voice and data inlined.
// Usage: node tools/build.mjs [--out dist/live-motion-labs-promo.html]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = path.resolve(ROOT, outArg >= 0 ? args[outArg + 1] : 'dist/live-motion-labs-promo.html');

export function build(out = OUT) {
  const src = path.join(ROOT, 'src');
  let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);

  const assets = {};
  const add = (rel) => { assets[rel] = fs.readFileSync(path.join(ROOT, 'assets', rel)).toString('base64'); };
  for (const f of fs.readdirSync(path.join(ROOT, 'assets/fonts'))) if (f.endsWith('.ttf')) add('fonts/' + f);
  add('music/analysis.json');
  add('music/edit.flac');
  add('brand/logo-mark.json');
  add('vo/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/vo/manifest.json'), 'utf8'));
  for (const id of Object.keys(manifest)) add(`vo/${id}.wav`);

  const inline = [
    `<script>window.LML_ASSETS=${JSON.stringify(assets)};</script>`,
    ...scripts.map((s) => `<script>/* ${s} */\n${fs.readFileSync(path.join(src, s), 'utf8').replace(/<\/script/g, '<\\/script')}\n</script>`),
  ].join('\n');
  html = html.replace(/<!--SCRIPTS-->[\s\S]*<!--\/SCRIPTS-->/, () => inline);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  return { out, bytes: Buffer.byteLength(html) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = build();
  console.log(`Built ${path.relative(ROOT, r.out)} (${(r.bytes / 1e6).toFixed(1)} MB)`);
}
