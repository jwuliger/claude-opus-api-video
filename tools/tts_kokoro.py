"""Render the voiceover script with Kokoro (local, free). Default voice: a deep British male blend.

Usage: python tools/tts_kokoro.py --models <dir with kokoro-v1.0.onnx + voices-v1.0.bin> [--voice bf_emma]
Writes raw clips to assets/vo/raw/<id>.wav; then run tools/align_vo.py.
"""
import argparse
import json
import pathlib

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = pathlib.Path(__file__).resolve().parent.parent

ap = argparse.ArgumentParser()
ap.add_argument("--models", required=True)
ap.add_argument("--voice", default="bm_fable:0.6,am_onyx:0.4", help="voice id, or a blend like bm_fable:0.6,am_onyx:0.4")
ap.add_argument("--speed", type=float, default=1.04)
a = ap.parse_args()
k = Kokoro(str(pathlib.Path(a.models) / "kokoro-v1.0.onnx"), str(pathlib.Path(a.models) / "voices-v1.0.bin"))
out = ROOT / "assets" / "vo" / "raw"
out.mkdir(parents=True, exist_ok=True)
if ":" in a.voice:
    style = sum(float(w) * k.get_voice_style(v) for v, w in (p.split(":") for p in a.voice.split(",")))
else:
    style = k.get_voice_style(a.voice)
for line in json.loads((ROOT / "tools" / "script.json").read_text()):
    if "parts" in line:  # separate takes joined with clean pauses (lets the picture change on each word)
        chunks = []
        for i, part in enumerate(line["parts"]):
            au, sr = k.create(part, voice=style, speed=a.speed, lang="en-gb")
            loud = np.where(np.abs(au) > 0.01)[0]
            au = au[max(0, loud[0] - int(0.02 * sr)): loud[-1] + int(0.06 * sr)]
            chunks.append(au)
            if i + 1 < len(line["parts"]):
                chunks.append(np.zeros(int(line.get("gap", 0.3) * sr), dtype=au.dtype))
        audio = np.concatenate(chunks)
    else:
        audio, sr = k.create(line["text"], voice=style, speed=a.speed, lang="en-gb")
    sf.write(out / f"{line['id']}.wav", audio, sr)
    print(line["id"], f"{len(audio)/sr:.2f}s")
