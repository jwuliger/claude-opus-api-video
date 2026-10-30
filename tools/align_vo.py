"""Trim, level and time every voiceover clip with Whisper (word timestamps).

Usage: python tools/align_vo.py [--whisper medium.en] [--whisper-root <model cache>]
Reads assets/vo/raw/<id>.wav, writes assets/vo/<id>.wav (mono, trimmed, -1 dBFS peak) and
assets/vo/manifest.json with each clip's duration and word timings (seconds from clip start).
"""
import argparse
import difflib
import json
import re
import pathlib

import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel
from scipy.signal import resample_poly

ROOT = pathlib.Path(__file__).resolve().parent.parent
VO = ROOT / "assets" / "vo"


def trim(audio, sr, thresh_db=-45.0, pad=0.03):
    win = int(sr * 0.01)
    n = len(audio) // win
    rms = np.array([np.sqrt(np.mean(audio[i * win:(i + 1) * win] ** 2) + 1e-12) for i in range(n)])
    loud = np.where(20 * np.log10(rms) > thresh_db)[0]
    if len(loud) == 0:
        return audio
    a = max(0, loud[0] * win - int(pad * sr))
    b = min(len(audio), (loud[-1] + 1) * win + int(pad * 2 * sr))
    out = audio[a:b].copy()
    f = int(0.005 * sr)
    out[:f] *= np.linspace(0, 1, f)
    out[-f * 4:] *= np.linspace(1, 0, f * 4)
    return out


def norm(w):
    return re.sub(r"[^a-z0-9']", "", w.lower())


def to_script_words(text, heard):
    """Map Whisper's word timings onto the script's own words (handles accents and merged words)."""
    script = text.replace("-", " ").split()
    sn = [norm(w) for w in script]
    hn = [norm(w["w"]) for w in heard]
    out = [None] * len(script)
    for op, a0, a1, b0, b1 in difflib.SequenceMatcher(None, sn, hn, autojunk=False).get_opcodes():
        if op == "equal" or (op == "replace" and a1 - a0 == b1 - b0):
            for k in range(a1 - a0):
                h = heard[b0 + k]
                out[a0 + k] = dict(w=script[a0 + k], s=h["s"], e=h["e"], p=h["p"])
        elif op == "replace":
            s0, e0 = heard[b0]["s"], heard[b1 - 1]["e"]
            lens = [max(1, len(sn[i])) for i in range(a0, a1)]
            acc = s0
            for k, i in enumerate(range(a0, a1)):
                d = (e0 - s0) * lens[k] / sum(lens)
                out[i] = dict(w=script[i], s=round(acc, 3), e=round(acc + d, 3), p=0.5)
                acc += d
    for i in range(len(out)):  # words Whisper dropped: place them between neighbours
        if out[i] is None:
            prev = next((out[j]["e"] for j in range(i - 1, -1, -1) if out[j]), 0.0)
            nxt = next((out[j]["s"] for j in range(i + 1, len(out)) if out[j]), prev + 0.2)
            out[i] = dict(w=script[i], s=round(prev, 3), e=round(max(prev, nxt), 3), p=0.0)
    return out


ap = argparse.ArgumentParser()
ap.add_argument("--whisper", default="medium.en")
ap.add_argument("--whisper-root")
a = ap.parse_args()
model = WhisperModel(a.whisper, device="cpu", compute_type="int8", download_root=a.whisper_root)
script = json.loads((ROOT / "tools" / "script.json").read_text())
manifest = {}
for line in script:
    audio, sr = sf.read(VO / "raw" / f"{line['id']}.wav", dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    audio = trim(audio, sr)
    audio *= 0.89 / (np.max(np.abs(audio)) + 1e-9)
    sf.write(VO / f"{line['id']}.wav", audio, sr, subtype="PCM_16")
    a16 = resample_poly(audio, 16000, sr).astype(np.float32)
    segs, _ = model.transcribe(a16, word_timestamps=True, beam_size=5, language="en")
    words, heard = [], []
    for s in segs:
        heard.append(s.text.strip())
        for w in s.words:
            words.append(dict(w=w.word.strip(), s=round(w.start, 3), e=round(w.end, 3), p=round(w.probability, 3)))
    manifest[line["id"]] = dict(text=line["text"], heard=" ".join(heard), dur=round(len(audio) / sr, 3), sr=sr,
                                words=to_script_words(line["text"], words))
    print(f"{line['id']:6s} {len(audio)/sr:5.2f}s  heard: {' '.join(heard)}")
(VO / "manifest.json").write_text(json.dumps(manifest, indent=1))
