// The score: one timeline shared by the music synth and the visuals.
// Every drum hit, chord change and spoken word is defined here once, so picture and sound
// are driven by the same numbers (sample-exact in the audio, frame-exact in the video).
(function () {
  const LML = (window.LML = window.LML || {});

  const BPM = 96;
  const BEAT = 60 / BPM;   // 0.625 s
  const BAR = BEAT * 4;    // 2.5 s
  const DURATION = 57.0;
  const bt = (bar, beat = 0) => bar * BAR + beat * BEAT;

  // D minor. Each chord: bass root (MIDI), pad voicing (MIDI), and the colour it paints.
  const CHORDS = {
    Dm: { root: 38, pad: [50, 57, 62, 65, 69, 76], color: '#8cb4ff' },
    Bb: { root: 34, pad: [46, 53, 58, 62, 65, 72], color: '#ff5fd7' },
    F:  { root: 41, pad: [48, 53, 57, 60, 65, 72], color: '#ffc766' },
    C:  { root: 36, pad: [48, 55, 60, 64, 67, 74], color: '#5aebff' },
    Gm: { root: 43, pad: [50, 55, 58, 62, 67, 74], color: '#8f7bff' },
    A:  { root: 45, pad: [49, 52, 57, 61, 64, 73], color: '#ff8f8f' },
  };
  const PROG = [
    [0, 0, 'Dm'], [3, 0, 'Bb'], [4, 0, 'F'], [5, 0, 'C'], [6, 0, 'Gm'], [6, 2, 'A'],
    [7, 0, 'Bb'], [8, 0, 'F'], [8, 2, 'C'], [9, 0, 'Dm'], [10, 0, 'Bb'], [11, 0, 'F'], [12, 0, 'C'],
    [13, 0, 'Dm'], [14, 0, 'Bb'], [15, 0, 'F'], [16, 0, 'Gm'], [17, 0, 'A'],
    [18, 0, 'Dm'], [19, 0, 'Bb'], [20, 0, 'F'], [21, 0, 'C'], [22, 0, 'Dm'],
  ];

  // Section of each bar -> drum pattern + visual "look"
  const BAR_SECTION = [
    'intro', 'intro', 'lite', 'lite', 'verse', 'verse', 'pre', 'chorus', 'chorus',
    'seeds', 'seeds', 'seeds', 'seeds', 'formats', 'formats', 'pack', 'pack', 'build',
    'end', 'heart', 'heart', 'heart', 'outro',
  ];
  const SECTION_LABEL = { intro: 'Intro', lite: 'Verse', verse: 'Verse', pre: 'Pre-chorus', chorus: 'Chorus' };

  function buildDrums() {
    const kick = [], snare = [], hat = [], crash = [], roll = [];
    for (let b = 0; b < BAR_SECTION.length; b++) {
      const s = BAR_SECTION[b];
      const K = (x, v = 1) => kick.push({ t: bt(b, x), v });
      const Sn = (x, v = 1) => snare.push({ t: bt(b, x), v });
      const H = (x, v = 1, open = false) => hat.push({ t: bt(b, x), v, open });
      if (s === 'lite') {
        K(0, 0.85); K(2, 0.8);
        if (b === 3) { Sn(1, 0.45); Sn(3, 0.5); }
        for (let i = 0; i < 8; i++) H(i * 0.5, i % 2 ? 0.55 : 0.3);
      } else if (s === 'verse' || s === 'pack' || s === 'formats') {
        K(0); K(2); K(2.75, 0.75);
        Sn(1); Sn(3);
        for (let i = 0; i < 8; i++) H(i * 0.5, i % 2 ? 0.7 : 0.4, i === 7 && (b % 2 === 1));
        if (s !== 'verse') { H(1.75, 0.25); H(3.25, 0.25); }
      } else if (s === 'pre') {
        K(0); K(2, 0.8);
        Sn(1, 0.9);
        for (let i = 0; i < 8; i++) { const x = 2 + i * 0.25; roll.push({ t: bt(b, x), v: 0.25 + 0.6 * (i / 7) }); }
        for (let i = 0; i < 4; i++) H(i * 0.5, 0.4);
      } else if (s === 'chorus' || s === 'seeds') {
        K(0); K(1.75, 0.7); K(2); K(2.75, 0.75);
        Sn(1); Sn(3);
        for (let i = 0; i < 16; i++) H(i * 0.25, i % 4 === 2 ? 0.75 : i % 2 ? 0.28 : 0.45);
      } else if (s === 'build') {
        for (let i = 0; i < 4; i++) K(i, i === 3 ? 0.7 : 0.9);
        for (let i = 0; i < 14; i++) roll.push({ t: bt(b, i * 0.25), v: 0.25 + 0.75 * (i / 13) });
        for (let i = 0; i < 7; i++) H(i * 0.5, 0.35 + i * 0.06);
      } else if (s === 'heart') {
        K(0, 0.55); K(0.75, 0.32);
      }
    }
    // crashes on the big downbeats (scene changes)
    for (const b of [7, 9, 10, 11, 13, 15, 18]) crash.push({ t: bt(b), v: b === 18 ? 1 : 0.7 });
    return { kick, snare, hat, crash, roll };
  }

  function norm(w) { return w.toLowerCase().replace(/[^a-z0-9']/g, ''); }

  function init(manifest) {
    const drums = buildDrums();
    const chords = PROG.map(([b, x, name]) => ({ t: bt(b, x), name, ...CHORDS[name] }));
    for (let i = 0; i < chords.length; i++) chords[i].end = i + 1 < chords.length ? chords[i + 1].t : DURATION;

    // Voiceover placement. A clip is placed by a start time, or so that one of its words lands on a beat.
    const PLACE = [
      { id: 'vo01', at: 0.75 },
      { id: 'vo02', after: 'vo01', gap: 0.45 },
      { id: 'vo03', at: 6.25 },
      { id: 'vo04', word: 'beat', at: bt(4, 1) },
      { id: 'vo05', word: 'change', at: bt(5, 0) },
      { id: 'vo06', at: bt(6, 0) + 0.2 },
      { id: 'lyric', word: 'light', at: bt(8, 0) },
      { id: 'vo07', at: bt(9, 0) + 0.25 },
      { id: 'vo08', after: 'vo07', gap: 0.35 },
      { id: 'vo09', at: bt(12, 0) + 0.15 },
      { id: 'vo10', word: 'wide', at: bt(13, 0) + 0.1 },
      { id: 'vo11', at: bt(15, 0) + 0.2 },
      { id: 'vo12', at: bt(18, 0) + 0.6 },
      { id: 'vo13', after: 'vo12', gap: 0.5 },
    ];
    const vo = {};
    for (const p of PLACE) {
      const m = manifest[p.id];
      if (!m) continue;
      let start;
      if (p.word) {
        const w = m.words.find((x) => norm(x.w) === p.word);
        start = p.at - (w ? w.s : 0);
      } else if (p.after) {
        start = vo[p.after].end + p.gap;
      } else start = p.at;
      vo[p.id] = {
        id: p.id, start, end: start + m.dur, dur: m.dur, text: m.text,
        words: m.words.map((w) => ({ w: w.w, k: norm(w.w), s: start + w.s, e: start + w.e })),
      };
    }
    const voList = Object.values(vo).sort((a, b) => a.start - b.start);
    for (let i = 1; i < voList.length; i++) {
      if (voList[i].start < voList[i - 1].end + 0.05) console.warn('VO overlap', voList[i - 1].id, voList[i].id);
    }
    const word = (id, k, nth = 0) => {
      const v = vo[id];
      if (!v) return null;
      const all = v.words.filter((w) => w.k === k);
      return all[nth] || null;
    };

    // Sound design cues, placed on the same clock as the pictures that cause them.
    const whoosh = [bt(9), bt(10), bt(11), bt(12), bt(13), bt(15), bt(18) - 0.05].map((t) => ({ t, v: 0.8 }));
    const tall = word('vo10', 'tall'), square = word('vo10', 'square');
    if (tall) whoosh.push({ t: tall.s, v: 0.5 });
    if (square) whoosh.push({ t: square.s, v: 0.5 });
    const risers = [{ t0: 2.9, t1: bt(2) }, { t0: bt(6), t1: bt(7) }, { t0: bt(17), t1: bt(18) }];
    const impacts = [{ t: bt(2), v: 0.55 }, { t: bt(18), v: 1 }];
    const reverse = [bt(2), bt(7), bt(9), bt(18)];
    // shimmer = the faint sound of light being drawn
    const shimmer = [
      { t: 0.35, d: 3.9, v: 0.8, pan: [0.5, -0.1] },
      { t: bt(2), d: 1.5, v: 0.7, pan: [-0.6, 0.6] },
      { t: bt(3), d: 1.6, v: 0.45, pan: [-0.5, 0.5] },
      { t: bt(15), d: 1.8, v: 0.5, pan: [-0.4, 0.4] },
      { t: bt(18) + 0.15, d: 1.6, v: 0.8, pan: [-0.2, 0.2] },
      { t: bt(18) + 1.3, d: 1.2, v: 0.5, pan: [-0.3, 0.3] },
    ];
    if (vo.lyric) for (const w of vo.lyric.words) shimmer.push({ t: w.s, d: Math.max(0.3, w.e - w.s + 0.15), v: 0.55, pan: [-0.2, 0.2] });
    const access = word('vo13', 'get');
    if (access) shimmer.push({ t: access.s, d: 0.8, v: 0.6, pan: [-0.3, 0.3] });

    const S = {
      BPM, BEAT, BAR, DURATION, bt, chords, drums, vo, voList, word, whoosh, risers, impacts, reverse, shimmer,
      section(t) { return BAR_SECTION[Math.max(0, Math.min(BAR_SECTION.length - 1, Math.floor(t / BAR)))]; },
      sectionLabel(t) { return SECTION_LABEL[this.section(t)] || ''; },
      // decaying envelope of the most recent events (fast attack, exponential decay)
      env(list, t, decay = 0.2, attack = 0.006) {
        let v = 0;
        for (let i = list.length - 1; i >= 0; i--) {
          const e = list[i];
          const dt = t - e.t;
          if (dt < 0) continue;
          if (dt > decay * 8) break;
          v += (e.v ?? 1) * Math.min(1, dt / attack) * Math.exp(-dt / decay);
        }
        return v;
      },
      lastBefore(list, t) {
        let r = null;
        for (const e of list) { if (e.t <= t) r = e; else break; }
        return r;
      },
      chordAt(t) {
        let i = 0;
        while (i + 1 < chords.length && chords[i + 1].t <= t) i++;
        return { cur: chords[i], prev: chords[Math.max(0, i - 1)], since: t - chords[i].t, index: i };
      },
      beatIndex(t) { return Math.floor(t / BEAT + 1e-6); },
    };
    return S;
  }

  LML.Score = { init, BPM, BEAT, BAR, DURATION };
})();
