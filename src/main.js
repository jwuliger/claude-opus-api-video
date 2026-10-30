// Boot: load assets, build the score and the film, then either play it (with sound) or render it frame by frame.
(async function () {
  const LML = window.LML;
  const qs = new URLSearchParams(location.search);
  const RENDER = qs.has('render');
  const W = +qs.get('w') || 1920, H = +qs.get('h') || 1080;
  const FPS = +qs.get('fps') || 60;
  const SHUTTER = qs.has('shutter') ? +qs.get('shutter') : 0.5 / FPS;
  const ui = document.getElementById('ui');
  const status = (s) => { const el = document.getElementById('status'); if (el) el.textContent = s; };

  const b64ToBuf = (b) => { const s = atob(b); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  const FONT_FILES = {
    anton: ['Anton', 400, 'Anton-Regular.ttf'],
    sg400: ['Space Grotesk', 400, 'SpaceGrotesk-Regular.ttf'],
    sg500: ['Space Grotesk', 500, 'SpaceGrotesk-Medium.ttf'],
    mont400: ['Montserrat', 400, 'Montserrat-Regular.ttf'],
    mont700: ['Montserrat', 700, 'Montserrat-Bold.ttf'],
  };

  // Assets are inlined by tools/build.mjs (window.LML_ASSETS), or fetched from ../assets in development.
  async function loadAssets() {
    const inl = window.LML_ASSETS;
    const get = async (p, type) => {
      if (inl) {
        const v = inl[p];
        if (v === undefined) throw new Error('missing asset ' + p);
        return type === 'json' ? JSON.parse(atob(v)) : b64ToBuf(v);
      }
      const r = await fetch('../assets/' + p);
      if (!r.ok) throw new Error('missing asset ' + p);
      return type === 'json' ? r.json() : r.arrayBuffer();
    };
    const fonts = {};
    for (const [k, [family, weight, file]] of Object.entries(FONT_FILES)) fonts[k] = { family, weight, data: await get('fonts/' + file) };
    const analysis = await get('music/analysis.json', 'json');
    const manifest = await get('vo/manifest.json', 'json');
    const logo = await get('brand/logo-mark.json', 'json');
    const voData = {};
    for (const id of Object.keys(manifest)) voData[id] = await get(`vo/${id}.wav`);
    const music = await get('music/edit.flac');
    return { fonts, analysis, manifest, logo, voData, music };
  }

  let A;
  try {
    status('Loading…');
    A = await loadAssets();
  } catch (e) {
    status('Could not load assets: ' + e.message);
    throw e;
  }
  await LML.Text.load(A.fonts);
  const S = LML.Score.init(A.analysis, A.manifest);
  const canvas = document.getElementById('film');
  const R = new LML.Renderer();
  try {
    await R.init(canvas, W, H, { capture: RENDER });
  } catch (e) {
    status('This film is drawn live with WebGPU. Please open it in a recent Chrome, Edge or Safari. (' + e.message + ')');
    throw e;
  }
  const film = new LML.Film(R, S, A);
  window.__film = film;

  async function mixAudio() {
    const ac = new OfflineAudioContext(2, 48000, 48000);
    const music = await ac.decodeAudioData(A.music.slice(0));
    const vo = {};
    for (const [id, buf] of Object.entries(A.voData)) vo[id] = await ac.decodeAudioData(buf.slice(0));
    return LML.Audio.render(S, music, vo);
  }

  // camera motion blur: map this frame's pixels to where they were half a frame ago (180 degree shutter)
  function prevMatrix(t, shutter) {
    const tp = t - shutter;
    const cut = film.cuts.some((c) => c > tp && c <= t);
    if (tp < 0 || cut) return { A: [1, 0, 0, 0, 1, 0], px: 0 };
    const Mc = LML.Ink.camMatrix(film.camera(t), R.S);
    const Mp = LML.Ink.camMatrix(film.camera(tp), R.S);
    const N = LML.Ink.multiply(Mp, LML.Ink.invert(Mc));
    const a = N[0], b = N[1], c = N[2], d = N[3], e = N[4], f = N[5];
    let px = 0;
    for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H], [W / 2, H / 2]]) {
      px = Math.max(px, Math.hypot(a * x + c * y + e - x, b * x + d * y + f - y));
    }
    return { A: [a, c * H / W, e / W, b * W / H, d, f / H], px };
  }

  async function drawAt(t, frameNo, shutter) {
    const post = film.frame(t);
    const pm = prevMatrix(t, shutter);
    post.prevMat = pm.A;
    post.mb = pm.px > 1.5 ? Math.min(16, Math.ceil(pm.px / 2.5) + 2) : 1;
    post.t = t;
    post.frame = frameNo;
    post.bg = LML.Ink.hex('#05070b');
    return R.render(post);
  }

  // ------------------------------------------------------------------ render mode (driven by tools/render.mjs)
  if (RENDER) {
    const server = qs.get('server');
    window.__info = { adapter: R.adapterInfo, duration: S.DURATION };
    window.__renderAudio = async () => {
      const buf = await mixAudio();
      const wav = LML.Audio.toWav(buf);
      await fetch(server + '/audio', { method: 'POST', body: wav });
      return true;
    };
    window.__renderFrames = async (from, to) => {
      let pending = null;
      for (let i = from; i < to; i++) {
        const bytes = await drawAt(i / FPS, i, SHUTTER);
        if (pending) await pending;
        pending = fetch(`${server}/frame?i=${i}`, { method: 'POST', body: bytes }).then((r) => { if (!r.ok) throw new Error('frame rejected'); });
      }
      if (pending) await pending;
      return true;
    };
    window.__still = async (t) => { await drawAt(t, Math.round(t * FPS), 0.5 / FPS); return true; };
    window.__ready = true;
    status('');
    return;
  }

  // ------------------------------------------------------------------ player
  status('Preparing sound…');
  const mix = await mixAudio();
  let ac = null, src = null, startedAt = 0, offset = 0, playing = false;
  const playBtn = document.getElementById('play');
  const bar = document.getElementById('bar');
  status('');
  ui.classList.add('ready');

  const now = () => (playing ? ac.currentTime - startedAt - (ac.outputLatency || 0) : offset);
  function start(at) {
    if (!ac) ac = new AudioContext({ sampleRate: 48000, latencyHint: 'playback' });
    if (src) { try { src.stop(); } catch (e) { /* already stopped */ } }
    src = ac.createBufferSource();
    src.buffer = mix;
    src.connect(ac.destination);
    startedAt = ac.currentTime + 0.05 - at;
    src.start(ac.currentTime + 0.05, at);
    src.onended = () => { if (playing && now() >= S.DURATION - 0.1) { playing = false; offset = S.DURATION; ui.classList.remove('playing'); ui.classList.add('ended'); } };
    playing = true;
    ui.classList.add('playing');
    ui.classList.remove('ended');
  }
  function pause() { if (!playing) return; offset = now(); playing = false; src.stop(); ui.classList.remove('playing'); }
  function toggle() { if (playing) pause(); else start(offset >= S.DURATION - 0.05 ? 0 : offset); }
  playBtn.addEventListener('click', toggle);
  canvas.addEventListener('click', toggle);
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
    if (e.key === 'r') { offset = 0; start(0); }
    if (e.key === 'f') document.documentElement.requestFullscreen?.();
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const t = Math.max(0, Math.min(S.DURATION - 0.1, now() + (e.key === 'ArrowRight' ? 5 : -5)));
      if (playing) start(t); else offset = t;
    }
  });
  document.getElementById('scrub').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - r.left) / r.width) * S.DURATION;
    if (playing) start(t); else offset = t;
    e.stopPropagation();
  });

  let busy = false, frameNo = 0;
  async function loop() {
    requestAnimationFrame(loop);
    if (busy) return;
    busy = true;
    const t = Math.min(S.DURATION, Math.max(0, now()));
    bar.style.width = `${(t / S.DURATION) * 100}%`;
    await drawAt(t, frameNo++, 1 / 120);
    busy = false;
  }
  requestAnimationFrame(loop);
})();
