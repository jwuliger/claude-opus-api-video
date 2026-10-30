// The score: one timeline shared by the sound and the pictures.
// Musical events come from assets/music/analysis.json (the real track, analysed by tools/analyze_music.py);
// voiceover words come from Whisper timings. Picture and sound read the same numbers, so every pulse,
// colour change and word lands exactly where it is heard.
(function () {
  const LML = (window.LML = window.LML || {});

  // Colour for each chord root (pitch class). Electric blue is home; warm accents arrive with the changes.
  const ROOT_COLOR = {
    2: '#8cb4ff',  // D  - home blue
    5: '#ffc766',  // F  - amber
    0: '#5aebff',  // C  - cyan
    7: '#ff5fd7',  // G  - magenta
    9: '#a98bff',  // A  - violet
    4: '#ff8f8f',  // E  - coral
    11: '#a8f0d4', // B  - mint
  };

  // Film sections (film time, seconds). Bars come from the analysed grid.
  // bar i starts at downbeats[i]; bar 0 = intro, bar 1 = the drop.
  function sectionsFromBars(db, end) {
    const at = (i) => db[Math.min(i, db.length - 1)];
    return [
      { name: 'silence', t0: 0, t1: 1.5 },
      { name: 'intro', label: 'Intro', t0: 1.5, t1: at(1) },
      { name: 'verse', label: 'Verse', t0: at(1), t1: at(8) },
      { name: 'pre', label: 'Pre-chorus', t0: at(8), t1: at(9) },
      { name: 'chorus', label: 'Chorus', t0: at(9), t1: at(10) },
      { name: 'seeds', label: 'Chorus', t0: at(10), t1: at(14) },
      { name: 'formats', label: 'Chorus', t0: at(14), t1: at(15) },
      { name: 'break', label: 'Bridge', t0: at(15), t1: at(16) },
      { name: 'pack', label: 'Chorus', t0: at(16), t1: at(18) },
      { name: 'finale', label: 'Chorus', t0: at(18), t1: at(20) },
      { name: 'end', label: 'Outro', t0: at(20), t1: end },
    ];
  }

  function norm(w) { return w.toLowerCase().replace(/[^a-z0-9']/g, ''); }

  function init(A, manifest) {
    const DURATION = A.duration;
    const BEAT = A.beat, BAR = BEAT * 4;
    const db = A.downbeats;
    const bar = (i, beat = 0) => db[i] + beat * BEAT;
    const firstDrop = db[1];

    const pulses = A.pulses.filter((p) => p.t >= firstDrop - 0.01);
    const snare = A.snares.filter((p) => p.t >= firstDrop - 0.01).map((e) => ({ t: e.at, v: e.v }));
    const hat = A.hats.filter((p) => p.t >= firstDrop - 0.01).map((e) => ({ t: e.at, v: e.v }));
    const chords = A.chords.map((c, i, arr) => ({
      t: c.t, name: c.name, root: c.root, end: i + 1 < arr.length ? arr[i + 1].t : DURATION,
      color: ROOT_COLOR[c.root] || '#8cb4ff',
    }));
    chords[0].t = 0;

    // Voiceover placement: by a start time, after another clip, or so that one word lands on a musical moment.
    const PLACE = [
      { id: 'vo01', at: 0.45 },
      { id: 'vo02', after: 'vo01', gap: 0.3 },
      { id: 'vo03', at: bar(1, 1.5) },
      { id: 'vo04', word: 'beat', at: bar(3, 1) },
      { id: 'vo05', word: 'change', at: bar(4, 0) },
      { id: 'vo06', at: bar(7, 0) + 0.15 },
      { id: 'lyric', word: 'light', at: bar(9, 0) },
      { id: 'vo07', at: bar(10, 0) + 0.2 },
      { id: 'vo08', after: 'vo07', gap: 0.35 },
      { id: 'vo09', at: bar(13, 0) + 0.2 },
      { id: 'vo10', word: 'wide', at: bar(14, 0) + 0.12 },
      { id: 'vo11', at: bar(16, 0) + 0.25 },
      { id: 'vo12', at: bar(18, 0) + 0.3 },
      { id: 'vo13', at: bar(20, 0) + 0.9 },
      { id: 'vo14', after: 'vo13', gap: 0.45 },
    ];
    const vo = {};
    for (const p of PLACE) {
      const m = manifest[p.id];
      if (!m) continue;
      let start;
      if (p.word) {
        const w = m.words.find((x) => norm(x.w).startsWith(p.word));
        start = p.at - (w ? w.s : 0);
      } else if (p.after) start = vo[p.after] ? vo[p.after].end + p.gap : p.at;
      else start = p.at;
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
      return v.words.filter((w) => w.k.startsWith(k))[nth] || null;
    };

    // Sound design cues (picture-driven), on the same clock.
    const whoosh = [bar(10), bar(11), bar(12), bar(13), bar(14), bar(16), bar(18), bar(20)].map((t) => ({ t, v: 0.7 }));
    const tall = word('vo10', 'tall'), square = word('vo10', 'square');
    if (tall) whoosh.push({ t: tall.s, v: 0.45 });
    if (square) whoosh.push({ t: square.s, v: 0.45 });
    whoosh.sort((a, b) => a.t - b.t);
    const shimmer = [
      { t: 0.3, d: 3.6, v: 0.75, pan: [0.5, -0.1] },
      { t: firstDrop, d: 1.6, v: 0.55, pan: [-0.6, 0.6] },
      { t: bar(2), d: 1.4, v: 0.35, pan: [-0.5, 0.5] },
      { t: bar(20), d: 1.6, v: 0.7, pan: [-0.2, 0.2] },
      { t: bar(20) + 1.4, d: 1.2, v: 0.45, pan: [-0.3, 0.3] },
    ];
    if (vo.lyric) for (const w of vo.lyric.words) shimmer.push({ t: w.s, d: Math.max(0.3, w.e - w.s + 0.15), v: 0.5, pan: [-0.2, 0.2] });
    const getW = word('vo14', 'get');
    if (getW) shimmer.push({ t: getW.s, d: 0.8, v: 0.5, pan: [-0.3, 0.3] });

    const envs = A.env;
    const envAt = (name, t) => {
      const a = envs[name];
      const x = t * A.env_fps;
      const i = Math.floor(x), f = x - i;
      if (i < 0) return a[0];
      if (i >= a.length - 1) return a[a.length - 1];
      return a[i] * (1 - f) + a[i + 1] * f;
    };

    const sections = sectionsFromBars(db, DURATION);

    const S = {
      DURATION, BEAT, BAR, BPM: A.bpm, db, bar, firstDrop, pulses, snare, hat, chords, vo, voList, word, whoosh, shimmer, sections,
      envAt,
      section(t) { for (const s of sections) if (t >= s.t0 && t < s.t1) return s; return sections[sections.length - 1]; },
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
      recent(list, t, window) {
        const out = [];
        for (let i = list.length - 1; i >= 0; i--) {
          const dt = t - list[i].t;
          if (dt < 0) continue;
          if (dt > window) break;
          out.push(list[i]);
        }
        return out;
      },
      chordAt(t) {
        let i = 0;
        while (i + 1 < chords.length && chords[i + 1].t <= t) i++;
        return { cur: chords[i], prev: chords[Math.max(0, i - 1)], since: t - chords[i].t, index: i };
      },
      beatPhase(t) { const x = (t - db[0]) / BEAT; return x - Math.floor(x); },
      beatInBar(t) { const x = Math.floor((t - db[0]) / BEAT + 1e-6); return ((x % 4) + 4) % 4; },
      barIndex(t) { let i = 0; while (i + 1 < db.length && db[i + 1] <= t) i++; return i; },
    };
    return S;
  }

  LML.Score = { init };
})();
