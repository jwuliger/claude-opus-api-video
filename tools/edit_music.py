"""Fit the Suno track to the film: silence pre-roll, one bar removed from the breakdown, natural ending.

Usage:
    python tools/edit_music.py assets/music/light-drawing-itself-in.mp3 assets/music/edit.wav

All edit points sit exactly on bar lines of the track's own beat grid (97.4 BPM, first downbeat 2.58 s),
with short equal-power crossfades so the joins are inaudible.
"""
import sys

import librosa
import numpy as np
import soundfile as sf

SR = 48000
PREROLL = 1.5          # seconds of silence before the music (the film opens in silence)
FIRST_DOWNBEAT = 2.58  # refined below against the percussion
BAR = 4 * 0.61602
CUT_BARS = (14, 15)    # remove bar 14 of the groove (the first breakdown bar, drums out, same chord as bar 15)
TOTAL = 59.9           # film length
FADE = 1.6             # natural fade at the very end


def refine_downbeat(y, guess):
    """Nudge the grid so beats line up with percussive onsets (within +-60 ms)."""
    _, yp = librosa.effects.hpss(y, margin=2.0)
    env = librosa.onset.onset_strength(y=yp, sr=SR, hop_length=120)
    times = librosa.frames_to_time(np.arange(len(env)), sr=SR, hop_length=120)
    beats = guess + np.arange(-4, 90) * (BAR / 4)
    best, best_off = -1, 0
    for off in np.arange(-0.06, 0.0601, 0.0025):
        b = beats + off
        b = b[(b > 0) & (b < times[-1])]
        s = np.interp(b, times, env).sum()
        if s > best:
            best, best_off = s, off
    return guess + best_off


def xfade(a, b, n):
    t = np.linspace(0, np.pi / 2, n)[:, None]
    return a * np.cos(t) + b * np.sin(t)


def main(src, dst):
    y, _ = librosa.load(src, sr=SR, mono=False)
    y = y.T  # (n, 2)
    d0 = refine_downbeat(librosa.to_mono(y.T), FIRST_DOWNBEAT)
    c0 = d0 + CUT_BARS[0] * BAR
    c1 = d0 + CUT_BARS[1] * BAR
    i0, i1 = int(round(c0 * SR)), int(round(c1 * SR))
    n = int(0.025 * SR)
    head = y[: i0 - n // 2]
    join = xfade(y[i0 - n // 2: i0 + n - n // 2], y[i1 - n // 2: i1 + n - n // 2], n)
    tail = y[i1 + n - n // 2:]
    out = np.concatenate([np.zeros((int(PREROLL * SR), 2), np.float32), head, join, tail])
    total = int(TOTAL * SR)
    out = out[:total]
    if len(out) < total:
        out = np.concatenate([out, np.zeros((total - len(out), 2), np.float32)])
    f = int(FADE * SR)
    out[-f:] *= (np.cos(np.linspace(0, np.pi / 2, f)) ** 2)[:, None]
    sf.write(dst, out, SR, subtype="FLOAT")
    print(f"first downbeat {d0:.4f}s; removed {c0:.3f}-{c1:.3f}s ({c1 - c0:.3f}s); film length {len(out) / SR:.2f}s")
    print(f"film time = music time + {PREROLL} (before {c0:.3f}), music time + {PREROLL - (c1 - c0):.3f} (after {c1:.3f})")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
