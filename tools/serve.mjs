// Build the self-contained page and serve it on localhost (WebGPU needs a secure context).
// Usage: npm run preview   -> open the printed URL in Chrome / Edge / Safari
import http from 'node:http';
import fs from 'node:fs';
import { build } from './build.mjs';

const { out } = build();
const port = +(process.env.PORT || 5173);
http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync(out)); })
  .listen(port, '127.0.0.1', () => console.log(`Live Motion Labs promo: http://localhost:${port}/  (Ctrl+C to stop)`));
