// The mix: music bed + voiceover (music ducks under the voice) + subtle sound design, rendered offline
// with the Web Audio API so it is sample-exact and identical in the player and in the export.
(function () {
  const LML = (window.LML = window.LML || {});
  const SR = 48000;

  function noiseBuffer(ctx, seconds, seed) {
    const rnd = LML.Ink.mulberry32(seed);
    const b = ctx.createBuffer(2, Math.floor(seconds * ctx.sampleRate), ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    }
    return b;
  }

  function impulse(ctx, seconds, decay, seed) {
    const rnd = LML.Ink.mulberry32(seed);
    const n = Math.floor(seconds * ctx.sampleRate);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / ctx.sampleRate;
        const k = 0.15 + 0.8 * Math.min(1, t / seconds); // darker as it decays
        lp += ((rnd() * 2 - 1) - lp) * (1 - k * 0.9);
        d[i] = lp * Math.pow(1 - t / seconds, decay) * (t < 0.008 ? t / 0.008 : 1);
      }
    }
    return b;
  }

  // soft air whoosh peaking at time t (picture cut)
  function whoosh(ctx, out, noise, t, v, panFrom) {
    const len = 1.1, peak = 0.62;
    const t0 = t - peak;
    if (t0 < 0) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.1;
    bp.frequency.setValueAtTime(250, t0);
    bp.frequency.exponentialRampToValueAtTime(3200, t);
    bp.frequency.exponentialRampToValueAtTime(600, t0 + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16 * v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(panFrom, t0);
    p.pan.linearRampToValueAtTime(-panFrom, t0 + len);
    src.connect(bp).connect(g).connect(p).connect(out);
    src.start(t0, (t * 7.31) % 1.5, len + 0.05);
  }

  // glassy shimmer while light is being drawn: a few high partials on the current chord, tremolo, panned with the pen
  function shimmer(ctx, out, S, cue) {
    const { t, d, v, pan } = cue;
    const ch = S.chordAt(t + 0.05).cur;
    const root = ch.root;
    const steps = ch.name.endsWith('m') ? [0, 3, 7, 12, 15, 19] : [0, 4, 7, 12, 16, 19];
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(pan[0], t);
    p.pan.linearRampToValueAtTime(pan[1], t + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.022 * v, t + Math.min(0.25, d * 0.3));
    g.gain.setValueAtTime(0.022 * v, t + d * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.6);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    g.connect(hp).connect(p).connect(out);
    steps.forEach((s, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const midi = 84 + root + s;
      o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12) * (1 + (i % 2 ? 0.0015 : -0.001));
      const og = ctx.createGain();
      // each partial twinkles on its own
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5 + i * 1.7;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      og.gain.value = 0.5 / (1 + i * 0.35);
      lfo.connect(lg).connect(og.gain);
      o.connect(og).connect(g);
      o.start(t); o.stop(t + d + 0.7);
      lfo.start(t); lfo.stop(t + d + 0.7);
    });
  }

  // tiny tactile click for the play press
  function click(ctx, out, t) {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(2400, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.03);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 0.06);
  }

  // music, voice: AudioBuffers; vo: map of id -> AudioBuffer
  async function render(S, music, vo, opts = {}) {
    const dur = S.DURATION;
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
    const master = ctx.createGain();
    master.gain.value = opts.master ?? 1.0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -6; comp.knee.value = 6; comp.ratio.value = 3; comp.attack.value = 0.004; comp.release.value = 0.15;
    master.connect(comp).connect(ctx.destination);

    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 2.6, 2.4, 7);
    const verbRet = ctx.createGain();
    verbRet.gain.value = 0.5;
    verb.connect(verbRet).connect(master);

    // music + duck
    const mus = ctx.createBufferSource();
    mus.buffer = music;
    const musG = ctx.createGain();
    const duck = ctx.createGain();
    const MUSIC = opts.music ?? 0.9, DUCK = opts.duck ?? 0.5; // ~ -6 dB under the voice
    musG.gain.value = MUSIC;
    duck.gain.setValueAtTime(1, 0);
    // merge voice windows, then ramp down 120 ms before speech and back up 300 ms after
    const wins = [];
    for (const v of S.voList) {
      const a = v.start - 0.12, b = v.end + 0.3;
      if (wins.length && a <= wins[wins.length - 1][1] + 0.35) wins[wins.length - 1][1] = Math.max(wins[wins.length - 1][1], b);
      else wins.push([a, b]);
    }
    for (const [a, b] of wins) {
      duck.gain.setTargetAtTime(DUCK, Math.max(0, a), 0.04);
      duck.gain.setTargetAtTime(1, b, 0.12);
    }
    mus.connect(musG).connect(duck).connect(master);
    mus.start(0);

    // voice: gentle high-pass, presence, a touch of room
    const vbus = ctx.createGain();
    vbus.gain.value = opts.voice ?? 1.0;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 85;
    const pres = ctx.createBiquadFilter(); pres.type = 'peaking'; pres.frequency.value = 3200; pres.Q.value = 0.8; pres.gain.value = 2.0;
    const air = ctx.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = 1.5;
    const vcomp = ctx.createDynamicsCompressor();
    vcomp.threshold.value = -20; vcomp.knee.value = 8; vcomp.ratio.value = 3; vcomp.attack.value = 0.005; vcomp.release.value = 0.12;
    vbus.connect(hp).connect(pres).connect(air).connect(vcomp);
    vcomp.connect(master);
    const vsend = ctx.createGain(); vsend.gain.value = 0.07;
    vcomp.connect(vsend).connect(verb);
    for (const v of S.voList) {
      const b = vo[v.id];
      if (!b) continue;
      const s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(vbus);
      s.start(v.start);
    }

    // sound design
    const sfx = ctx.createGain();
    sfx.gain.value = opts.sfx ?? 1.0;
    sfx.connect(master);
    const sfxSend = ctx.createGain(); sfxSend.gain.value = 0.5;
    sfx.connect(sfxSend).connect(verb);
    const noise = noiseBuffer(ctx, 3, 99);
    S.whoosh.forEach((w, i) => whoosh(ctx, sfx, noise, w.t, w.v, i % 2 ? 0.5 : -0.5));
    S.shimmer.forEach((c) => shimmer(ctx, sfx, S, c));
    click(ctx, sfx, S.firstDrop - 0.012);

    const buf = await ctx.startRendering();
    // final peak safety (-1 dBFS)
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    }
    const k = peak > 0.891 ? 0.891 / peak : 1;
    if (k < 1) for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] *= k; }
    return buf;
  }

  function toWav(buf) {
    const n = buf.length, ch = buf.numberOfChannels;
    const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
    out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
    out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * ch * 2, true);
    out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * ch * 2, true);
    const data = [];
    for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    let o = 44;
    // TPDF dither to 16 bit
    const rnd = LML.Ink.mulberry32(5);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const x = data[c][i] * 32767 + (rnd() - rnd());
        out.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x))), true);
        o += 2;
      }
    }
    return out.buffer;
  }

  LML.Audio = { render, toWav, SR };
})();
