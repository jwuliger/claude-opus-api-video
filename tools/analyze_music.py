"""Analyse the (edited) music bed for the film: beat grid, drum hits, chords, energy envelopes.

Usage:
    python tools/analyze_music.py assets/music/edit.wav --plot out/analysis.png

Writes assets/music/analysis.json in FILM time. The video reads this file, so every light pulse and colour
change follows the real track.
"""
import argparse
import json
import pathlib

import librosa
import numpy as np
import scipy.signal as sig

ROOT = pathlib.Path(__file__).resolve().parent.parent
SR = 48000
HOP = 120  # 2.5 ms
NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def bandpass_env(y, lo, hi, smooth=0.012):
    sos = sig.butter(4, [lo, hi], btype="band", fs=SR, output="sos") if lo > 0 else sig.butter(4, hi, btype="low", fs=SR, output="sos")
    b = sig.sosfiltfilt(sos, y)
    e = np.sqrt(sig.sosfiltfilt(sig.butter(2, 1 / smooth, fs=SR, output="sos"), b * b).clip(0))
    return e


def flux(y, lo, hi):
    S = np.abs(librosa.stft(y, n_fft=1024, hop_length=HOP)) ** 2
    f = librosa.fft_frequencies(sr=SR, n_fft=1024)
    band = np.log1p(S[(f >= lo) & (f < hi)] * 1e3)
    fl = np.maximum(0, np.diff(band, axis=1, prepend=band[:, :1])).sum(axis=0)
    return fl / (np.percentile(fl, 99.7) + 1e-9)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--plot")
    ap.add_argument("--period", type=float, default=0.61602)
    ap.add_argument("--downbeat", type=float, default=4.125)  # first downbeat in film time (from edit_music.py)
    a = ap.parse_args()

    y2, _ = librosa.load(a.audio, sr=SR, mono=False)
    y = librosa.to_mono(y2)
    dur = len(y) / SR
    yh, yp = librosa.effects.hpss(y, margin=(1.0, 3.0))
    P = a.period

    # ---- grid refinement against percussive onsets
    oenv = librosa.onset.onset_strength(y=yp, sr=SR, hop_length=HOP)
    otimes = librosa.frames_to_time(np.arange(len(oenv)), sr=SR, hop_length=HOP)
    best = None
    for dp in np.arange(-0.0006, 0.00061, 0.0001):
        for off in np.arange(-0.05, 0.0501, 0.0025):
            b = a.downbeat + off + np.arange(-6, 100) * (P + dp)
            b = b[(b > 0.05) & (b < dur - 0.05)]
            s = np.interp(b, otimes, oenv).sum()
            if best is None or s > best[0]:
                best = (s, off, dp)
    _, off, dp = best
    P = P + dp
    d0 = a.downbeat + off
    nb_before = int(np.floor((d0 - 0.0) / P))
    beats = d0 + np.arange(-nb_before, int((dur - d0) / P) + 1) * P
    beats = beats[(beats >= 0) & (beats < dur)]
    downbeats = beats[np.isclose(((beats - d0) / P) % 4, 0, atol=1e-3) | np.isclose(((beats - d0) / P) % 4, 4, atol=1e-3)]

    # ---- drum hits on the 16th grid
    kf = flux(yp, 25, 130)
    sf_ = flux(yp, 1200, 6000)
    hf = flux(yp, 7000, 18000)
    slots = d0 + np.arange(-nb_before * 4, int((dur - d0) / (P / 4)) + 1) * (P / 4)
    slots = slots[(slots >= 0) & (slots < dur)]

    def strength(env, t):
        i = int(t / (HOP / SR))
        w0, w1 = max(0, i - int(0.03 / (HOP / SR))), i + int(0.045 / (HOP / SR))
        seg = env[w0:w1]
        j = int(np.argmax(seg))
        return float(seg[j]), float((w0 + j) * HOP / SR)

    rows = []
    for t in slots:
        ks, kt = strength(kf, t)
        ss, st = strength(sf_, t)
        hs, ht = strength(hf, t)
        rows.append((t, ks, kt, ss, st, hs, ht))
    rows = np.array(rows)

    def events(col_s, col_t, rel, absmin):
        # adaptive threshold: relative to the loudest hits in the surrounding two bars
        out = []
        for i, r in enumerate(rows):
            lo, hi = max(0, i - 16), min(len(rows), i + 16)
            ref = np.percentile(rows[lo:hi, col_s], 95)
            if r[col_s] > max(absmin, rel * ref):
                out.append(dict(t=round(float(r[0]), 4), at=round(float(r[col_t]), 4), v=round(float(min(1, r[col_s] / max(ref, 1e-6))), 3)))
        return out

    kicks = events(1, 2, 0.55, 0.2)
    snares = events(3, 4, 0.6, 0.18)
    hats = events(5, 6, 0.5, 0.12)

    # ---- key + chords (diatonic triads only, one chord per half bar, smoothed)
    C = librosa.feature.chroma_cqt(y=yh, sr=SR, hop_length=512, bins_per_octave=36)
    ct = librosa.frames_to_time(np.arange(C.shape[1]), sr=SR, hop_length=512)
    prof = C.sum(axis=1)
    keys = []
    for r in range(12):
        keys.append((np.corrcoef(np.roll(MAJOR, r), prof)[0, 1], NOTES[r] + " major", r, "maj"))
        keys.append((np.corrcoef(np.roll(MINOR, r), prof)[0, 1], NOTES[r] + " minor", r, "min"))
    keys.sort(reverse=True)
    key = keys[0]
    tonic = key[2] if key[3] == "maj" else (key[2] + 3) % 12  # relative major
    scale = [(tonic + s) % 12 for s in (0, 2, 4, 5, 7, 9, 11)]
    qual = ["", "m", "m", "", "", "m", "dim"]
    cands = []
    for deg, root in enumerate(scale):
        if qual[deg] == "dim":
            continue
        ivs = (0, 4, 7) if qual[deg] == "" else (0, 3, 7)
        v = np.zeros(12)
        for iv in ivs:
            v[(root + iv) % 12] = 1
        v[root] += 0.6
        cands.append((NOTES[root] + qual[deg], v / np.linalg.norm(v), root))
    half = P * 2
    hb = np.arange(d0 - np.floor(d0 / half) * half, dur, half)
    sims = []
    for t in hb:
        m = (ct >= t) & (ct < t + half)
        if not m.any():
            sims.append(np.zeros(len(cands)))
            continue
        v = np.median(C[:, m], axis=1)
        v = v / (np.linalg.norm(v) + 1e-9)
        sims.append(np.array([c[1] @ v for c in cands]))
    sims = np.array(sims)
    # Viterbi with switch penalty
    pen = 0.08
    n, k = sims.shape
    cost = sims[0].copy()
    back = np.zeros((n, k), int)
    for i in range(1, n):
        new = np.empty(k)
        for j in range(k):
            opts = cost - pen
            opts[j] = cost[j]
            back[i, j] = int(np.argmax(opts))
            new[j] = opts[back[i, j]] + sims[i, j]
        cost = new
    path = [int(np.argmax(cost))]
    for i in range(n - 1, 0, -1):
        path.append(back[i, path[-1]])
    path = path[::-1]
    chords = []
    for i, j in enumerate(path):
        name = cands[j][0]
        if not chords or chords[-1]["name"] != name:
            chords.append(dict(t=round(float(hb[i]), 4), name=name, root=int(cands[j][2]), conf=round(float(sims[i, j]), 3)))

    # ---- continuous envelopes for the picture (100 Hz), normalised 0..1
    fps = 100
    def env_series(e):
        e = e[:: SR // fps]
        e = 20 * np.log10(e + 1e-6)
        lo, hi = np.percentile(e, 5), np.percentile(e, 99.5)
        return np.clip((e - lo) / (hi - lo), 0, 1)
    low = env_series(bandpass_env(yp, 0, 140))
    mid = env_series(bandpass_env(y, 300, 3000, 0.03))
    high = env_series(bandpass_env(yp, 6000, 16000))
    full = env_series(bandpass_env(y, 0, 20000, 0.05))

    # ---- beat pulses: every beat where the drums are playing, scaled by the low-end punch at that beat.
    # (This track's bass pulses on every 16th, so the beat is a steadier "kick" signal than raw low-end onsets.)
    perc = sorted([e["t"] for e in snares + hats])
    pulses = []
    for b in beats:
        near = [t for t in perc if abs(t - b) <= P * 1.01]
        if not near:
            continue
        s_, _ = strength(kf, b)
        pulses.append(dict(t=round(float(b), 4), v=round(float(np.clip(0.45 + s_ * 0.55, 0.45, 1.0)), 3)))

    # ---- per-bar summary
    bars = []
    for i, d in enumerate(downbeats):
        e = d + 4 * P
        bars.append(dict(i=i, t=round(float(d), 4),
                         kicks="".join("x" if any(abs(x["t"] - s) < 1e-3 for x in kicks) else "." for s in d + np.arange(16) * P / 4),
                         snares="".join("x" if any(abs(x["t"] - s) < 1e-3 for x in snares) else "." for s in d + np.arange(16) * P / 4),
                         hats="".join("x" if any(abs(x["t"] - s) < 1e-3 for x in hats) else "." for s in d + np.arange(16) * P / 4),
                         energy=round(float(full[int(d * fps): int(e * fps)].mean()), 3)))

    out = dict(file=pathlib.Path(a.audio).name, duration=round(dur, 4), bpm=round(60 / P, 3), beat=round(P, 6),
               first_downbeat=round(float(d0), 4), key=key[1], beats=[round(float(b), 4) for b in beats],
               downbeats=[round(float(b), 4) for b in downbeats], pulses=pulses, kicks=kicks, snares=snares, hats=hats, chords=chords,
               bars=bars, env_fps=fps, env=dict(low=[round(float(v), 3) for v in low], mid=[round(float(v), 3) for v in mid],
                                                high=[round(float(v), 3) for v in high], full=[round(float(v), 3) for v in full]))
    (ROOT / "assets" / "music" / "analysis.json").write_text(json.dumps(out, separators=(",", ":")))
    print(f"{dur:.2f}s  bpm {60/P:.3f}  first downbeat {d0:.4f} (offset {off*1000:+.1f} ms)  key {key[1]}  pulses {len(pulses)} kicks {len(kicks)} snares {len(snares)} hats {len(hats)}")
    print("chords:", " ".join(f"{c['t']:.2f}:{c['name']}({c['conf']:.2f})" for c in chords))
    for b in bars:
        print(f"bar {b['i']:2d} {b['t']:6.2f}  K {b['kicks']}  S {b['snares']}  H {b['hats']}  E {b['energy']:.2f}")

    if a.plot:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(4, 1, figsize=(26, 12), sharex=True)
        tt = np.arange(len(low)) / fps
        for axx, (nm, e, ev) in zip(ax, (("low", low, kicks), ("mid/snare", mid, snares), ("high", high, hats), ("full", full, []))):
            axx.plot(tt, e, lw=0.7)
            axx.vlines([x["at"] for x in ev], 0, 1, color="k", lw=0.7)
            axx.vlines(downbeats, 0, 1, color="r", lw=1, alpha=0.5)
            axx.set_ylabel(nm)
        for c in chords:
            ax[3].text(c["t"], 0.95, c["name"], fontsize=9)
        ax[3].set_xticks(np.arange(0, dur, 1))
        plt.tight_layout()
        plt.savefig(a.plot, dpi=55)


if __name__ == "__main__":
    main()
