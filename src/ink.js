// "Luminous ink": hand-drawn strokes made of light.
// Paths are authored in design space (1920x1080); the camera maps them to pixels.
(function () {
  const LML = (window.LML = window.LML || {});

  // ---------------------------------------------------------------- random + noise
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(n) {
    n = (n << 13) ^ n;
    return 1.0 - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0;
  }
  // smooth 1D value noise in [-1, 1]
  function noise1(x, seed = 0) {
    const i = Math.floor(x), f = x - i;
    const u = f * f * (3 - 2 * f);
    return hash(i + seed * 1013) * (1 - u) + hash(i + 1 + seed * 1013) * u;
  }
  function noise2(x, y, seed = 0) {
    const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const h = (a, b) => hash(a * 57 + b * 131 + seed * 7919);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
  }
  function fbm1(x, seed = 0) {
    return noise1(x, seed) * 0.6 + noise1(x * 2.1 + 7.3, seed + 1) * 0.28 + noise1(x * 4.3 + 1.1, seed + 2) * 0.12;
  }

  // ---------------------------------------------------------------- easing
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
  const ease = {
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
    out: (t) => 1 - Math.pow(1 - t, 3),
    outQuint: (t) => 1 - Math.pow(1 - t, 5),
    in: (t) => t * t * t,
    inOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
    outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
    inOutExpo: (t) => t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
    // critically damped-ish spring with slight overshoot
    spring: (t) => 1 - Math.exp(-7 * t) * Math.cos(9 * t) * (1 - t * 0.2),
  };

  // ---------------------------------------------------------------- colour
  function hex(h, k = 1) {
    const n = parseInt(h.slice(1), 16);
    const s = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      v /= 255;
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return [s[0] * k, s[1] * k, s[2] * k];
  }
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

  // ---------------------------------------------------------------- paths
  function cubic(p0, p1, p2, p3, n, out) {
    for (let i = out.length ? 1 : 0; i <= n; i++) {
      const t = i / n, mt = 1 - t;
      out.push([
        mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
        mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    return out;
  }
  // Catmull-Rom through points -> dense polyline
  function spline(pts, perSeg = 16, closed = false) {
    const out = [];
    const P = (i) => closed ? pts[(i + pts.length) % pts.length] : pts[clamp(i, 0, pts.length - 1)];
    const segs = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      for (let k = i === 0 ? 0 : 1; k <= perSeg; k++) {
        const t = k / perSeg, t2 = t * t, t3 = t2 * t;
        out.push([
          0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
          0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
        ]);
      }
    }
    return out;
  }
  // SVG-like path string with M/L/C/Q/Z (absolute) -> list of polylines
  function parsePath(d, step = 6) {
    const toks = d.match(/[MLCQZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);
    const lines = [];
    let cur = null, cx = 0, cy = 0, sx = 0, sy = 0, i = 0, cmd = '';
    const num = () => parseFloat(toks[i++]);
    while (i < toks.length) {
      if (/[MLCQZ]/i.test(toks[i])) cmd = toks[i++].toUpperCase();
      if (cmd === 'M') { cx = num(); cy = num(); sx = cx; sy = cy; cur = [[cx, cy]]; lines.push(cur); cmd = 'L'; }
      else if (cmd === 'L') { cx = num(); cy = num(); cur.push([cx, cy]); }
      else if (cmd === 'C') {
        const p1 = [num(), num()], p2 = [num(), num()], p3 = [num(), num()];
        const n = Math.max(4, Math.ceil(Math.hypot(p3[0] - cx, p3[1] - cy) / step));
        cubic([cx, cy], p1, p2, p3, n, cur);
        [cx, cy] = p3;
      } else if (cmd === 'Q') {
        const q = [num(), num()], p3 = [num(), num()];
        const p1 = [cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy)];
        const p2 = [p3[0] + (2 / 3) * (q[0] - p3[0]), p3[1] + (2 / 3) * (q[1] - p3[1])];
        const n = Math.max(4, Math.ceil(Math.hypot(p3[0] - cx, p3[1] - cy) / step));
        cubic([cx, cy], p1, p2, p3, n, cur);
        [cx, cy] = p3;
      } else if (cmd === 'Z') { cur.push([sx, sy]); cx = sx; cy = sy; }
      else i++;
    }
    return lines;
  }
  // resample a polyline evenly by arc length
  function resample(pts, spacing = 4) {
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = L[L.length - 1];
    const n = Math.max(2, Math.ceil(total / spacing) + 1);
    const out = new Float32Array(n * 2);
    let j = 0;
    for (let k = 0; k < n; k++) {
      const s = (k / (n - 1)) * total;
      while (j < pts.length - 2 && L[j + 1] < s) j++;
      const seg = L[j + 1] - L[j] || 1;
      const u = clamp((s - L[j]) / seg);
      out[k * 2] = lerp(pts[j][0], pts[j + 1][0], u);
      out[k * 2 + 1] = lerp(pts[j][1], pts[j + 1][1], u);
    }
    return { p: out, n, len: total };
  }
  function transformPts(pts, m) {
    return pts.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  }

  // ---------------------------------------------------------------- camera
  // camera params {x, y, zoom, rot} describe what the viewer looks at (design space)
  function camMatrix(c, S, depth = 1) {
    const z = Math.pow(c.zoom, depth), r = c.rot * depth;
    const cs = Math.cos(r) * z * S, sn = Math.sin(r) * z * S;
    const cx = 960 + (c.x - 960) * depth, cy = 540 + (c.y - 540) * depth;
    // p' = R*Z*(p - c) + screenCentre
    return [cs, sn, -sn, cs, 960 * S - (cs * cx - sn * cy), 540 * S - (sn * cx + cs * cy)];
  }
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function invert(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
    return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
  }
  function multiply(m, n) { // m * n
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }

  // ---------------------------------------------------------------- stroke drawing
  // Draws a resampled design-space path as an inked light stroke.
  // o: { m (matrix), reveal 0..1, from 0..1 (erase from the start), w (core half-width, design px),
  //      col (linear rgb), gain, seed, t (time for boil), boil (px), taper, tip (spark strength),
  //      style, colAt(u) optional, widthAt(u) optional, wobbleFreq }
  const tmpPts = new Float32Array(1 << 16);
  const tmpW = new Float32Array(1 << 15);
  const tmpC = new Float32Array(3 << 15);
  const STYLE = { glow: 4.5, soft: 5.5, halo: 0.55, white: 0.55 };

  function stroke(R, path, o) {
    const reveal = clamp(o.reveal ?? 1), from = clamp(o.from ?? 0);
    if (reveal <= from + 1e-4) return null;
    const n = path.n;
    const m = o.m, S = Math.hypot(m[0], m[1]);
    const t = o.t || 0;
    const boilStep = Math.floor(t * 12); // lines "boil" at 12 drawings per second, like hand-inked animation
    const seed = o.seed || 0;
    const boil = o.boil ?? 1.1;
    const wf = o.wobbleFreq ?? 0.018;
    const i0 = Math.floor(from * (n - 1)), i1 = Math.min(n - 1, Math.ceil(reveal * (n - 1)));
    const w0 = o.w ?? 2.2, gain = o.gain ?? 1;
    const taper = o.taper ?? 0.12;
    let k = 0;
    const L = path.len;
    let tipX = 0, tipY = 0;
    for (let i = i0; i <= i1; i++) {
      const u = i / (n - 1);
      let x = path.p[i * 2], y = path.p[i * 2 + 1];
      if (i === i1 && reveal < 1) {
        const f = reveal * (n - 1) - (i - 1);
        x = lerp(path.p[(i - 1) * 2], x, f);
        y = lerp(path.p[(i - 1) * 2 + 1], y, f);
      }
      const s = u * L;
      // hand wobble: slow drift + boiling jitter
      const dx = noise1(s * wf, seed) * 1.6 + noise1(s * 0.05 + boilStep * 3.7, seed + 11) * boil;
      const dy = noise1(s * wf + 31.7, seed) * 1.6 + noise1(s * 0.05 + boilStep * 5.3 + 17, seed + 23) * boil;
      x += dx; y += dy;
      const px = m[0] * x + m[2] * y + m[4], py = m[1] * x + m[3] * y + m[5];
      tmpPts[k * 2] = px; tmpPts[k * 2 + 1] = py;
      // brush taper at both ends and toward the live pen tip, uneven pressure along the line
      const head = smooth(0, taper, u - 0) * 0.85 + 0.15;
      const tail = smooth(0, taper * 1.4, 1 - u);
      const tipTaper = reveal < 1 ? smooth(0, 0.035, reveal - u) * 0.7 + 0.3 : 1;
      const fromTaper = from > 0 ? smooth(0, 0.04, u - from) : 1;
      const pressure = 0.78 + 0.42 * (0.5 + 0.5 * fbm1(s * 0.012 + 3, seed + 5));
      const ww = (o.widthAt ? o.widthAt(u) : 1) * w0 * head * tail * tipTaper * fromTaper * pressure * S;
      tmpW[k] = ww;
      const c = o.colAt ? o.colAt(u) : o.col;
      // hot zone just behind the pen tip: fresh light is brighter
      const hot = reveal < 1 ? 1 + 2.2 * Math.exp(-Math.max(0, reveal - u) * L / 40) : 1;
      tmpC[k * 3] = c[0] * gain * hot; tmpC[k * 3 + 1] = c[1] * gain * hot; tmpC[k * 3 + 2] = c[2] * gain * hot;
      tipX = px; tipY = py;
      k++;
    }
    R.strip(tmpPts.subarray(0, k * 2), tmpW, tmpC, o.style || STYLE);
    if (reveal < 1 && (o.tip ?? 1) > 0) {
      const c = o.col || [1, 1, 1];
      const tg = (o.tip ?? 1) * gain;
      R.dot(tipX, tipY, 2.4 * S, c[0] * 6 * tg + 2 * tg, c[1] * 6 * tg + 2 * tg, c[2] * 6 * tg + 2 * tg, { glow: 7, soft: 7, halo: 0.9, white: 0.8 });
    }
    return [tipX, tipY];
  }

  // a light dot in design space
  function spark(R, m, x, y, r, col, gain = 1, style) {
    const S = Math.hypot(m[0], m[1]);
    const [px, py] = apply(m, x, y);
    R.dot(px, py, r * S, col[0] * gain, col[1] * gain, col[2] * gain, style || { glow: 5, soft: 6, halo: 0.7, white: 0.6 });
  }

  // a soft line (no ink texture) — used for UI-like hairlines, frames and ribbons
  function line(R, pts, m, w, colFn, style, gainFn) {
    const n = pts.length >> 1;
    const S = Math.hypot(m[0], m[1]);
    for (let i = 0; i < n; i++) {
      const x = pts[i * 2], y = pts[i * 2 + 1];
      tmpPts[i * 2] = m[0] * x + m[2] * y + m[4];
      tmpPts[i * 2 + 1] = m[1] * x + m[3] * y + m[5];
      const u = n > 1 ? i / (n - 1) : 0;
      tmpW[i] = (typeof w === 'function' ? w(u, i) : w) * S;
      const c = typeof colFn === 'function' ? colFn(u, i) : colFn;
      const g = gainFn ? gainFn(u, i) : 1;
      tmpC[i * 3] = c[0] * g; tmpC[i * 3 + 1] = c[1] * g; tmpC[i * 3 + 2] = c[2] * g;
    }
    R.strip(tmpPts.subarray(0, n * 2), tmpW, tmpC, style || STYLE);
  }

  LML.Ink = {
    mulberry32, noise1, noise2, fbm1, clamp, lerp, smooth, ease, hex, mix3, mul3,
    cubic, spline, parsePath, resample, transformPts, camMatrix, apply, invert, multiply,
    stroke, spark, line, STYLE,
  };
})();
