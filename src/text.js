// Type: brand fonts drawn two ways.
//  - outlines(): glyph contours as paths, so a pen of light can trace every letter
//  - fill()/label(): crisp fills on the text layer (canvas), composited into the HDR scene
(function () {
  const LML = (window.LML = window.LML || {});
  const { resample } = LML.Ink;

  const fonts = {}; // key -> { ot, family, weight }

  async function load(defs) {
    // defs: { key: { family, weight, data (ArrayBuffer) } }
    for (const [key, d] of Object.entries(defs)) {
      const ff = new FontFace(d.family, d.data.slice(0), { weight: String(d.weight) });
      await ff.load();
      document.fonts.add(ff);
      if (self.OffscreenCanvas && self.fonts === undefined && self !== window) { /* worker: not used */ }
      fonts[key] = { ot: window.opentype.parse(d.data.slice(0)), family: d.family, weight: d.weight };
    }
  }

  // lay out a single line; returns glyph records in design units (size = font size in design px)
  function layout(key, str, size, tracking = 0) {
    const f = fonts[key];
    const ot = f.ot;
    const scale = size / ot.unitsPerEm;
    const glyphs = ot.stringToGlyphs(str);
    let x = 0;
    const out = [];
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      out.push({ g, x, ch: str[i] });
      x += g.advanceWidth * scale;
      if (i + 1 < glyphs.length) x += ot.getKerningValue(g, glyphs[i + 1]) * scale + tracking * size;
    }
    const width = x;
    return { key, str, size, tracking, glyphs: out, width, scale, ascent: ot.ascender * scale, capH: (ot.tables.os2?.sCapHeight || ot.ascender * 0.7) * scale };
  }

  // contours (each a resampled path) for a laid-out line placed with its baseline at (x, y)
  // align: 0 = left, 0.5 = centre, 1 = right
  function outlines(L, x, y, align = 0.5, spacing = 3) {
    const ox = x - L.width * align;
    const res = [];
    L.glyphs.forEach((gl, gi) => {
      const p = gl.g.getPath(ox + gl.x, y, L.size);
      let cur = null;
      const contours = [];
      let cx = 0, cy = 0, sx = 0, sy = 0;
      for (const c of p.commands) {
        if (c.type === 'M') { cur = [[c.x, c.y]]; contours.push(cur); cx = sx = c.x; cy = sy = c.y; }
        else if (c.type === 'L') { cur.push([c.x, c.y]); cx = c.x; cy = c.y; }
        else if (c.type === 'C') { LML.Ink.cubic([cx, cy], [c.x1, c.y1], [c.x2, c.y2], [c.x, c.y], 10, cur); cx = c.x; cy = c.y; }
        else if (c.type === 'Q') {
          const p1 = [cx + (2 / 3) * (c.x1 - cx), cy + (2 / 3) * (c.y1 - cy)];
          const p2 = [c.x + (2 / 3) * (c.x1 - c.x), c.y + (2 / 3) * (c.y1 - c.y)];
          LML.Ink.cubic([cx, cy], p1, p2, [c.x, c.y], 8, cur); cx = c.x; cy = c.y;
        } else if (c.type === 'Z') { if (cur) cur.push([sx, sy]); }
      }
      for (const ct of contours) if (ct.length > 1) res.push({ glyph: gi, path: resample(ct, spacing) });
    });
    return res;
  }

  function path2d(L, x, y, align) {
    const ox = x - L.width * align;
    const P = new Path2D();
    for (const gl of L.glyphs) {
      const p = gl.g.getPath(ox + gl.x, y, L.size);
      for (const c of p.commands) {
        if (c.type === 'M') P.moveTo(c.x, c.y);
        else if (c.type === 'L') P.lineTo(c.x, c.y);
        else if (c.type === 'C') P.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
        else if (c.type === 'Q') P.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
        else if (c.type === 'Z') P.closePath();
      }
    }
    return P;
  }

  // filled glyphs on the text layer. o: { m, color (css), alpha, sweep: {from, to, soft} (design x range reveal) }
  function fill(R, L, x, y, align, o) {
    const ctx = R.text;
    const S = R.S;
    const m = o.m;
    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha ?? 1));
    if (o.sweep) {
      const g = ctx.createLinearGradient(o.sweep.x0, 0, o.sweep.x1, 0);
      const p = Math.max(0, Math.min(1, o.sweep.p));
      const soft = o.sweep.soft ?? 0.15;
      g.addColorStop(0, o.color);
      g.addColorStop(Math.max(0, Math.min(1, p)), o.color);
      g.addColorStop(Math.max(0, Math.min(1, p + soft)), 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
    } else ctx.fillStyle = o.color;
    if (o.clip) { ctx.beginPath(); ctx.roundRect(o.clip[0], o.clip[1], o.clip[2], o.clip[3], o.clip[4] || 0); ctx.clip(); }
    ctx.fill(path2d(L, x, y, align));
    ctx.restore();
    R.textDirty = true;
    void S;
  }

  // simple label with canvas text (uses the same loaded fonts)
  // o: { m, key, size, color, alpha, tracking (em), align: 'left'|'center'|'right', blur }
  function label(R, str, x, y, o) {
    const f = fonts[o.key];
    const ctx = R.text;
    const m = o.m;
    ctx.save();
    ctx.setTransform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.globalAlpha = Math.max(0, Math.min(1, o.alpha ?? 1));
    ctx.font = `${f.weight} ${o.size}px "${f.family}"`;
    ctx.letterSpacing = `${(o.tracking || 0) * o.size}px`;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.baseline || 'alphabetic';
    if (o.clip) { ctx.beginPath(); ctx.roundRect(o.clip[0], o.clip[1], o.clip[2], o.clip[3], o.clip[4] || 0); ctx.clip(); }
    if (o.glow) { ctx.shadowColor = o.glow; ctx.shadowBlur = (o.glowSize || 12) * Math.hypot(m[0], m[1]); }
    ctx.fillStyle = o.color || '#eef2f8';
    // letterSpacing adds trailing space after the last glyph; compensate when centring/right-aligning
    const trail = (o.tracking || 0) * o.size;
    const dx = o.align === 'center' ? trail / 2 : o.align === 'right' ? trail : 0;
    ctx.fillText(str, x + dx, y);
    ctx.restore();
    R.textDirty = true;
  }

  function measure(key, str, size, tracking = 0) {
    return layout(key, str, size, tracking).width;
  }

  LML.Text = { load, layout, outlines, fill, label, measure, fonts };
})();
