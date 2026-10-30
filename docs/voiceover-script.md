# Voiceover script and delivery spec

Voice: British, confident, warm, resounding. Calm authority, not a trailer voice. Clear and present.

## Format

- One file per line, named exactly as below (for example `vo03.wav`)
- WAV, 44.1 kHz or 48 kHz, 24-bit (16-bit is fine), mono or stereo
- Clean: no music, no effects, no reverb, no breaths at the very start or end
- About 0.2 s of silence at each end is fine (the tool trims it)
- Put the files in `assets/vo/raw/`, then run `npm run voice` (it trims, levels and times every word with Whisper)

## Lines

| File | Line | Lands on |
| --- | --- | --- |
| vo01 | Your song is one of a kind. | Opening, the hand is drawn |
| vo02 | Its video should be too. | Just before play is pressed |
| vo03 | Live Motion Labs hears your song the way a musician does. | Waveform becomes the ribbon |
| vo04 | Every beat. | "beat" lands on a drum hit |
| vo05 | Every chord change. | "change" lands on a chord change |
| vo06 | And every word, the moment it's sung. | Lead-in to the lyric |
| lyric | Watch my words become the light. | Each word is drawn as it is heard; "light" lands on the chorus |
| vo07 | No AI-generated video. No templates. No stock footage. | Three versions of the same song |
| vo08 | Every frame is drawn live, in code. | |
| vo09 | So no two videos are ever alike. | Side-by-side versions |
| vo10 | Wide. Tall. Square. Up to 4K, at 60 frames per second. | The frame changes shape on each word |
| vo11 | Plus a release pack for every platform. | Release pack |
| vo12 | Lyric videos, drawn in light and color. | Big statement |
| vo13 | Live Motion Labs. | The logo is drawn |
| vo14 | Get early access at livemotionlabs.com. | End card |

## Timing tips

- Natural pace. Short pauses between "Wide. Tall. Square." help the picture change on each word.
- "lyric" is spoken, not sung: even and rhythmic, with a slight lift on "light".
- Keep each take close to these lengths: vo03 about 3 s, vo07 about 4 s, vo10 about 4 s. Everything else is 1 to 2.5 s.
