// WebGPU renderer: HDR light strokes, a text layer, multi-level bloom and a filmic finish.
// Everything is drawn in "design space" (1920x1080) and scaled to the output resolution.
(function () {
  const LML = (window.LML = window.LML || {});

  const FLOATS_PER_VERT = 20; // pos2 uv2 col4 clip4 prm4 aux4
  const MAX_VERTS = 1 << 19;

  const WGSL_COMMON = /* wgsl */ `
struct Full { @builtin(position) p: vec4f, @location(0) uv: vec2f };
@vertex fn vfull(@builtin(vertex_index) i: u32) -> Full {
  var o: Full;
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  o.p = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  o.uv = vec2f(x, y);
  return o;
}
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

  // ---- light strokes ---------------------------------------------------------------
  const WGSL_LINES = /* wgsl */ `
struct U { res: vec2f, pxScale: f32, _p: f32 };
@group(0) @binding(0) var<uniform> u: U;
struct VIn {
  @location(0) pos: vec2f, @location(1) uv: vec2f, @location(2) col: vec4f,
  @location(3) clip: vec4f, @location(4) prm: vec4f, @location(5) aux: vec4f };
struct VOut {
  @builtin(position) p: vec4f, @location(0) uv: vec2f, @location(1) col: vec4f,
  @location(2) clip: vec4f, @location(3) prm: vec4f, @location(4) px: vec2f, @location(5) aux: vec4f };
@vertex fn vs(i: VIn) -> VOut {
  var o: VOut;
  let ndc = i.pos / u.res * 2.0 - 1.0;
  o.p = vec4f(ndc.x, -ndc.y, 0.0, 1.0);
  o.uv = i.uv; o.col = i.col; o.clip = i.clip; o.prm = i.prm; o.px = i.pos; o.aux = i.aux;
  return o;
}
@fragment fn fs(i: VOut) -> @location(0) vec4f {
  var m = 1.0;
  if (i.clip.z > 0.0) {
    let r = i.aux.x;
    let q = abs(i.px - i.clip.xy) - i.clip.zw + vec2f(r);
    let sd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
    m = clamp(0.5 - sd, 0.0, 1.0);
  }
  let d = length(i.uv);
  let c = i.prm.x;                       // core half-width as a fraction of the quad half-width
  let aa = max(fwidth(d), 1e-4) * 0.75;
  let core = 1.0 - smoothstep(c - aa, c + aa, d);
  let soft = exp(-d * d * i.prm.y) * (1.0 - smoothstep(0.8, 1.0, d));
  let hot = mix(i.col.rgb, vec3f(dot(i.col.rgb, vec3f(0.33))), i.prm.z);
  let rgb = hot * core + i.col.rgb * soft * i.col.a;
  return vec4f(rgb * m, 0.0);
}
`;

  // ---- text layer (canvas, sRGB) into the HDR scene ---------------------------------
  const WGSL_TEXT = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> k: vec4f;
@fragment fn fs(i: Full) -> @location(0) vec4f {
  let c = textureSample(tex, smp, i.uv);
  let lin = pow(max(c.rgb, vec3f(0.0)), vec3f(2.2));
  return vec4f(lin * k.x, 0.0);
}
`;

  // ---- haze: slow drifting light fog, rendered at quarter resolution ----------------
  const WGSL_HAZE = WGSL_COMMON + /* wgsl */ `
struct H { t: f32, kick: f32, amt: f32, aspect: f32, c1: vec4f, c2: vec4f, cam: vec4f };
@group(0) @binding(0) var<uniform> h: H;
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2f(1, 0)), u.x), mix(hash12(i + vec2f(0, 1)), hash12(i + vec2f(1, 1)), u.x), u.y);
}
fn fbm(p0: vec2f) -> f32 {
  var p = p0; var a = 0.5; var s = 0.0;
  for (var i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2f(17.1, 9.2); a *= 0.5; }
  return s;
}
@fragment fn fs(i: Full) -> @location(0) vec4f {
  var p = (i.uv - 0.5) * vec2f(h.aspect, 1.0);
  p = p / h.cam.z + h.cam.xy * 0.35;
  let t = h.t;
  let q = vec2f(fbm(p * 1.6 + vec2f(t * 0.02, -t * 0.015)), fbm(p * 1.6 + vec2f(5.2 - t * 0.017, 1.3)));
  let n = fbm(p * 2.2 + q * 1.7 + vec2f(t * 0.03, t * 0.01));
  let n2 = fbm(p * 1.3 - q + vec2f(-t * 0.012, 3.1));
  let band = smoothstep(0.35, 0.85, n);
  let col = h.c1.rgb * band * band + h.c2.rgb * smoothstep(0.45, 0.9, n2) * 0.6;
  let center = 1.0 - smoothstep(0.2, 1.1, length(p * vec2f(0.8, 1.2)));
  return vec4f(col * h.amt * (0.55 + 0.45 * center) * (1.0 + h.kick * 0.6), 1.0);
}
`;

  // ---- bloom (dual filter: 13-tap down, 9-tap tent up) ------------------------------
  const WGSL_DOWN = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> k: vec4f; // x: texel x, y: texel y, z: prefilter flag, w: threshold
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, smp, uv, 0.0).rgb; }
@fragment fn fs(i: Full) -> @location(0) vec4f {
  let d = k.xy; let uv = i.uv;
  let a = tap(uv + d * vec2f(-2, -2)); let b = tap(uv + d * vec2f(0, -2)); let c = tap(uv + d * vec2f(2, -2));
  let dd = tap(uv + d * vec2f(-2, 0)); let e = tap(uv); let f = tap(uv + d * vec2f(2, 0));
  let g = tap(uv + d * vec2f(-2, 2)); let hh = tap(uv + d * vec2f(0, 2)); let ii = tap(uv + d * vec2f(2, 2));
  let j = tap(uv + d * vec2f(-1, -1)); let kk = tap(uv + d * vec2f(1, -1));
  let l = tap(uv + d * vec2f(-1, 1)); let m = tap(uv + d * vec2f(1, 1));
  var col = e * 0.125 + (a + c + g + ii) * 0.03125 + (b + dd + f + hh) * 0.0625 + (j + kk + l + m) * 0.125;
  if (k.z > 0.5) {
    let br = max(col.r, max(col.g, col.b));
    let knee = k.w * 0.6;
    var rq = clamp(br - k.w + knee, 0.0, 2.0 * knee);
    rq = rq * rq / (4.0 * knee + 1e-4);
    let w = max(rq, br - k.w) / max(br, 1e-4);
    col = col * w;
  }
  return vec4f(col, 1.0);
}
`;
  const WGSL_UP = WGSL_COMMON + /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> k: vec4f; // xy texel of src, z weight
fn tap(uv: vec2f) -> vec3f { return textureSampleLevel(src, smp, uv, 0.0).rgb; }
@fragment fn fs(i: Full) -> @location(0) vec4f {
  let d = k.xy * 1.0; let uv = i.uv;
  var s = tap(uv) * 4.0;
  s += (tap(uv + vec2f(-d.x, 0)) + tap(uv + vec2f(d.x, 0)) + tap(uv + vec2f(0, -d.y)) + tap(uv + vec2f(0, d.y))) * 2.0;
  s += tap(uv + d) + tap(uv - d) + tap(uv + vec2f(d.x, -d.y)) + tap(uv + vec2f(-d.x, d.y));
  return vec4f(s / 16.0 * k.z, 1.0);
}
`;

  // ---- composite: motion blur, chromatic shimmer, tone map, grain ---------------------
  const WGSL_COMP = WGSL_COMMON + /* wgsl */ `
struct C {
  res: vec2f, t: f32, frame: f32,
  bg: vec4f,               // linear background
  mA: vec4f, mB: vec4f,    // prev = A * cur (2x3 affine in uv space)
  look: vec4f,             // x exposure, y bloom, z haze, w grain
  look2: vec4f,            // x chroma, y vignette, z fade, w mbSamples
  tint: vec4f,             // flash colour (rgb) + amount
};
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var haze: texture_2d<f32>;
@group(0) @binding(3) var smp: sampler;
@group(0) @binding(4) var<uniform> c: C;
fn aces(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let cc = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (cc * x + d) + e), vec3f(0.0), vec3f(1.0));
}
fn toSrgb(x: vec3f) -> vec3f {
  let lo = x * 12.92; let hi = 1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, x <= vec3f(0.0031308));
}
fn sceneAt(uv: vec2f, ca: vec2f) -> vec3f {
  let r = textureSampleLevel(scene, smp, uv + ca, 0.0).r;
  let g = textureSampleLevel(scene, smp, uv, 0.0).g;
  let b = textureSampleLevel(scene, smp, uv - ca, 0.0).b;
  return vec3f(r, g, b);
}
@fragment fn fs(i: Full) -> @location(0) vec4f {
  let uv = i.uv;
  let fromC = uv - 0.5;
  let ca = fromC * c.look2.x * (0.4 + 2.0 * dot(fromC, fromC));
  // camera motion blur: sample the path this pixel travelled during the shutter
  let prev = vec2f(dot(c.mA.xyz, vec3f(uv, 1.0)), dot(c.mB.xyz, vec3f(uv, 1.0)));
  let vel = uv - prev;
  let n = i32(c.look2.w);
  var s = vec3f(0.0);
  if (n <= 1) {
    s = sceneAt(uv, ca);
  } else {
    let jitter = hash12(i.p.xy + c.frame) - 0.5;
    for (var k = 0; k < n; k++) {
      let f = (f32(k) + 0.5 + jitter * 0.5) / f32(n) - 0.5;
      s += sceneAt(uv + vel * f, ca);
    }
    s /= f32(n);
  }
  let bl = textureSampleLevel(bloom, smp, uv, 0.0).rgb;
  let hz = textureSampleLevel(haze, smp, uv, 0.0).rgb;
  var col = c.bg.rgb + hz * c.look.z + s + bl * c.look.y;
  col += c.tint.rgb * c.tint.a;
  col *= c.look.x;
  // vignette
  let v = smoothstep(1.15, 0.25, length(fromC * vec2f(1.0, 0.85)) * 1.25);
  col *= mix(1.0 - c.look2.y, 1.0, v);
  var o = aces(col);
  o = toSrgb(o);
  // film grain, strongest in the mid-tones, plus dither against banding
  let lum = dot(o, vec3f(0.299, 0.587, 0.114));
  let g1 = hash12(i.p.xy * 0.731 + vec2f(c.frame * 13.17, c.frame * 7.31)) - 0.5;
  let g2 = hash12(i.p.xy * 0.371 + vec2f(c.frame * 3.11, 91.7)) - 0.5;
  o += (g1 + g2) * c.look.w * (0.35 + lum * (1.0 - lum) * 2.0);
  o += (hash12(i.p.xy + 17.0 + c.frame) - 0.5) / 255.0;
  o *= c.look2.z;
  return vec4f(clamp(o, vec3f(0.0), vec3f(1.0)), 1.0);
}
`;

  class Renderer {
    async init(canvas, width, height, opts = {}) {
      if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('No WebGPU adapter found.');
      this.device = await adapter.requestDevice({
        requiredLimits: { maxBufferSize: Math.min(adapter.limits.maxBufferSize, 512 * 1024 * 1024) },
      });
      this.device.lost.then((info) => console.error('WebGPU device lost', info.message));
      this.canvas = canvas;
      this.W = width;
      this.H = height;
      this.S = width / 1920; // design -> pixels
      this.capture = !!opts.capture;
      canvas.width = width;
      canvas.height = height;
      this.ctx = canvas.getContext('webgpu');
      this.format = navigator.gpu.getPreferredCanvasFormat();
      this.ctx.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });

      // text layer canvas (2D, sRGB) uploaded as a texture each frame it is used
      this.textCanvas = new OffscreenCanvas(width, height);
      this.text = this.textCanvas.getContext('2d');
      this.textDirty = false;

      this.verts = new Float32Array(MAX_VERTS * FLOATS_PER_VERT);
      this.idx = new Uint32Array(MAX_VERTS * 1.5);
      this.nv = 0;
      this.ni = 0;
      this.clip = [0, 0, -1, -1];
      this.clipR = 0;
      this._build();
      return this;
    }

    _tex(w, h, format, usage) {
      return this.device.createTexture({ size: [w, h], format, usage });
    }

    _build() {
      const d = this.device;
      const W = this.W, H = this.H;
      const RT = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
      this.hdr = this._tex(W, H, 'rgba16float', RT);
      this.textTex = this._tex(W, H, 'rgba8unorm', GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT);
      this.hazeTex = this._tex(Math.ceil(W / 4), Math.ceil(H / 4), 'rgba16float', RT);
      this.mips = [];
      let mw = W, mh = H;
      for (let i = 0; i < 7; i++) {
        mw = Math.max(1, Math.ceil(mw / 2));
        mh = Math.max(1, Math.ceil(mh / 2));
        this.mips.push({ tex: this._tex(mw, mh, 'rgba16float', RT), w: mw, h: mh });
      }
      if (this.capture) {
        this.outTex = this._tex(W, H, 'rgba8unorm', GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC);
        this.readBuf = d.createBuffer({ size: W * H * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      }
      this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });

      const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
      const mod = (code) => d.createShaderModule({ code });

      // lines
      const lm = mod(WGSL_LINES);
      const f = 4;
      this.linePipe = d.createRenderPipeline({
        layout: 'auto',
        vertex: {
          module: lm, entryPoint: 'vs',
          buffers: [{
            arrayStride: FLOATS_PER_VERT * f,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x2' },
              { shaderLocation: 1, offset: 2 * f, format: 'float32x2' },
              { shaderLocation: 2, offset: 4 * f, format: 'float32x4' },
              { shaderLocation: 3, offset: 8 * f, format: 'float32x4' },
              { shaderLocation: 4, offset: 12 * f, format: 'float32x4' },
              { shaderLocation: 5, offset: 16 * f, format: 'float32x4' },
            ],
          }],
        },
        fragment: { module: lm, entryPoint: 'fs', targets: [{ format: 'rgba16float', blend: add }] },
        primitive: { topology: 'triangle-list' },
      });
      this.vbuf = d.createBuffer({ size: this.verts.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
      this.ibuf = d.createBuffer({ size: this.idx.byteLength, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
      this.lineU = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      d.queue.writeBuffer(this.lineU, 0, new Float32Array([this.W, this.H, this.S, 0]));
      this.lineBG = d.createBindGroup({ layout: this.linePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.lineU } }] });

      const full = (code, format, blend) => {
        const m = mod(code);
        return d.createRenderPipeline({
          layout: 'auto',
          vertex: { module: m, entryPoint: 'vfull' },
          fragment: { module: m, entryPoint: 'fs', targets: [{ format, blend }] },
          primitive: { topology: 'triangle-list' },
        });
      };
      this.textPipe = full(WGSL_TEXT, 'rgba16float', add);
      this.textU = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.textBG = d.createBindGroup({
        layout: this.textPipe.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: this.textTex.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: this.textU } }],
      });

      this.hazePipe = full(WGSL_HAZE, 'rgba16float');
      this.hazeU = d.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.hazeBG = d.createBindGroup({ layout: this.hazePipe.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: this.hazeU } }] });

      this.downPipe = full(WGSL_DOWN, 'rgba16float');
      this.upPipe = full(WGSL_UP, 'rgba16float', add);
      this.downU = [];
      this.downBG = [];
      this.upU = [];
      this.upBG = [];
      for (let i = 0; i < this.mips.length; i++) {
        const src = i === 0 ? this.hdr : this.mips[i - 1].tex;
        const sw = i === 0 ? this.W : this.mips[i - 1].w;
        const sh = i === 0 ? this.H : this.mips[i - 1].h;
        const u = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        d.queue.writeBuffer(u, 0, new Float32Array([1 / sw, 1 / sh, i === 0 ? 1 : 0, 0.9]));
        this.downU.push(u);
        this.downBG.push(d.createBindGroup({
          layout: this.downPipe.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: src.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: u } }],
        }));
      }
      for (let i = this.mips.length - 1; i > 0; i--) {
        const src = this.mips[i];
        const u = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.upU[i] = u;
        this.upBG[i] = d.createBindGroup({
          layout: this.upPipe.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: src.tex.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: u } }],
        });
      }

      this.compFormat = this.capture ? 'rgba8unorm' : this.format;
      this.compPipe = full(WGSL_COMP, this.compFormat);
      this.compU = d.createBuffer({ size: 128, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.compBG = d.createBindGroup({
        layout: this.compPipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.hdr.createView() },
          { binding: 1, resource: this.mips[0].tex.createView() },
          { binding: 2, resource: this.hazeTex.createView() },
          { binding: 3, resource: this.sampler },
          { binding: 4, resource: { buffer: this.compU } },
        ],
      });
    }

    // ---------------------------------------------------------------- per-frame geometry
    begin() {
      this.nv = 0;
      this.ni = 0;
      this.textDirty = false;
      this.text.setTransform(1, 0, 0, 1, 0, 0);
      this.text.clearRect(0, 0, this.W, this.H);
      this.noClip();
    }

    setClip(cx, cy, hw, hh, r) {
      // in design space, converted to pixels by the caller's transform
      this.clip = [cx, cy, hw, hh];
      this.clipR = r;
    }
    noClip() {
      this.clip = [0, 0, -1, -1];
      this.clipR = 0;
    }

    _v(x, y, ux, uy, r, g, b, halo, core, k, white) {
      const o = this.nv * FLOATS_PER_VERT;
      const v = this.verts;
      v[o] = x; v[o + 1] = y; v[o + 2] = ux; v[o + 3] = uy;
      v[o + 4] = r; v[o + 5] = g; v[o + 6] = b; v[o + 7] = halo;
      v[o + 8] = this.clip[0]; v[o + 9] = this.clip[1]; v[o + 10] = this.clip[2]; v[o + 11] = this.clip[3];
      v[o + 12] = core; v[o + 13] = k; v[o + 14] = white; v[o + 15] = 0;
      v[o + 16] = this.clipR; v[o + 17] = 0; v[o + 18] = 0; v[o + 19] = 0;
      return this.nv++;
    }

    // pts: flat [x0,y0,x1,y1,...] in PIXELS; w: core half-widths in pixels; col: [r,g,b] per point (HDR)
    // style: { glow: total half-width / core (>=1), soft: falloff, halo: halo strength, white: core whiteness }
    strip(pts, w, col, style) {
      const n = pts.length >> 1;
      if (n < 2) return;
      if (this.nv + n * 2 >= MAX_VERTS) return;
      const glow = style.glow, core = 1 / glow, k = style.soft, halo = style.halo, white = style.white;
      const base = this.nv;
      for (let i = 0; i < n; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
        let tx = pts[i1 * 2] - pts[i0 * 2], ty = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl; ty /= tl;
        let ww = w[i];
        let ci = i * 3;
        let fade = 1;
        if (ww < 0.7) { fade = Math.max(0, ww / 0.7); ww = 0.7; }
        const R = ww * glow;
        const x = pts[i * 2], y = pts[i * 2 + 1];
        const r = col[ci] * fade, g = col[ci + 1] * fade, b = col[ci + 2] * fade;
        this._v(x - ty * R, y + tx * R, -1, 0, r, g, b, halo, core, k, white);
        this._v(x + ty * R, y - tx * R, 1, 0, r, g, b, halo, core, k, white);
      }
      const I = this.idx;
      for (let i = 0; i < n - 1; i++) {
        const a = base + i * 2;
        I[this.ni++] = a; I[this.ni++] = a + 1; I[this.ni++] = a + 2;
        I[this.ni++] = a + 1; I[this.ni++] = a + 3; I[this.ni++] = a + 2;
      }
    }

    // round dot of light, centre/radius in pixels
    dot(x, y, rad, r, g, b, style) {
      if (this.nv + 4 >= MAX_VERTS) return;
      const glow = style.glow, R = Math.max(rad, 0.6) * glow;
      const a = this._v(x - R, y - R, -1, -1, r, g, b, style.halo, 1 / glow, style.soft, style.white);
      this._v(x + R, y - R, 1, -1, r, g, b, style.halo, 1 / glow, style.soft, style.white);
      this._v(x - R, y + R, -1, 1, r, g, b, style.halo, 1 / glow, style.soft, style.white);
      this._v(x + R, y + R, 1, 1, r, g, b, style.halo, 1 / glow, style.soft, style.white);
      const I = this.idx;
      I[this.ni++] = a; I[this.ni++] = a + 1; I[this.ni++] = a + 2;
      I[this.ni++] = a + 1; I[this.ni++] = a + 3; I[this.ni++] = a + 2;
    }

    // ---------------------------------------------------------------- frame submission
    // f: { t, frame, kick, haze:{c1,c2,amt}, cam:{x,y,zoom}, prevMat (uv affine A,B), exposure, bloom, grain,
    //      chroma, vignette, fade, mb (samples), tint:[r,g,b,a], textGain }
    async render(f) {
      const d = this.device;
      const enc = d.createCommandEncoder();
      const W = this.W, H = this.H;

      // haze
      d.queue.writeBuffer(this.hazeU, 0, new Float32Array([
        f.t, f.kick || 0, f.haze.amt, W / H,
        ...f.haze.c1, 0, ...f.haze.c2, 0,
        f.cam.x / 1920, f.cam.y / 1080, f.cam.zoom, 0,
      ]));
      {
        const p = enc.beginRenderPass({ colorAttachments: [{ view: this.hazeTex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        p.setPipeline(this.hazePipe); p.setBindGroup(0, this.hazeBG); p.draw(3); p.end();
      }

      // scene: text + strokes
      if (this.nv > 0) {
        d.queue.writeBuffer(this.vbuf, 0, this.verts, 0, this.nv * FLOATS_PER_VERT);
        d.queue.writeBuffer(this.ibuf, 0, this.idx, 0, Math.ceil(this.ni / 1) );
      }
      if (this.textDirty) {
        d.queue.copyExternalImageToTexture({ source: this.textCanvas }, { texture: this.textTex }, [W, H]);
        d.queue.writeBuffer(this.textU, 0, new Float32Array([f.textGain ?? 1.0, 0, 0, 0]));
      }
      {
        const p = enc.beginRenderPass({ colorAttachments: [{ view: this.hdr.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
        if (this.textDirty) { p.setPipeline(this.textPipe); p.setBindGroup(0, this.textBG); p.draw(3); }
        if (this.ni > 0) {
          p.setPipeline(this.linePipe); p.setBindGroup(0, this.lineBG);
          p.setVertexBuffer(0, this.vbuf); p.setIndexBuffer(this.ibuf, 'uint32');
          p.drawIndexed(this.ni);
        }
        p.end();
      }

      // bloom down
      for (let i = 0; i < this.mips.length; i++) {
        const p = enc.beginRenderPass({ colorAttachments: [{ view: this.mips[i].tex.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        p.setPipeline(this.downPipe); p.setBindGroup(0, this.downBG[i]); p.draw(3); p.end();
      }
      // bloom up (accumulate into the next-larger level)
      for (let i = this.mips.length - 1; i > 0; i--) {
        const src = this.mips[i];
        d.queue.writeBuffer(this.upU[i], 0, new Float32Array([1 / src.w, 1 / src.h, 0.85, 0]));
        const p = enc.beginRenderPass({ colorAttachments: [{ view: this.mips[i - 1].tex.createView(), loadOp: 'load', storeOp: 'store' }] });
        p.setPipeline(this.upPipe); p.setBindGroup(0, this.upBG[i]); p.draw(3); p.end();
      }

      // composite
      const A = f.prevMat || [1, 0, 0, 0, 1, 0];
      d.queue.writeBuffer(this.compU, 0, new Float32Array([
        W, H, f.t, f.frame,
        ...f.bg, 0,
        A[0], A[1], A[2], 0, A[3], A[4], A[5], 0,
        f.exposure, f.bloom, f.haze.vis ?? 1, f.grain,
        f.chroma, f.vignette, f.fade, f.mb,
        ...(f.tint || [0, 0, 0, 0]),
      ]));
      const target = this.capture ? this.outTex : this.ctx.getCurrentTexture();
      {
        const p = enc.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
        p.setPipeline(this.compPipe); p.setBindGroup(0, this.compBG); p.draw(3); p.end();
      }
      if (this.capture) {
        enc.copyTextureToBuffer({ texture: this.outTex }, { buffer: this.readBuf, bytesPerRow: W * 4 }, [W, H]);
      }
      d.queue.submit([enc.finish()]);
      if (this.capture) {
        await this.readBuf.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(this.readBuf.getMappedRange()).slice();
        this.readBuf.unmap();
        return bytes;
      }
      return null;
    }
  }

  LML.Renderer = Renderer;
})();
