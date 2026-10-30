// The film: every scene, drawn procedurally in light. Timing comes from the score (real track + voice).
(function () {
  const LML = window.LML;
  const { Ink, Text } = LML;
  const { stroke, spark, line, clamp, lerp, smooth, ease, hex, mix3, mul3, resample, spline, camMatrix, apply, multiply, noise1, mulberry32 } = Ink;
  const TAU = Math.PI * 2;

  const C = {
    blue: hex('#8cb4ff'), blue2: hex('#5a88ff'), royal: hex('#2850ff'), cyan: hex('#5aebff'), ice: hex('#e1f0ff'),
    amber: hex('#ffc766'), magenta: hex('#ff5fd7'), coral: hex('#ff8f8f'), mint: hex('#a8f0d4'), violet: hex('#a98bff'), white: [1, 1, 1],
  };
  const CSS = { fg: '#eef2f8', fg2: '#aab4c6', fg3: '#7d879b', ice: '#e1f0ff', blue: '#8cb4ff', onBlue: '#0b1a33' };
  const UI = { glow: 3.2, soft: 4, halo: 0.45, white: 0.3 };       // hairline "UI" light
  const RIB = { glow: 6, soft: 6.5, halo: 0.55, white: 0.4 };      // ribbon strands
  const TUBE = { glow: 3.4, soft: 3.2, halo: 0.6, white: 0.62 };   // logo light-tube

  const hash = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const rgbCss = (c, a = 1) => `rgba(${c.map((v) => Math.round(255 * Math.pow(Math.min(1, v), 1 / 2.2))).join(',')},${a})`;

  // ---------------------------------------------------------------- shapes
  function arcPts(cx, cy, r, a0, a1, out, rx = r) {
    const n = Math.max(6, Math.ceil(Math.abs(a1 - a0) * r / 6));
    for (let i = 0; i <= n; i++) { const a = lerp(a0, a1, i / n); out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * r]); }
    return out;
  }
  function rrect(cx, cy, w, h, r) {
    const hw = w / 2, hh = h / 2;
    r = Math.min(r, hw, hh);
    const p = [[cx, cy - hh], [cx + hw - r, cy - hh]];
    arcPts(cx + hw - r, cy - hh + r, r, -Math.PI / 2, 0, p);
    p.push([cx + hw, cy + hh - r]);
    arcPts(cx + hw - r, cy + hh - r, r, 0, Math.PI / 2, p);
    p.push([cx - hw + r, cy + hh]);
    arcPts(cx - hw + r, cy + hh - r, r, Math.PI / 2, Math.PI, p);
    p.push([cx - hw, cy - hh + r]);
    arcPts(cx - hw + r, cy - hh + r, r, Math.PI, Math.PI * 1.5, p);
    p.push([cx, cy - hh]);
    return resample(p, 4);
  }
  function circle(cx, cy, r, a0 = -Math.PI / 2, turns = 1, rx = r) {
    return resample(arcPts(cx, cy, r, a0, a0 + TAU * turns, [], rx), 4);
  }

  // The musician's hand, seen from the back, index finger pointing down (tip at the origin). One continuous contour.
  const HAND = {
    contour: [[-150, -600], [-152, -500], [-150, -420], [-160, -372], [-184, -338], [-196, -294], [-186, -258], [-166, -244], [-140, -250], [-112, -270], [-74, -282],
      [-44, -262], [-34, -220], [-32, -150], [-32, -80], [-30, -30], [-20, -8], [0, 0], [20, -8], [30, -30], [32, -80], [32, -150], [33, -200],
      [44, -214], [66, -206], [88, -214], [102, -226], [120, -218], [140, -224], [154, -236], [170, -232], [184, -246], [192, -272], [194, -330], [188, -420], [182, -500], [178, -600]],
    thumb: [[-74, -282], [-112, -330], [-150, -372]],
    folds: [[[66, -206], [64, -250]], [[120, -218], [118, -256]], [[170, -232], [168, -264]]],
    nail: [[-19, -56], [-20, -24], [-12, -12], [0, -9], [12, -12], [20, -24], [19, -56]],
    creases: [[[-20, -120], [0, -124], [20, -120]], [[-22, -172], [0, -177], [22, -172]]],
    cuff: [[-178, -560], [0, -578], [196, -560]],
  };

  function buildPaths() {
    // longer, more elegant index finger: stretch below the knuckles, shift the rest of the hand up
    const fx = (pts) => pts.map(([x, y]) => [x, y >= -230 ? y * 1.3 : y - 69]);
    const sp = (pts, n = 10) => resample(spline(fx(pts), n), 3);
    return {
      contour: sp(HAND.contour, 12), thumb: sp(HAND.thumb), nail: sp(HAND.nail, 6), cuff: sp(HAND.cuff, 12),
      folds: HAND.folds.map((f) => sp(f, 6)), creases: HAND.creases.map((c) => sp(c, 6)),
    };
  }

  class Film {
    constructor(R, S, assets) {
      this.R = R;
      this.S = S;
      this.A = assets;
      const b = S.bar;
      this.b = b;
      this.drop = S.firstDrop;
      this.end = S.DURATION;
      this.hand = buildPaths();
      this.button = { c: [958, 650], r: 92 };
      this.buttonCircle = circle(958, 650, 92, -2.2);
      this.buttonTri = resample([[936, 614], [1002, 650], [936, 686], [936, 614]].map((p) => p), 3);
      // logo mark (brand), centred and scaled
      const L = assets.logo;
      const ls = 3.5;
      this.logo = L.strokes.map((pts) => resample(pts.map(([x, y]) => [960 + (x - 32) * ls, 352 + (y - 32) * ls]), 3));
      this.logoW = L.strokeWidth * ls * 0.5;
      this.cuts = [b(10), b(11), b(12), b(18)];
      this._buildText();
    }

    // ---------------------------------------------------------------- type layouts
    _buildText() {
      const S = this.S;
      // lyric
      const lw = S.vo.lyric ? S.vo.lyric.words : [];
      const lines = [['WATCH', 'MY', 'WORDS'], ['BECOME', 'THE', 'LIGHT']];
      const size = 150, sp = size * 0.24;
      this.lyric = [];
      let wi = 0;
      lines.forEach((ln, li) => {
        const lays = ln.map((w) => Text.layout('anton', w, size, 0.01));
        const total = lays.reduce((a, l) => a + l.width, 0) + sp * (ln.length - 1);
        let x = 960 - total / 2;
        const y = li === 0 ? 470 : 640;
        lays.forEach((L) => {
          const timing = lw[wi] || null;
          this.lyric.push({ L, x, y, outlines: Text.outlines(L, x, y, 0, 3), timing, idx: wi });
          x += L.width + sp;
          wi++;
        });
      });
      // fallback timing if Whisper split differently
      if (S.vo.lyric && lw.length !== 6) {
        const v = S.vo.lyric;
        this.lyric.forEach((w, i) => { w.timing = { s: v.start + (i / 6) * v.dur, e: v.start + ((i + 1) / 6) * v.dur }; });
      }
      this.lyricX0 = Math.min(...this.lyric.map((w) => w.x));
      this.lyricX1 = Math.max(...this.lyric.map((w) => w.x + w.L.width));

      // finale statement
      const f = [['LYRIC VIDEOS', 'lyric'], ['DRAWN IN LIGHT', 'drawn'], ['AND COLOR.', 'color']];
      this.statement = f.map(([str, key], i) => {
        const L = Text.layout('anton', str, 124, 0.015);
        const y = 420 + i * 148;
        const w = S.word('vo12', key);
        return { L, y, outlines: Text.outlines(L, 960, y, 0.5, 3), key, t: w ? w.s : S.bar(18) + 0.4 + i * 0.7 };
      });

      // end card
      this.wm1 = Text.layout('mont700', 'LIVE MOTION', 72, 0.09);
      this.wm2 = Text.layout('mont400', 'LABS', 32, 0.5);
      this.wm1o = Text.outlines(this.wm1, 960, 572, 0.5, 2.5);
      this.k4 = Text.layout('anton', '4K', 230, 0);
      this.fps = Text.layout('anton', '60 FPS', 92, 0.02);
    }

    // ---------------------------------------------------------------- camera
    camera(t) {
      const b = this.b, d = this.drop;
      const drift = (amt = 1) => ({
        x: 960 + 16 * amt * Math.sin(t * 0.21 + 1.3),
        y: 540 + 9 * amt * Math.sin(t * 0.17 + 0.4),
        rot: 0.006 * amt * Math.sin(t * 0.11 + 2.0),
      });
      const hit = (t0, k, dec = 0.35) => (t >= t0 ? k * Math.exp(-(t - t0) / dec) * Math.min(1, (t - t0) / 0.02) : 0);
      if (t < d) {
        const u = ease.inOutSine(clamp(t / d));
        return { x: lerp(1030, 990, u), y: lerp(360, 452, u), zoom: lerp(1.18, 1.3, u) + hit(d - 0.12, -0.012, 0.1), rot: lerp(-0.03, -0.008, u) };
      }
      if (t < b(7)) {
        const u = ease.outQuint(clamp((t - d) / 2.0));
        const dr = drift(u);
        return { x: lerp(990, dr.x, u), y: lerp(452, dr.y, u), zoom: lerp(1.3, 1.0, u) + 0.004 * (t - d) * u + hit(d, 0.05, 0.25), rot: lerp(-0.008, dr.rot, u) };
      }
      if (t < b(10)) {
        const u = ease.inOutSine(clamp((t - b(7)) / (b(9) - b(7))));
        const dr = drift(0.6);
        return { x: dr.x, y: lerp(540, 525, u), zoom: lerp(1.05, 1.13, u) + 0.008 * Math.max(0, t - b(9)) + hit(b(9), 0.045, 0.3), rot: dr.rot * 0.5 };
      }
      if (t < b(13)) {
        // three seeds: each one moves differently; hard cuts on the downbeats
        const v = t < b(11) ? 0 : t < b(12) ? 1 : 2;
        const t0 = [b(10), b(11), b(12)][v], u = (t - t0) / (b(11) - b(10));
        if (v === 0) return { x: 960, y: 540, zoom: 1.0 + 0.06 * u + hit(t0, 0.03, 0.2), rot: -0.01 + 0.012 * u };
        if (v === 1) return { x: 960 + 30 * u, y: 540, zoom: 1.08 - 0.05 * u + hit(t0, 0.03, 0.2), rot: 0.03 - 0.04 * u };
        return { x: 920 + 70 * u, y: 545 - 10 * u, zoom: 1.04 + hit(t0, 0.03, 0.2), rot: 0 };
      }
      if (t < b(14)) {
        const u = ease.outQuint(clamp((t - b(13)) / 0.9));
        return { x: 960, y: 540, zoom: lerp(1.04, 1.0, u) + 0.004 * (t - b(13)), rot: 0 };
      }
      if (t < b(18)) {
        const dr = drift(0.4);
        const k = t - b(14);
        const z = 1.0 + 0.004 * k;
        // whip into the finale
        const w = ease.in(clamp((t - (b(18) - 0.42)) / 0.42));
        return { x: dr.x, y: dr.y, zoom: z + w * 0.9, rot: dr.rot * 0 + w * 0.05 };
      }
      if (t < b(20)) {
        const u = (t - b(18)) / (b(20) - b(18));
        return { x: 960 + 20 * Math.sin(t * 0.3), y: 540, zoom: 1.12 - 0.08 * ease.outQuint(clamp(u * 3)) + 0.02 * u, rot: 0.008 * Math.sin(t * 0.2) };
      }
      const u = (t - b(20)) / (this.end - b(20));
      return { x: 960 + 6 * Math.sin(t * 0.23), y: 540 + 4 * Math.sin(t * 0.19), zoom: 0.985 + 0.05 * ease.inOutSine(u) + hit(b(22), 0.012, 0.5), rot: 0.003 * Math.sin(t * 0.17) };
    }

    // ---------------------------------------------------------------- colour from harmony
    chordColor(t) {
      const ch = this.S.chordAt(t);
      return { cur: hex(ch.cur.color), prev: hex(ch.prev.color), since: ch.since, name: ch.cur.name };
    }
    // colour along a ribbon: the new chord colour sweeps out from the centre with a bright front
    ribbonColor(t, base = C.blue, mixK = 0.72) {
      const ch = this.chordColor(t);
      const r = ch.since * 1.5;
      const cur = mix3(base, ch.cur, mixK), prev = mix3(base, ch.prev, mixK);
      return (u) => {
        const d = Math.abs(u - 0.5);
        const k = smooth(r - 0.05, r, d);
        const c = mix3(cur, prev, k);
        const front = Math.exp(-Math.pow((d - r) / 0.03, 2)) * Math.exp(-ch.since / 0.45) * 1.6;
        return [c[0] + front, c[1] + front, c[2] + front];
      };
    }

    // ---------------------------------------------------------------- ribbon of light
    // o: cx, cy, span, amp, band, strands, gain, seed, speed, twist, col(u), ext (0..0.5), morph (0..1), wave, vertical, w
    ribbon(m, t, o) {
      const S = this.S, R = this.R;
      const N = o.strands ?? 18, span = o.span ?? 2300;
      const ext = o.ext ?? 0.5;
      if (ext <= 0.002) return;
      const n = Math.max(16, Math.round((span * ext * 2) / 7));
      const recent = S.recent(S.pulses, t, 1.2);
      const k = S.env(S.pulses, t, 0.14);
      const sn = S.env(S.snare, t, 0.11);
      const seed = o.seed ?? 0, sp = o.speed ?? 1, tw = o.twist ?? 1.1;
      const morph = o.morph ?? 1;
      const full = S.envAt('full', t), low = S.envAt('low', t);
      const pts = new Float32Array(n * 2), col = new Float32Array(n * 3), wid = new Float32Array(n);
      const uc = new Float32Array(n), yc = new Float32Array(n), B = new Float32Array(n), th = new Float32Array(n), bump = new Float32Array(n), fade = new Float32Array(n), wv = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const u = 0.5 - ext + (2 * ext * i) / (n - 1);
        uc[i] = u;
        th[i] = u * tw * TAU + t * 0.55 * sp + seed;
        yc[i] = o.amp * (0.68 * Math.sin(u * 7.1 + t * 0.42 * sp + seed) + 0.32 * Math.sin(u * 15.3 - t * 0.63 * sp + seed * 2.1));
        let bp = 0;
        for (const p of recent) {
          const dt = t - p.t;
          bp += p.v * Math.exp(-Math.pow((Math.abs(u - 0.5) - dt * 0.62) / 0.055, 2)) * Math.exp(-dt / 0.55);
        }
        bump[i] = bp;
        fade[i] = smooth(0, 0.1, u) * smooth(0, 0.1, 1 - u) * smooth(0, 0.06, ext - Math.abs(u - 0.5));
        B[i] = o.band * (0.62 + 0.38 * Math.sin(u * 5.3 + t * 0.3 + seed)) * (1 + 0.32 * k + 0.22 * sn + 0.55 * bp + 0.25 * low);
        if (morph < 1) {
          const env = Math.exp(-Math.pow((u - 0.5) / 0.2, 2));
          const a = 0.55 * Math.sin(u * 61 * TAU + t * 9) + 0.3 * Math.sin(u * 37 * TAU - t * 6) + 0.25 * Math.sin(u * 93 * TAU + t * 13);
          wv[i] = (o.wave ?? 90) * env * a * (0.35 + 0.65 * full) * (0.6 + 0.4 * noise1(u * 40 + t * 3, 3));
        }
      }
      const colFn = o.col || (() => C.blue);
      for (let j = 0; j < N; j++) {
        const s = N > 1 ? (j / (N - 1)) * 2 - 1 : 0;
        const edge = Math.abs(s) > 0.94 ? 1.55 : 1;
        for (let i = 0; i < n; i++) {
          const u = uc[i];
          let x = (u - 0.5) * span;
          let y = yc[i] + B[i] * Math.cos(th[i]) * s + 1.2 * Math.sin(u * 40 + j * 1.7 + t * 2);
          if (morph < 1) y = lerp(wv[i] * (1 - Math.abs(s) * 0.25), y, morph);
          const front = 0.5 + 0.5 * Math.sin(th[i]) * s;
          const g = (0.22 + 0.78 * front) * edge * (o.gain ?? 1) * (1 + 1.25 * bump[i] + 0.5 * k + 0.4 * sn) * fade[i] * (morph < 1 ? lerp(2.2 / N, 1, morph * morph) : 1);
          if (o.vertical) { const tmp = x; x = -y; y = tmp; }
          pts[i * 2] = o.cx + x;
          pts[i * 2 + 1] = o.cy + y;
          const c = colFn(u);
          const white = edge > 1 ? 0.35 : 0.1;
          col[i * 3] = lerp(c[0], 1, white) * g; col[i * 3 + 1] = lerp(c[1], 1, white) * g; col[i * 3 + 2] = lerp(c[2], 1, white) * g;
          wid[i] = (o.w ?? 0.8) * (edge > 1 ? 1.25 : 1) * (0.7 + 0.3 * fade[i]);
        }
        line(R, pts, m, (uu, i) => wid[i], (uu, i) => [col[i * 3], col[i * 3 + 1], col[i * 3 + 2]], RIB);
      }
      // hi-hats throw sparks off the ribbon
      if ((o.sparks ?? 1) > 0) {
        for (const h of S.recent(S.hat, t, 0.5)) {
          const dt = t - h.t;
          for (let q = 0; q < 2; q++) {
            const u = 0.5 + (hash(h.t * 917 + q * 13) - 0.5) * 2 * ext * 0.85;
            const i = Math.round(((u - (0.5 - ext)) / (2 * ext)) * (n - 1));
            if (i < 0 || i >= n) continue;
            const ss = (hash(h.t * 331 + q) - 0.5) * 2;
            let x = (u - 0.5) * span + (hash(h.t * 71 + q) - 0.5) * 30 * dt;
            let y = yc[i] + B[i] * Math.cos(th[i]) * ss - dt * 60;
            if (o.vertical) { const tmp = x; x = -y; y = tmp; }
            const c = colFn(u);
            spark(R, m, o.cx + x, o.cy + y, 1.6, mix3(c, C.white, 0.6), 4 * h.v * Math.exp(-dt / 0.14) * (o.gain ?? 1) * (o.sparks ?? 1));
          }
        }
      }
    }

    // ---------------------------------------------------------------- scene: the hand pressing play
    handMatrix(t, m) {
      const d = this.drop;
      // anticipation (slight lift), then the press lands just before the drop
      const lift = smooth(d - 0.75, d - 0.42, t) * (1 - smooth(d - 0.42, d - 0.06, t));
      const press = smooth(d - 0.42, d - 0.02, t) * (1 - smooth(d + 0.08, d + 0.5, t) * 0.6);
      const off = -16 * lift + 10 * press - 6;
      const a = 0.18, c = Math.cos(a), s = Math.sin(a);
      const [bx, by] = this.button.c;
      return multiply(m, [c, s, -s, c, bx - s * off, by + c * off]);
    }

    drawHand(t, m) {
      const d = this.drop, R = this.R;
      if (t > d + 1.4) return;
      const hm = this.handMatrix(t, m);
      const erase = ease.inOutSine(clamp((t - (d + 0.05)) / 1.0));
      const col = mix3(C.blue, C.ice, 0.35);
      const P = this.hand;
      const g = 1.6;
      // a single spark appears, then becomes the line
      if (t < 0.6) spark(R, hm, -150, -669, 2.2, C.ice, 7 * smooth(0.12, 0.4, t));
      const draw = (path, t0, t1, w, seed, extra = {}) => stroke(R, path, {
        m: hm, t, seed, w, col, gain: g, reveal: ease.inOut(clamp((t - t0) / (t1 - t0))), from: erase, ...extra,
      });
      draw(P.contour, 0.3, 2.7, 2.0, 1, { taper: 0.06 });
      draw(P.thumb, 2.25, 2.65, 1.6, 2);
      draw(P.nail, 2.7, 2.98, 1.2, 7);
      P.creases.forEach((c, i) => draw(c, 2.8 + i * 0.08, 3.0 + i * 0.08, 1.0, 8 + i));
      draw(P.cuff, 2.9, 3.35, 1.5, 10);
    }

    drawButton(t, m) {
      const d = this.drop, R = this.R;
      if (t > d + 1.2) return;
      const squash = 1 - 0.06 * smooth(d - 0.3, d - 0.02, t) * (1 - smooth(d, d + 0.2, t));
      const [cx, cy] = this.button.c;
      const bm = multiply(m, [squash, 0, 0, squash, cx * (1 - squash), cy * (1 - squash)]);
      const fadeOut = 1 - smooth(d + 0.05, d + 0.8, t);
      const flash = t >= d ? 3 * Math.exp(-(t - d) / 0.12) : 0;
      stroke(R, this.buttonCircle, { m: bm, t, seed: 7, w: 1.9, col: C.blue, gain: (1.5 + flash) * fadeOut, reveal: ease.inOut(clamp((t - 2.75) / 0.75)) });
      stroke(R, this.buttonTri, { m: bm, t, seed: 8, w: 1.7, col: C.ice, gain: (1.3 + flash) * fadeOut, reveal: ease.inOut(clamp((t - 3.25) / 0.4)) });
      // ripples of light from the press
      if (t >= d) {
        for (let i = 0; i < 3; i++) {
          const dt = t - d - i * 0.09;
          if (dt <= 0) continue;
          const r = 92 + 1100 * ease.outQuint(clamp(dt / 1.6)) ;
          const a = Math.exp(-dt / 0.45) * (1 - i * 0.25);
          if (a < 0.01) continue;
          const c = circle(cx, cy, r, 0, 1);
          line(R, c.p, m, 0.9 + 1.5 * Math.exp(-dt / 0.2), mul3(mix3(C.blue, C.ice, 0.4), 1.4 * a), UI);
        }
      }
    }

    // ---------------------------------------------------------------- scene: analysis chips
    drawChips(t, m) {
      const S = this.S, R = this.R, b = this.b;
      const t0 = b(2) - 0.15, t1 = b(10) - 0.2;
      if (t < t0 || t > t1 + 0.5) return;
      const out = 1 - smooth(t1 - 0.1, t1 + 0.4, t);
      const ch = this.chordColor(t);
      const sec = S.section(t);
      const vo4 = S.vo.vo04, vo5 = S.vo.vo05;
      const hiBeat = vo4 ? smooth(vo4.start - 0.1, vo4.start + 0.2, t) * (1 - smooth(vo4.end + 0.4, vo4.end + 1.0, t)) : 0;
      const hiChord = vo5 ? smooth(vo5.start - 0.1, vo5.start + 0.2, t) * (1 - smooth(vo5.end + 0.8, vo5.end + 1.6, t)) : 0;
      const chips = [
        { k: 'TEMPO', v: `${Math.round(S.BPM)} BPM`, w: 214, hi: 0 },
        { k: 'BEAT', v: '', w: 196, hi: hiBeat, beat: true },
        { k: 'CHORD', v: ch.name, w: 176, hi: hiChord, chord: true },
        { k: 'SECTION', v: sec.label || 'Verse', w: 268, hi: 0 },
      ];
      const gap = 18, h = 58, y = 948;
      const total = chips.reduce((a, c) => a + c.w, 0) + gap * (chips.length - 1);
      let x = 960 - total / 2;
      chips.forEach((c, i) => {
        const ta = t0 + i * S.BEAT;
        const rev = ease.out(clamp((t - ta) / 0.4));
        if (rev <= 0) { x += c.w + gap; return; }
        const cx = x + c.w / 2;
        const pulse = c.hi;
        const box = rrect(cx, y, c.w, h, h / 2);
        stroke(R, box, { m, t, seed: 20 + i, w: 0.7 + 0.5 * pulse, col: c.chord ? mix3(C.blue, ch.cur, 0.8) : C.blue, gain: (0.9 + 1.4 * pulse) * out, reveal: rev, boil: 0.5, tip: 0.5, style: UI, taper: 0.02 });
        const a = smooth(0.3, 0.9, rev) * out;
        Text.label(R, c.k, x + 28, y + 6, { m, key: 'sg500', size: 14, tracking: 0.22, color: CSS.fg3, alpha: a });
        const kx = x + 28 + Text.measure('sg500', c.k, 14, 0.22) + 14;
        if (c.beat) {
          const bi = S.beatInBar(t);
          const bt0 = S.db[0] + Math.floor((t - S.db[0]) / S.BEAT + 1e-6) * S.BEAT;
          const playing = S.env(S.pulses, t, 0.2) > 0.02 || t < S.firstDrop + 0.1;
          for (let q = 0; q < 4; q++) {
            const on = q === bi ? Math.exp(-(t - bt0) / 0.18) : 0;
            spark(R, m, kx + 8 + q * 24, y, 3.2, q === 0 ? C.ice : C.blue, (0.35 + (playing ? 5 : 1.5) * on) * a * (1 + pulse));
          }
        } else if (c.chord) {
          const flash = Math.exp(-ch.since / 0.25);
          spark(R, m, kx + 7, y, 4, ch.cur, (1.6 + 4 * flash) * a);
          Text.label(R, c.v, kx + 22, y + 8, { m, key: 'sg500', size: 22, color: CSS.fg, alpha: a });
        } else {
          Text.label(R, c.v, kx, y + 8, { m, key: 'sg500', size: 22, color: CSS.fg, alpha: a });
        }
        x += c.w + gap;
      });
    }

    // ---------------------------------------------------------------- scene: waveform -> ribbon -> lyric
    drawMainRibbon(t, m) {
      const b = this.b, d = this.drop;
      if (t < d - 0.02 || t > b(10) + 0.05) return;
      const ext = 0.5 * ease.outExpo(clamp((t - d) / 1.1));
      const morph = ease.inOutSine(clamp((t - (d + 0.7)) / 1.8));
      // during the lyric the ribbon sinks and calms, then returns for the chorus
      const sink = ease.inOutSine(clamp((t - b(7) - 0.2) / 1.6)) * (1 - ease.outQuint(clamp((t - b(9)) / 0.6)) * 0.55);
      const cy = lerp(lerp(650, 545, morph), 870, sink);
      const gain = lerp(1, 0.5, sink) * (1 - smooth(b(10) - 0.12, b(10), t));
      const chorus = smooth(b(9) - 0.05, b(9) + 0.3, t);
      this.ribbon(m, t, {
        cx: 960, cy, span: 2350, amp: lerp(lerp(10, 115, morph), 60, sink), band: lerp(46, 70, chorus) * lerp(0.2, 1, morph),
        strands: chorus > 0.5 ? 24 : 18, gain: gain * lerp(1.0, 1.25, chorus), seed: 0.7, speed: lerp(1, 1.35, chorus), twist: 1.15,
        col: this.ribbonColor(t, chorus > 0.5 ? C.blue2 : C.blue), ext, morph, wave: 95,
      });
    }

    drawLyric(t, m) {
      const S = this.S, R = this.R, b = this.b;
      if (!S.vo.lyric || t < b(7) || t > b(10) + 0.1) return;
      const out = smooth(b(10) - 0.75, b(10) - 0.05, t);
      const chorusHit = t >= b(9) ? Math.exp(-(t - b(9)) / 0.5) : 0;
      // the word-timing rail: one tick per word, a playhead runs with the voice
      const v = S.vo.lyric;
      const railA = smooth(b(7) + 0.6, b(7) + 1.2, t) * (1 - out);
      const x0 = this.lyricX0, x1 = this.lyricX1, ry = 742;
      const L0 = v.start - 0.25, L1 = v.end + 0.25;
      const xr = (tt) => lerp(x0, x1, clamp((tt - L0) / (L1 - L0)));
      if (railA > 0.01) {
        const rail = resample([[x0, ry], [x1, ry]], 4);
        stroke(R, rail, { m, t, seed: 40, w: 0.55, col: C.blue, gain: 0.8 * railA, reveal: ease.inOut(clamp((t - b(7) - 0.6) / 0.8)), boil: 0.3, style: UI, tip: 0.4, taper: 0.05 });
        Text.label(R, 'WORD TIMING', x0, ry - 22, { m, key: 'sg500', size: 14, tracking: 0.24, color: CSS.fg3, alpha: railA });
        const ph = Math.max(L0, Math.min(L1, t));
        const tc = `${String(Math.floor(ph / 60)).padStart(2, '0')}:${(ph % 60).toFixed(2).padStart(5, '0')}`;
        Text.label(R, tc, x1, ry - 22, { m, key: 'sg500', size: 15, tracking: 0.12, color: CSS.fg2, alpha: railA, align: 'right' });
        for (const w of this.lyric) {
          const ws = w.timing.s;
          const lit = t >= ws ? 1 + 3 * Math.exp(-(t - ws) / 0.2) : 0.35;
          const tick = resample([[xr(ws), ry - 9], [xr(ws), ry + 9]], 2);
          line(R, tick.p, m, 0.8, mul3(t >= ws ? C.ice : C.blue, lit * railA), UI);
        }
        if (t > L0 && t < L1 + 0.5) spark(R, m, xr(t), ry, 2.6, C.ice, 5 * railA * (1 - smooth(L1, L1 + 0.5, t)));
      }
      // the words, inked the moment they are heard
      for (const w of this.lyric) {
        const ws = w.timing.s, we = w.timing.e;
        if (t < ws - 0.02) continue;
        const dur = clamp((we - ws) * 0.95, 0.2, 0.42);
        const isLight = w.idx === 5;
        const glow = isLight ? chorusHit * 2.2 : chorusHit * 0.6;
        const ch = this.chordColor(t);
        const col = isLight && t >= b(9) - 0.02 ? mix3(C.ice, ch.cur, 0.55) : mix3(C.ice, C.blue, 0.25);
        const byGlyph = {};
        for (const o of w.outlines) (byGlyph[o.glyph] = byGlyph[o.glyph] || []).push(o.path);
        const glyphs = Object.keys(byGlyph).length;
        Object.entries(byGlyph).forEach(([gi, paths]) => {
          const g0 = ws + (gi / Math.max(1, glyphs)) * dur * 0.45;
          const rev = ease.out(clamp((t - g0) / (dur * 0.7)));
          for (const p of paths) {
            const settle = 1 - 0.72 * smooth(ws + dur, ws + dur + 0.5, t);
            stroke(R, p, { m, t, seed: 50 + w.idx * 7 + +gi, w: 1.0, col, gain: (1.4 * settle + glow * 0.5) * (1 - out), reveal: rev, from: out > 0 ? ease.in(out) : 0, boil: 0.6, taper: 0.04, tip: 0.8, wobbleFreq: 0.03 });
          }
        });
        const fillA = smooth(ws + dur * 0.35, ws + dur + 0.12, t) * (1 - out);
        if (fillA > 0.01) {
          Text.fill(R, w.L, w.x, w.y, 0, { m, color: isLight && t >= b(9) - 0.02 ? rgbCss(mix3(C.ice, ch.cur, 0.35)) : CSS.fg, alpha: fillA * (0.92 + 0.08 * glow) });
        }
        // words dissolve into rising light
        if (out > 0) {
          const rnd = mulberry32(w.idx * 31 + 7);
          for (let q = 0; q < 26; q++) {
            const o = w.outlines[Math.floor(rnd() * w.outlines.length)];
            const k = Math.floor(rnd() * o.path.n);
            const px = o.path.p[k * 2], py = o.path.p[k * 2 + 1];
            const life = out;
            spark(R, m, px + (rnd() - 0.5) * 40 * life, py - 120 * life * (0.4 + rnd()), 1.4, col, 3.5 * Math.sin(Math.PI * clamp(life)) );
          }
        }
      }
      // section badge at the top: the look changes when the song does
      const secA = smooth(b(7) + 0.2, b(7) + 0.8, t) * (1 - out);
      if (secA > 0.01) {
        const sec = S.section(t);
        const colr = sec.name === 'chorus' ? '#5a88ff' : sec.name === 'pre' ? '#5ccfa2' : '#bfe2ff';
        Text.label(R, (sec.label || '').toUpperCase(), 960, 214, { m, key: 'sg500', size: 18, tracking: 0.32, color: colr, alpha: secA, align: 'center' });
      }
    }

    // ---------------------------------------------------------------- scene: three seeds
    seedVisual(v, m, t, a) {
      const R = this.R, S = this.S;
      const k = S.env(S.pulses, t, 0.15);
      if (v === 0) {
        // twin ribbons in blue and magenta
        const colA = this.ribbonColor(t, C.blue, 0.5), colB = this.ribbonColor(t, C.magenta, 0.35);
        this.ribbon(m, t, { cx: 960, cy: 520, span: 2300, amp: 150, band: 58, strands: 16, gain: 1.1 * a, seed: 2.1, speed: 1.2, twist: 0.9, col: colA });
        this.ribbon(m, t, { cx: 960, cy: 560, span: 2300, amp: -130, band: 40, strands: 12, gain: 0.9 * a, seed: 4.4, speed: 0.9, twist: 1.4, col: colB, sparks: 0.5 });
        const L = this.k4seed || (this.k4seed = { L: Text.layout('anton', 'LIGHT', 300, 0.02) });
        if (!L.o) L.o = Text.outlines(L.L, 960, 650, 0.5, 3);
        for (const o of L.o) stroke(R, o.path, { m, t, seed: 90 + o.glyph, w: 1.0, col: C.ice, gain: (0.9 + 1.0 * k) * a, reveal: ease.out(clamp((t - this.b(10) - 0.05) / 0.6)), boil: 0.7, tip: 0.6 });
      } else if (v === 1) {
        // orbits: rings of light, tilted, breathing with the beat
        const ch = this.chordColor(t);
        const recent = S.recent(S.pulses, t, 1.0);
        for (let i = 0; i < 15; i++) {
          let r = 70 + i * 44;
          for (const p of recent) r += p.v * 26 * Math.exp(-Math.pow(((t - p.t) * 900 - r) / 160, 2)) * Math.exp(-(t - p.t) / 0.6);
          const rot = t * (0.15 + 0.05 * (i % 3)) * (i % 2 ? 1 : -1) + i;
          const gap = 0.35 + 0.25 * Math.sin(i * 2.1);
          const pts = [];
          arcPts(0, 0, r * 0.46, rot, rot + TAU * (1 - gap), pts, r);
          const tilt = -0.32;
          const cs = Math.cos(tilt), sn = Math.sin(tilt);
          const P = pts.map(([x, y]) => [960 + x * cs - y * sn, 540 + x * sn + y * cs]);
          const path = resample(P, 5);
          const c = mix3(i % 3 === 0 ? C.amber : i % 3 === 1 ? C.coral : C.ice, ch.cur, 0.3);
          stroke(R, path, { m, t, seed: 60 + i, w: 0.75 + (i % 4 === 0 ? 0.5 : 0), col: c, gain: (0.9 + 1.2 * k) * a * (1 - i / 22), boil: 0.6, taper: 0.2, tip: 0, style: RIB });
        }
        Text.label(R, 'become the light', 180, 600, { m, key: 'sg400', size: 72, tracking: -0.01, color: CSS.fg, alpha: 0.95 * a });
      } else {
        // a field of contour lines, like the terrain of the song
        const recent = S.recent(S.pulses, t, 1.4);
        const ch = this.chordColor(t);
        for (let r = 0; r < 34; r++) {
          const y0 = 150 + r * 23;
          const pts = new Float32Array(130 * 2);
          for (let i = 0; i < 130; i++) {
            const x = -40 + i * 16;
            const u = x / 1920;
            let dy = noise1(u * 4 + t * 0.35 + r * 0.31, 5) * 34 + noise1(u * 9 - t * 0.5 + r * 0.17, 9) * 12;
            for (const p of recent) dy -= p.v * 46 * Math.exp(-Math.pow((u - (t - p.t) * 0.9) / 0.06, 2)) * Math.exp(-(t - p.t) / 0.7) * Math.sin(r * 0.37 + 1.2);
            pts[i * 2] = x; pts[i * 2 + 1] = y0 + dy * (0.4 + 0.6 * Math.sin((r / 33) * Math.PI));
          }
          const c = mix3(r % 2 ? C.cyan : C.mint, ch.cur, 0.25);
          const g = (0.55 + 0.6 * k) * a * Math.sin((r / 33) * Math.PI);
          line(R, pts, m, 0.7, (u) => mul3(c, g * smooth(0, 0.15, u) * smooth(0, 0.15, 1 - u)), RIB);
        }
        Text.label(R, 'BECOME THE LIGHT', 960, 900, { m, key: 'mont700', size: 40, tracking: 0.5, color: CSS.fg, alpha: 0.95 * a, align: 'center' });
      }
    }

    drawSeeds(t, m) {
      const S = this.S, R = this.R, b = this.b;
      if (t < b(10) - 0.02 || t > b(14) + 0.6) return;
      const seeds = ['4107', '0886', '7351'];
      const labels = (v, mm, a) => {
        Text.label(R, `VERSION ${v + 1}`, 120, 990, { m: mm, key: 'sg500', size: 16, tracking: 0.24, color: CSS.fg2, alpha: a });
        Text.label(R, `SEED ${seeds[v]}`, 290, 990, { m: mm, key: 'sg500', size: 16, tracking: 0.24, color: CSS.fg3, alpha: a });
      };
      if (t < b(13)) {
        const v = t < b(11) ? 0 : t < b(12) ? 1 : 2;
        const t0 = [b(10), b(11), b(12)][v];
        const a = smooth(t0 - 0.01, t0 + 0.12, t);
        this.seedVisual(v, m, t, a);
        labels(v, m, a);
        // frame counter: every frame is drawn live
        const fr = Math.floor(t * 60);
        Text.label(R, `FRAME ${String(fr).padStart(5, '0')}`, 1800, 990, { m, key: 'sg500', size: 16, tracking: 0.24, color: CSS.fg3, alpha: a, align: 'right' });
      } else {
        // triptych: no two alike
        const u = ease.outQuint(clamp((t - b(13)) / 0.85));
        const out = smooth(b(14) - 0.35, b(14) + 0.25, t);
        const pw = 540, ph = 304, gap = 40;
        const xs = [960 - pw - gap, 960, 960 + pw + gap];
        for (let v = 0; v < 3; v++) {
          // version 3 shrinks from full screen into its panel; the others arrive beside it
          let cx = xs[v], cy = 520, w = pw, h = ph;
          if (v === 2) { cx = lerp(960, xs[2], u); cy = lerp(540, 520, u); w = lerp(1920, pw, u); h = lerp(1080, ph, u); }
          const a = (v === 2 ? 1 : smooth(0.15 + v * 0.12, 0.55 + v * 0.12, u)) * (1 - out);
          if (a <= 0.01) continue;
          const s = w / 1920;
          const pm = multiply(m, [s, 0, 0, h / 1080, cx - 960 * s, cy - 540 * (h / 1080)]);
          const S2 = Math.hypot(m[0], m[1]);
          const pc = apply(m, cx, cy);
          R.setClip(pc[0], pc[1], (w / 2) * S2, (h / 2) * S2, 14 * S2);
          this.seedVisual(v, pm, t, a);
          R.noClip();
          stroke(R, rrect(cx, cy, w, h, 14), { m, t, seed: 70 + v, w: 0.6, col: C.blue, gain: 1.1 * a, boil: 0.3, style: UI, taper: 0.01, tip: 0 });
          const la = a * smooth(0.5, 1, u);
          Text.label(R, `SEED ${seeds[v]}`, cx, cy + h / 2 + 46, { m, key: 'sg500', size: 18, tracking: 0.28, color: CSS.fg2, alpha: la, align: 'center' });
        }
      }
      // what it is not (with the voice)
      const vo = S.vo.vo07;
      if (vo && t < b(13) + 0.3) {
        const items = ['NO AI-GENERATED VIDEO', 'NO TEMPLATES', 'NO STOCK FOOTAGE'];
        const fade = 1 - smooth(b(13) - 0.3, b(13) + 0.2, t);
        items.forEach((s, i) => {
          const w = S.word('vo07', 'no', i);
          const ta = w ? w.s : vo.start + i * 1.2;
          const a = smooth(ta - 0.05, ta + 0.25, t) * fade;
          if (a <= 0.01) return;
          const y = 140 + i * 44;
          const dash = resample([[120, y - 7], [150, y - 7]], 2);
          stroke(R, dash, { m, t, seed: 80 + i, w: 0.9, col: C.ice, gain: 1.6 * a, reveal: ease.out(clamp((t - ta) / 0.25)), style: UI, tip: 0.6 });
          Text.label(R, s, 168, y, { m, key: 'sg500', size: 20, tracking: 0.22, color: CSS.fg, alpha: a });
        });
      }
    }

    // ---------------------------------------------------------------- scene: formats
    formatBox(t) {
      const S = this.S, b = this.b;
      const W = { w: 1100, h: 619, label: '16:9', sub: 'WIDE · YOUTUBE', lines: ['BECOME THE LIGHT'], vertical: false };
      const T = { w: 340, h: 604, label: '9:16', sub: 'TALL · TIKTOK, REELS, SHORTS', lines: ['BECOME', 'THE', 'LIGHT'], vertical: true };
      const Q = { w: 540, h: 540, label: '1:1', sub: 'SQUARE · THE FEED', lines: ['BECOME', 'THE LIGHT'], vertical: false };
      const tT = S.word('vo10', 'tall')?.s ?? b(14) + 0.8, tQ = S.word('vo10', 'square')?.s ?? b(14) + 1.5;
      const up = S.word('vo10', 'up')?.s ?? b(15);
      let from = W, to = W, k = 1, ts = b(14);
      if (t >= tQ) { from = T; to = Q; ts = tQ; } else if (t >= tT) { from = W; to = T; ts = tT; }
      if (to !== W || t >= tT) k = ease.spring(clamp((t - ts) / 0.6));
      const slide = ease.inOutExpo(clamp((t - (up - 0.15)) / 0.7));
      const cx = lerp(960, 640, slide);
      return { w: lerp(from.w, to.w, k), h: lerp(from.h, to.h, k), cx, cy: 480, from, to, k, ts, up, slide };
    }

    drawFormats(t, m) {
      const S = this.S, R = this.R, b = this.b;
      if (t < b(14) - 0.05 || t > b(16) + 0.5) return;
      const fb = this.formatBox(t);
      const inA = smooth(b(14) - 0.02, b(14) + 0.3, t);
      const toPack = ease.inOutExpo(clamp((t - (b(16) - 0.1)) / 0.55));
      const a = inA * (1 - toPack);
      const S2 = Math.hypot(m[0], m[1]);
      const { w, h, cx, cy } = fb;
      // content composed for each shape (cross-fades during the change)
      const drawContent = (fmt, alpha) => {
        if (alpha <= 0.01) return;
        const pc = apply(m, cx, cy);
        R.setClip(pc[0], pc[1], (w / 2) * S2, (h / 2) * S2, 18 * S2);
        const span = fmt.vertical ? h * 1.6 : w * 1.6;
        this.ribbon(m, t, { cx, cy: cy + (fmt.vertical ? 0 : h * 0.18), span, amp: (fmt.vertical ? w : h) * 0.16, band: (fmt.vertical ? w : h) * 0.09, strands: 14, gain: 0.95 * alpha, seed: 3.3, speed: 1.1, twist: 1.0, col: this.ribbonColor(t, C.blue2), vertical: fmt.vertical, w: 0.7 });
        R.noClip();
        const size = fmt === undefined ? 60 : fmt.vertical ? 54 : fmt.lines.length > 1 ? 64 : 72;
        const lh = size * 1.02;
        const y0 = cy - (fmt.lines.length - 1) * lh * 0.5 - (fmt.vertical ? 0 : h * 0.06);
        fmt.lines.forEach((s, i) => Text.label(R, s, cx, y0 + i * lh + size * 0.36, { m, key: 'anton', size, tracking: 0.01, color: CSS.fg, alpha: alpha * 0.96, align: 'center', clip: [cx - w / 2, cy - h / 2, w, h, 18] }));
      };
      const xf = fb.from === fb.to ? 1 : smooth(0.1, 0.45, fb.k);
      if (fb.from !== fb.to) drawContent(fb.from, a * (1 - xf));
      drawContent(fb.to, a * xf);
      // the frame itself, drawn in light
      const rev = ease.inOut(clamp((t - b(14)) / 0.45));
      const changeFlash = Math.exp(-Math.max(0, t - fb.ts) / 0.25) * (t >= fb.ts && fb.ts > b(14) ? 1 : 0);
      stroke(R, rrect(cx, cy, w, h, 18), { m, t, seed: 101, w: 0.95, col: C.ice, gain: (1.5 + 2.5 * changeFlash) * a, reveal: rev, boil: 0.4, style: UI, taper: 0.01, tip: 0.8 });
      // ratio + where it plays
      const ly = cy + h / 2 + 76;
      const lab = (fmt, alpha) => {
        if (alpha <= 0.01) return;
        Text.label(R, fmt.label, cx, ly, { m, key: 'anton', size: 46, color: CSS.ice, alpha, align: 'center' });
        Text.label(R, fmt.sub, cx, ly + 36, { m, key: 'sg500', size: 16, tracking: 0.26, color: CSS.fg3, alpha, align: 'center' });
      };
      if (fb.from !== fb.to) lab(fb.from, a * (1 - xf) * rev);
      lab(fb.to, a * xf * rev);
      // up to 4K at 60 fps
      const k4 = S.word('vo10', 'four')?.s ?? fb.up + 0.5, f60 = S.word('vo10', 'sixty')?.s ?? fb.up + 1.0;
      const ra = (1 - toPack);
      if (t > k4 - 0.05) {
        const rev4 = ease.out(clamp((t - k4) / 0.45));
        const o4 = this.k4o || (this.k4o = Text.outlines(this.k4, 1290, 520, 0, 3));
        for (const o of o4) stroke(R, o.path, { m, t, seed: 110 + o.glyph, w: 1.1, col: C.ice, gain: (1.7 - 1.2 * smooth(k4 + 0.5, k4 + 1.1, t)) * ra, reveal: rev4, boil: 0.6, tip: 0.8 });
        Text.fill(R, this.k4, 1290, 520, 0, { m, color: CSS.fg, alpha: smooth(k4 + 0.2, k4 + 0.6, t) * ra });
        Text.label(R, 'UP TO', 1296, 300, { m, key: 'sg500', size: 18, tracking: 0.3, color: CSS.fg3, alpha: smooth(k4 - 0.3, k4, t) * ra });
      }
      if (t > f60 - 0.05) {
        const rv = ease.out(clamp((t - f60) / 0.45));
        const of = this.fpso || (this.fpso = Text.outlines(this.fps, 1294, 650, 0, 3));
        for (const o of of) stroke(R, o.path, { m, t, seed: 120 + o.glyph, w: 0.9, col: C.blue, gain: (1.5 - 1.0 * smooth(f60 + 0.5, f60 + 1.1, t)) * ra, reveal: rv, boil: 0.5, tip: 0.6 });
        Text.fill(R, this.fps, 1294, 650, 0, { m, color: CSS.blue, alpha: smooth(f60 + 0.2, f60 + 0.6, t) * ra });
      }
    }

    // ---------------------------------------------------------------- scene: release pack
    drawPack(t, m) {
      const S = this.S, R = this.R, b = this.b;
      if (t < b(16) - 0.1 || t > b(18) + 0.05) return;
      const tr = S.word('vo11', 'release')?.s ?? b(16) + 0.5;
      const k = S.env(S.pulses, t, 0.15);
      const collapse = ease.in(clamp((t - (b(18) - 0.45)) / 0.45));
      const titleA = smooth(tr - 0.1, tr + 0.3, t) * (1 - collapse);
      Text.label(R, 'THE RELEASE PACK', 960, 176, { m, key: 'sg500', size: 20, tracking: 0.34, color: CSS.fg2, alpha: titleA, align: 'center' });
      const S2 = Math.hypot(m[0], m[1]);
      const groups = [
        { x: 470, accent: C.mint, title: 'SPOTIFY CANVAS', sub: 'LOOP · 9:16', cards: [{ dx: 0, dy: 0, w: 226, h: 402 }], icon: 'loop' },
        { x: 960, accent: C.coral, title: 'APPLE MUSIC MOTION ARTWORK', sub: '1:1 · 3:4', cards: [{ dx: -78, dy: -20, w: 250, h: 250 }, { dx: 96, dy: 40, w: 200, h: 267 }] },
        { x: 1450, accent: C.amber, title: 'SOCIAL CLIPS', sub: '15 · 30 · 60 SECONDS', cards: [{ dx: -100, dy: 22, w: 150, h: 267, txt: '15s', rot: -0.07 }, { dx: 0, dy: 0, w: 150, h: 267, txt: '30s' }, { dx: 100, dy: 22, w: 150, h: 267, txt: '60s', rot: 0.07 }] },
      ];
      groups.forEach((g, gi) => {
        const t0 = tr + gi * S.BEAT;
        const rev = ease.inOut(clamp((t - t0) / 0.5));
        if (rev <= 0) return;
        const a = (1 - collapse);
        g.cards.forEach((c, ci) => {
          let cx = g.x + c.dx, cy = 500 + c.dy;
          cx = lerp(cx, 960, collapse); cy = lerp(cy, 540, collapse);
          const sc = lerp(1, 0.2, collapse);
          const w = c.w * sc, h = c.h * sc;
          const ca = smooth(0.3, 1, rev) * a;
          const pc = apply(m, cx, cy);
          R.setClip(pc[0], pc[1], (w / 2) * S2, (h / 2) * S2, 12 * S2);
          this.ribbon(m, t, { cx, cy: cy + h * 0.12, span: h * 1.7, amp: w * 0.12, band: w * 0.1, strands: 10, gain: 0.85 * ca, seed: 5 + gi * 2 + ci, speed: 1.2, twist: 1.1, col: this.ribbonColor(t, g.accent, 0.35), vertical: h > w * 1.1, w: 0.6, sparks: 0.4 });
          R.noClip();
          const rr = c.rot || 0;
          let box = rrect(cx, cy, w, h, 12);
          if (rr) {
            const cs = Math.cos(rr), sn = Math.sin(rr);
            const P = [];
            for (let i = 0; i < box.n; i++) { const x = box.p[i * 2] - cx, y = box.p[i * 2 + 1] - cy; P.push([cx + x * cs - y * sn, cy + x * sn + y * cs]); }
            box = resample(P, 4);
          }
          stroke(R, box, { m, t, seed: 130 + gi * 5 + ci, w: 0.9, col: mix3(g.accent, C.white, 0.25), gain: (1.4 + 1.6 * k) * a, reveal: rev, boil: 0.4, style: UI, taper: 0.01, tip: 0.7 });
          if (c.txt) Text.label(R, c.txt, cx, cy + 16, { m, key: 'anton', size: 46 * sc, color: CSS.fg, alpha: ca, align: 'center' });
        });
        if (g.icon === 'loop') {
          const ip = resample(arcPts(g.x, 500, 34, -Math.PI * 0.35, Math.PI * 1.45, []), 3);
          stroke(R, ip, { m, t, seed: 150, w: 1.4, col: C.ice, gain: 1.8 * (1 - collapse), reveal: ease.inOut(clamp((t - t0 - 0.25) / 0.5)), tip: 0.8 });
          const ax = g.x + Math.cos(-Math.PI * 0.35) * 34, ay = 500 + Math.sin(-Math.PI * 0.35) * 34;
          const ar = resample([[ax - 14, ay - 12], [ax, ay], [ax + 16, ay - 6]], 2);
          stroke(R, ar, { m, t, seed: 151, w: 1.3, col: C.ice, gain: 1.8 * (1 - collapse), reveal: ease.out(clamp((t - t0 - 0.7) / 0.2)), tip: 0 });
        }
        const la = smooth(0.4, 1, rev) * (1 - collapse);
        Text.label(R, g.title, g.x, 770, { m, key: 'sg500', size: 18, tracking: 0.2, color: CSS.fg, alpha: la, align: 'center' });
        Text.label(R, g.sub, g.x, 800, { m, key: 'sg500', size: 15, tracking: 0.24, color: CSS.fg3, alpha: la, align: 'center' });
      });
      // the line under it all
      const ua = smooth(tr + 1.6, tr + 2.4, t) * (1 - collapse);
      Text.label(R, 'Plus the full video in wide, tall and square.', 960, 900, { m, key: 'sg400', size: 22, color: CSS.fg2, alpha: ua, align: 'center' });
    }

    // ---------------------------------------------------------------- scene: finale statement
    drawFinale(t, m) {
      const S = this.S, R = this.R, b = this.b;
      if (t < b(18) - 0.02 || t > b(20) + 0.6) return;
      const out = smooth(b(20) - 0.45, b(20) + 0.15, t);
      const inA = smooth(b(18) - 0.02, b(18) + 0.2, t);
      const k = S.env(S.pulses, t, 0.15);
      this.ribbon(m, t, { cx: 960, cy: 880, span: 2400, amp: 70, band: 54, strands: 26, gain: 1.15 * inA * (1 - out), seed: 9.1, speed: 1.4, twist: 1.3, col: this.ribbonColor(t, C.blue2, 0.8) });
      this.statement.forEach((st, i) => {
        if (t < st.t - 0.05) return;
        const rev = ease.out(clamp((t - st.t) / 0.55));
        const isColor = st.key === 'color';
        const ch = this.chordColor(t);
        const palette = [C.blue, C.magenta, C.amber, C.cyan];
        for (const o of st.outlines) {
          const c = isColor ? palette[o.glyph % palette.length] : mix3(C.ice, ch.cur, 0.2);
          stroke(R, o.path, { m, t, seed: 160 + i * 20 + o.glyph, w: 1.0, col: c, gain: (1.5 * (1 - 0.7 * smooth(st.t + 0.5, st.t + 1.1, t)) + 0.35 * k) * (1 - out), reveal: rev, from: ease.in(out), boil: 0.6, tip: 0.8 });
        }
        const fa = smooth(st.t + 0.2, st.t + 0.65, t) * (1 - out);
        if (isColor) {
          const g = this.R.text.createLinearGradient(960 - st.L.width / 2, 0, 960 + st.L.width / 2, 0);
          ['#8cb4ff', '#ff5fd7', '#ffc766', '#5aebff'].forEach((c, q) => g.addColorStop(q / 3, c));
          this._gradFill(st.L, st.y, g, fa);
        } else Text.fill(R, st.L, 960, st.y, 0.5, { m, color: CSS.fg, alpha: fa });
      });
    }
    _gradFill(L, y, g, a) {
      // fill with a CSS gradient (used for "AND COLOR.")
      const R = this.R;
      const ctx = R.text;
      ctx.save();
      const m = this._m;
      ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.globalAlpha = a;
      ctx.fillStyle = g;
      const ox = 960 - L.width / 2;
      for (const gl of L.glyphs) {
        const p = gl.g.getPath(ox + gl.x, y, L.size);
        ctx.fill(new Path2D(p.toPathData(3)));
      }
      ctx.restore();
      R.textDirty = true;
    }

    // ---------------------------------------------------------------- scene: end card
    drawEnd(t, m) {
      const S = this.S, R = this.R, b = this.b;
      const t0 = b(20) - 0.15;
      if (t < t0) return;
      const hit = t >= b(22) ? Math.exp(-(t - b(22)) / 0.6) : 0;
      const k = S.env(S.pulses, t, 0.2);
      // a calm ribbon low in frame
      const ra = smooth(t0, t0 + 1.5, t);
      this.ribbon(m, t, { cx: 960, cy: 1010, span: 2400, amp: 26, band: 26, strands: 14, gain: 0.55 * ra * (1 + 1.5 * hit), seed: 1.9, speed: 0.6, twist: 0.8, col: this.ribbonColor(t, C.blue, 0.4), sparks: 0.3 });
      // logo mark drawn in light, stroke by stroke
      this.logo.forEach((p, i) => {
        const s0 = t0 + 0.15 + i * 0.32;
        const rev = ease.inOut(clamp((t - s0) / 0.8));
        if (rev <= 0) return;
        stroke(R, p, { m, t, seed: 200 + i, w: this.logoW * 0.42, col: C.blue, gain: 1.15 + 0.6 * hit + 0.15 * k, reveal: rev, boil: 0.35, taper: 0.03, tip: 1, style: TUBE, wobbleFreq: 0.01 });
      });
      // wordmark
      const v13 = S.vo.vo13;
      const wt = v13 ? v13.start : t0 + 1.0;
      const wr = ease.out(clamp((t - wt) / 0.7));
      if (wr > 0) {
        for (const o of this.wm1o) stroke(R, o.path, { m, t, seed: 220 + o.glyph, w: 0.6, col: C.ice, gain: 1.2 * (1 - smooth(wt + 0.6, wt + 1.4, t) * 0.6), reveal: wr, boil: 0.3, tip: 0.6, style: UI, taper: 0.02 });
        Text.fill(R, this.wm1, 960, 572, 0.5, { m, color: CSS.fg, alpha: smooth(wt + 0.25, wt + 0.75, t) });
        Text.fill(R, this.wm2, 960 + 0.25 * 32 * 0.5, 624, 0.5, { m, color: CSS.fg, alpha: smooth(wt + 0.45, wt + 0.95, t) });
      }
      // tagline
      const ta = wt + 0.9;
      Text.label(R, 'Lyric videos drawn in light and color.', 960, 702 + 10 * (1 - ease.out(clamp((t - ta) / 0.8))), { m, key: 'sg400', size: 34, color: CSS.fg2, alpha: smooth(ta, ta + 0.6, t), align: 'center' });
      // call to action
      const g = S.word('vo14', 'get');
      const gt = g ? g.s : t0 + 3.2;
      if (t > gt - 0.05) {
        const cw = 420, chh = 84, cy = 818;
        const rev = ease.inOut(clamp((t - gt) / 0.45));
        const fillA = smooth(gt + 0.25, gt + 0.6, t);
        // pill fill (site accent style), then label
        const ctx = R.text;
        ctx.save();
        ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
        ctx.globalAlpha = fillA;
        const gr = ctx.createLinearGradient(0, cy - chh / 2, 0, cy + chh / 2);
        gr.addColorStop(0, '#b3ceff'); gr.addColorStop(0.55, '#8cb4ff'); gr.addColorStop(1, '#7aa6f7');
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.roundRect(960 - cw / 2, cy - chh / 2, cw, chh, chh / 2); ctx.fill();
        ctx.restore();
        R.textDirty = true;
        Text.label(R, 'Get early access', 960, cy + 11, { m, key: 'sg500', size: 32, color: CSS.onBlue, alpha: fillA, align: 'center' });
        stroke(R, rrect(960, cy, cw + 10, chh + 10, (chh + 10) / 2), { m, t, seed: 240, w: 0.9, col: C.ice, gain: (1.6 + 3 * hit) * (1 - fillA * 0.45), reveal: rev, boil: 0.3, style: UI, taper: 0.01, tip: 0.9 });
      }
      // URL
      const u = S.word('vo14', 'live');
      const ut = u ? u.s : gt + 0.6;
      const ua = smooth(ut - 0.05, ut + 0.45, t);
      Text.label(R, 'www.livemotionlabs.com', 960, 938 + 8 * (1 - ease.out(clamp((t - ut) / 0.6))), { m, key: 'sg500', size: 44, tracking: 0.02, color: CSS.ice, alpha: ua, align: 'center' });
      // the final hit sends one ring of light out from the mark
      if (hit > 0.01) {
        const dt = t - b(22);
        const c = circle(960, 352, 140 + 900 * ease.outQuint(clamp(dt / 1.8)), 0, 1);
        line(R, c.p, m, 1.0, mul3(C.blue, 1.6 * hit), UI);
      }
    }

    // ---------------------------------------------------------------- frame
    frame(t) {
      const R = this.R, S = this.S, b = this.b;
      R.begin();
      const cam = this.camera(t);
      const m = camMatrix(cam, R.S);
      this._m = m;
      this.drawHand(t, m);
      this.drawButton(t, m);
      this.drawMainRibbon(t, m);
      this.drawChips(t, m);
      this.drawLyric(t, m);
      this.drawSeeds(t, m);
      this.drawFormats(t, m);
      this.drawPack(t, m);
      this.drawFinale(t, m);
      this.drawEnd(t, m);

      // post: flash on the big moments, haze tinted by harmony
      const ch = this.chordColor(t);
      const flashAt = [this.drop, b(9), b(10), b(11), b(12), b(18)];
      let flash = 0;
      for (const f of flashAt) if (t >= f) flash += Math.exp(-(t - f) / 0.12) * (f === this.drop || f === b(18) ? 0.12 : 0.06);
      const k = S.env(S.pulses, t, 0.2);
      const fadeIn = smooth(0, 0.4, t), fadeOut = 1 - smooth(this.end - 0.55, this.end - 0.02, t);
      return {
        cam,
        kick: k,
        haze: { c1: mul3(C.royal, 0.016), c2: mul3(ch.cur, 0.008), amt: 0.8 + 0.25 * S.envAt('full', t), vis: 1 },
        exposure: 1.0,
        bloom: 0.62,
        grain: 0.028,
        chroma: 0.0022,
        vignette: 0.32,
        fade: fadeIn * fadeOut,
        tint: [...mix3(C.ice, ch.cur, 0.5), flash],
        textGain: 1.0,
      };
    }
  }

  LML.Film = Film;
})();
