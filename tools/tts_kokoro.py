"""Render the script with Kokoro (fast; used for timing drafts).

Usage: python tools/tts_kokoro.py --models <dir with kokoro-v1.0.onnx + voices-v1.0.bin> [--voice bf_emma]
Writes raw clips to assets/vo/raw/<id>.wav; then run tools/align_vo.py.
"""
import argparse
import json
import pathlib

import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = pathlib.Path(__file__).resolve().parent.parent

ap = argparse.ArgumentParser()
ap.add_argument("--models", required=True)
ap.add_argument("--voice", default="bf_emma")
ap.add_argument("--speed", type=float, default=0.92)
a = ap.parse_args()
k = Kokoro(str(pathlib.Path(a.models) / "kokoro-v1.0.onnx"), str(pathlib.Path(a.models) / "voices-v1.0.bin"))
out = ROOT / "assets" / "vo" / "raw"
out.mkdir(parents=True, exist_ok=True)
for line in json.loads((ROOT / "tools" / "script.json").read_text()):
    audio, sr = k.create(line["text"], voice=a.voice, speed=a.speed, lang="en-gb" if a.voice.startswith("b") else "en-us")
    sf.write(out / f"{line['id']}.wav", audio, sr)
    print(line["id"], f"{len(audio)/sr:.2f}s")
