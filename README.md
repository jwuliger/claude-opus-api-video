# Live Motion Labs · Promo film

A 60-second promo for [www.livemotionlabs.com](https://www.livemotionlabs.com), drawn live in code with **WebGPU**.
Lines of light ink themselves on screen, move with the music, and end on "Get early access".

- 🎬 **Length**: 59.9 seconds, 16:9
- 🖥️ **Master render**: 3840×2160 at 60 fps, H.264 + AAC 320 kbps
- 🎨 **Style**: "Luminous ink": hand-drawn lines made of light, bloom, grain, slow haze, constant camera motion
- 🚫 **No AI-generated images or video.** Every frame is drawn procedurally by the code in `src/`.

---

## ▶️ Render the video on your GPU

### What you need

- **Node.js 18 or newer**
- **Google Chrome** (or Microsoft Edge) with hardware acceleration on
- A GPU that supports WebGPU (any recent NVIDIA, AMD, Intel or Apple GPU)

### Steps

1. Clone the repo and open a terminal in it.
2. Install the tools (this also downloads ffmpeg, the video encoder):

   ```bash
   npm install
   ```

3. Render the 4K master:

   ```bash
   npm run render
   ```

4. Find the video at `out/live-motion-labs-promo-4k.mp4`.

The first line printed is the WebGPU adapter. It should name your GPU. If it says `swiftshader`, Chrome is not using
your GPU: try `npm run render -- --headed` or `npm run render -- --browser msedge`.

### Other render options

| Command | Result |
| --- | --- |
| `npm run render:1080` | 1920×1080, 60 fps → `out/live-motion-labs-promo-1080p.mp4` |
| `npm run render:draft` | Quick 720p, 30 fps check → `out/draft-720p.mp4` |
| `npm run render -- --from 20 --to 26` | Only seconds 20 to 26 |
| `npm run render -- --encoder nvenc` | NVIDIA hardware encoder (also `videotoolbox` on Mac, `qsv`, `amf`) |
| `npm run render -- --crf 14` | Higher quality, bigger file (default 16 for 4K) |

If Playwright cannot find a browser, run `npx playwright install chromium` once, or install Google Chrome.

## 🌐 Play it in a browser

- **Self-contained page**: open `dist/live-motion-labs-promo.html` in Chrome, Edge or Safari. Everything (code, fonts,
  music, voice) is inside that one file.
- **Or** run `npm run preview` and open the address it prints.
- Keys: `Space` play/pause · `←` `→` jump 5 s · `R` restart · `F` fullscreen.

The page mixes the audio once when it opens (a few seconds), then plays picture and sound from the same clock.

---

## 📜 Final script

| Time | Line |
| --- | --- |
| 0:00 | *(silence; a single line of light draws a hand)* |
| 0:00 | Your song is one of a kind. |
| 0:03 | Its video should be too. *("too" lands as play is pressed)* |
| 0:05 | Live Motion Labs hears your song the way a musician does. |
| 0:09 | Every beat. *("beat" lands on a drum hit)* |
| 0:11 | Every chord change. *("change" lands on a chord change)* |
| 0:19 | And every word, the moment it's sung. |
| 0:22 | Watch my words become the light. *(spoken lyric; each word is drawn as it is heard)* |
| 0:26 | No AI-generated video. No templates. No stock footage. |
| 0:31 | Every frame is drawn live, in code. |
| 0:34 | So no two videos are ever alike. |
| 0:37 | Wide. Tall. Square. Up to 4K, at 60 frames per second. |
| 0:42 | Plus a release pack for every platform. |
| 0:46 | Lyric videos, drawn in light and color. |
| 0:52 | Live Motion Labs. |
| 0:54 | Get early access at livemotionlabs.com. |
| 0:54–0:60 | *(end card holds: logo, "Get early access", www.livemotionlabs.com)* |

## 🎞️ Scenes

| Time | Scene |
| --- | --- |
| 0:00–0:04 | Silence. A spark becomes a line that draws a hand pressing a play button. |
| 0:04 | The beat drops: rings of light, the waveform blooms out of the button. |
| 0:04–0:21 | The waveform becomes a ribbon of light. It pulses on every drum hit; its colour sweeps out on every chord change. Live "analysis" chips: tempo, beat, chord, section. |
| 0:19–0:26 | Lyric scene: a word-timing rail, then each lyric word is traced in light at the moment it is heard. "LIGHT" blooms on the chorus. |
| 0:26–0:34 | Same song, three seeds: twin ribbons, orbits, a contour field. Then all three side by side. |
| 0:36–0:41 | One frame of light reshapes on the words: 16:9, 9:16, 1:1. Then "Up to 4K · 60 FPS". |
| 0:41–0:46 | The release pack: Spotify Canvas loop, Apple Music motion artwork, 15/30/60-second social clips. |
| 0:46–0:51 | Statement: "Lyric videos drawn in light and color." |
| 0:51–0:60 | End card: the logo mark draws itself, wordmark, tagline, "Get early access", the URL. Held for 6+ seconds. |

---

## 🧭 Every choice made (and why)

### Brand

- Colours and fonts come from www.livemotionlabs.com: background `#05070b`, blues `#8cb4ff` / `#5a88ff` / `#2850ff`,
  cyan `#5aebff`, ice `#e1f0ff`, accents amber `#ffc766`, coral `#ff8f8f`, mint `#a8f0d4`.
  Magenta `#ff5fd7` was added because the brief asked for it.
- Fonts: **Anton** (headlines), **Space Grotesk** (labels and body), **Montserrat** (wordmark), the same families the
  site uses, taken from Google Fonts (SIL Open Font License) and embedded.
- The logo mark is the site's three-loop knot (from its favicon), redrawn stroke by stroke in light.
- No illustrations from the website are used (as requested).
- Wording follows the site's tone: short, plain, confident. No features, prices or dates beyond the brief.

### Music

- The music bed is your Suno v6 instrumental "Light Drawing Itself In" (`assets/music/light-drawing-itself-in.mp3`).
- Fitted to the film by `tools/edit_music.py`: 1.5 s of silence before it (the film opens in silence), one bar removed from
  the drum-free breakdown at an exact bar line (same chord on both sides, 25 ms crossfade), and a natural fade into 59.9 s.
- Analysed by `tools/analyze_music.py`: 97.34 BPM, steady grid, every beat and bar line, claps/snares, hi-hats, chords per
  half bar (restricted to the key, C major / D minor), and loudness envelopes at 100 Hz.
- Sync rules: the ribbon pulses on every beat where the drums play (scaled by the real low-end punch), flashes on claps,
  sparks on hi-hats, glows with the track's real loudness, and changes colour exactly on each detected chord change.
  Scene cuts land on bar lines.

### Voice

- Free and local: **Kokoro** (Apache-2.0), a blend of `bm_fable` (60%) and `am_onyx` (40%), British English
  pronunciation, speed 1.04. You picked this voice from two previews.
- Every word is timed with **Whisper** (faster-whisper, medium.en). Timings are mapped onto the script's own words,
  so the picture can react to a specific word ("beat", "change", "Tall", "Square", "light", "Get").
- "Wide. Tall. Square." is generated as separate takes with short pauses so the frame can change on each word.
- Mix: music ducks about 6 dB under the voice; gentle high-pass, presence and a touch of room on the voice;
  limiter at -1 dBFS. Subtle sound design: soft whooshes on cuts, a glassy shimmer while lines draw, a click on the press.

### Picture

- Rendered with **WebGPU**: light strokes in HDR (half-float), 7-level bloom, ACES-style tone mapping, slight radial
  chromatic shimmer, film grain, dithering, vignette and a quarter-resolution drifting haze.
- Hand-drawn feel: uneven line weight, brush tapers, a bright pen tip with a hot trail, and "boiling" lines at 12 drawings
  per second.
- Camera always moves (push-ins, drifts, whips). Real motion blur from the camera path (180° shutter).
- The opening hand is line art redrawn from a reference drawing by `tools/trace_hand.py` (centre lines, re-fitted as
  smooth splines, re-oriented to point down). The reference image is not stored in the repo.
- Text is drawn two ways: a pen of light traces each letter's outline, then the letter fills.

### Honest notes

- The brand promise is "Nothing is AI-generated" (for the product's videos). This promo's **visuals** are fully
  procedural, but the **music** (Suno) and the **voice** (Kokoro TTS) are machine-generated. Swap in a human voice or
  composed music if that matters for this film.
- OpenRouter was not used (you asked to drop it). The website was read once network access was allowed.

---

## 🛠️ Re-generate the assets (optional, needs Python 3.10+)

You only need this if you change the music, the script or the hand.

```bash
python -m venv .venv && . .venv/bin/activate
pip install kokoro-onnx faster-whisper librosa scipy soundfile scikit-image matplotlib
```

| Step | Command |
| --- | --- |
| Fit the music | `python tools/edit_music.py assets/music/light-drawing-itself-in.mp3 assets/music/edit.wav` then `ffmpeg -i assets/music/edit.wav -c:a flac assets/music/edit.flac` |
| Analyse the music | `python tools/analyze_music.py assets/music/edit.wav` |
| Voice | Edit `tools/script.json`, then `python tools/tts_kokoro.py --models <folder with kokoro-v1.0.onnx and voices-v1.0.bin>` (models from the kokoro-onnx GitHub releases) |
| Time the words | `python tools/align_vo.py` |
| Hand line art | `python tools/trace_hand.py <reference image>` |
| Rebuild the page | `npm run build` |

## 📁 Layout

```
src/        the film: gpu.js (WebGPU renderer), ink.js (strokes, camera), text.js, score.js (timeline),
            audio.js (mix), scenes.js (every scene), main.js (player + render mode), index.html
assets/     fonts, music (+ analysis), voice clips (+ word timings), logo and hand line art
tools/      build, render, preview, and the Python asset tools
dist/       the self-contained HTML page
docs/       the Suno prompt and the voiceover script
```

## 📄 Licences

- Code: see `LICENSE`.
- Fonts: SIL Open Font License (Anton, Space Grotesk, Montserrat).
- Kokoro voice model: Apache-2.0. Whisper (faster-whisper): MIT. opentype.js: MIT.
- Music: your Suno v6 generation, under your Suno plan's terms.
