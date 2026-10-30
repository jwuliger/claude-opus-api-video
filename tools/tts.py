"""Generate the voiceover and lyric vocal with Kokoro, then time every word with Whisper.

Usage (see README):
    python tools/tts.py --models <dir with kokoro-v1.0.onnx + voices-v1.0.bin>

Writes assets/vo/<id>.wav (24 kHz mono, trimmed) and assets/vo/manifest.json with
each clip's duration and Whisper word timestamps (seconds from clip start).
"""
import argparse
import json
import pathlib

import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from faster_whisper import WhisperModel

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "vo"

NARRATOR = "bf_emma"   # British, calm and warm
SINGER = "am_michael"  # the "artist" voice for the lyric line

# Every line of the script. `text` is what Kokoro reads; `display` is the script text.
LINES = [
    dict(id="vo01", voice=NARRATOR, speed=0.9, text="Your song is one of a kind."),
    dict(id="vo02", voice=NARRATOR, speed=0.9, text="Its video should be too."),
    dict(id="vo03", voice=NARRATOR, speed=0.92, text="Live Motion Labs hears your song the way a musician does."),
    dict(id="vo04", voice=NARRATOR, speed=0.9, text="Every beat."),
    dict(id="vo05", voice=NARRATOR, speed=0.9, text="Every chord."),
    dict(id="vo06", voice=NARRATOR, speed=0.92, text="And every word, the moment it's sung."),
    dict(id="lyric", voice=SINGER, speed=0.8, text="Watch my words become the light."),
    dict(id="vo07", voice=NARRATOR, speed=0.92, text="No AI-generated video. No templates. No stock footage."),
    dict(id="vo08", voice=NARRATOR, speed=0.92, text="Every frame is drawn live, in code, from your song."),
    dict(id="vo09", voice=NARRATOR, speed=0.92, text="So no two videos are ever alike."),
    dict(id="vo10", voice=NARRATOR, speed=0.92, text="Wide. Tall. Square. Up to four K, at sixty frames per second."),
    dict(id="vo11", voice=NARRATOR, speed=0.92, text="Plus a release pack for every platform."),
    dict(id="vo12", voice=NARRATOR, speed=0.9, text="Live Motion Labs. Lyric videos, drawn in light and color."),
    dict(id="vo13", voice=NARRATOR, speed=0.9, text="Get early access at live motion labs dot com."),
]


def trim(audio, sr, thresh_db=-45.0, pad=0.02):
    """Trim leading/trailing silence, keeping a short pad so consonants are not clipped."""
    win = int(sr * 0.01)
    frames = len(audio) // win
    rms = np.array([np.sqrt(np.mean(audio[i * win:(i + 1) * win] ** 2) + 1e-12) for i in range(frames)])
    db = 20 * np.log10(rms)
    loud = np.where(db > thresh_db)[0]
    if len(loud) == 0:
        return audio
    a = max(0, loud[0] * win - int(pad * sr))
    b = min(len(audio), (loud[-1] + 1) * win + int(pad * sr))
    return audio[a:b]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", required=True)
    ap.add_argument("--whisper", default="medium.en")
    ap.add_argument("--whisper-root", default=None)
    ap.add_argument("--only", nargs="*")
    args = ap.parse_args()

    models = pathlib.Path(args.models)
    kokoro = Kokoro(str(models / "kokoro-v1.0.onnx"), str(models / "voices-v1.0.bin"))
    whisper = WhisperModel(args.whisper, device="cpu", compute_type="int8", download_root=args.whisper_root)
    OUT.mkdir(parents=True, exist_ok=True)

    manifest_path = OUT / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}

    for line in LINES:
        if args.only and line["id"] not in args.only:
            continue
        audio, sr = kokoro.create(line["text"], voice=line["voice"], speed=line["speed"], lang="en-gb" if line["voice"].startswith("b") else "en-us")
        audio = trim(np.asarray(audio, dtype=np.float32), sr)
        peak = float(np.max(np.abs(audio)))
        audio = audio * (0.89 / peak)  # normalise to -1 dBFS peak
        wav = OUT / f"{line['id']}.wav"
        sf.write(wav, audio, sr, subtype="PCM_16")

        segments, _ = whisper.transcribe(str(wav), word_timestamps=True, beam_size=5, language="en")
        words = []
        heard = []
        for seg in segments:
            heard.append(seg.text.strip())
            for w in seg.words:
                words.append(dict(w=w.word.strip(), s=round(w.start, 3), e=round(w.end, 3), p=round(w.probability, 3)))
        manifest[line["id"]] = dict(
            voice=line["voice"], text=line["text"], heard=" ".join(heard),
            dur=round(len(audio) / sr, 3), sr=sr, words=words,
        )
        print(f"{line['id']:6s} {len(audio)/sr:5.2f}s  heard: {' '.join(heard)}")

    manifest_path.write_text(json.dumps(manifest, indent=1))


if __name__ == "__main__":
    main()
