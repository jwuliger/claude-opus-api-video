"""Synthesize lines with Kyutai TTS 1.6B (CC-BY-4.0) using a British voice preset.

Usage:
    python tools/kyutai_tts.py --voice vctk/p225_023_enhanced.wav --out out.wav "First line." "Second line."
Each argument is synthesized as its own clip; with --out a single file is written per line
(<out>_<n>.wav) unless only one line is given.
"""
import argparse
import time

import numpy as np
import soundfile as sf
import torch
from moshi.models.loaders import CheckpointInfo
from moshi.models.tts import TTSModel, DEFAULT_DSM_TTS_REPO, DEFAULT_DSM_TTS_VOICE_REPO


def load(device="cpu"):
    info = CheckpointInfo.from_hf_repo(DEFAULT_DSM_TTS_REPO)
    return TTSModel.from_checkpoint_info(info, n_q=32, temp=0.6, device=torch.device(device))


def synth(model, text, voice, cfg=2.0, seed=0):
    torch.manual_seed(seed)
    entries = model.prepare_script([text], padding_between=1)
    voice_path = model.get_voice_path(voice)
    cond = model.make_condition_attributes([voice_path], cfg_coef=cfg)
    pcms = []

    def on_frame(frame):
        if (frame != -1).all():
            pcm = model.mimi.decode(frame[:, 1:, :]).cpu().numpy()
            pcms.append(np.clip(pcm[0, 0], -1, 1))

    with model.mimi.streaming(1):
        model.generate([entries], [cond], on_frame=on_frame)
    return np.concatenate(pcms, axis=-1), model.mimi.sample_rate


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("lines", nargs="+")
    a = ap.parse_args()
    torch.set_num_threads(4)
    model = load()
    for n, line in enumerate(a.lines):
        t0 = time.time()
        audio, sr = synth(model, line, a.voice, seed=a.seed)
        out = a.out if len(a.lines) == 1 else a.out.replace(".wav", f"_{n:02d}.wav")
        sf.write(out, audio, sr)
        print(f"{out}: {len(audio)/sr:.2f}s audio in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
