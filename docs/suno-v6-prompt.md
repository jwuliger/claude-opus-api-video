# Suno v6 prompt: Live Motion Labs promo bed

Target: a 60-second instrumental at 96 BPM in 4/4. At 96 BPM one bar is exactly 2.5 seconds, so every
"moment" below falls on a bar line. Suno will not hit these times exactly; the video code detects the real
beats, downbeats, hits and chord changes in the delivered track and re-times the scenes to it.

## Settings

- Model: v6 (turn on Max Mode if available)
- Custom mode, **Instrumental: ON**
- Variety: lowest / off (third-party guides say this makes v6 follow the style prompt more literally)
- Download: WAV. If your plan allows it, also export stems (drums especially), with Manual BPM set to 96.

## Style (paste into Style, ~600 characters)

```
Cinematic electronic instrumental, premium and polished. 96 BPM, steady tempo, 4/4, D minor. Warm analog synth pads, deep clean sub bass, crisp punchy kick, tight finger snaps and claps, glassy plucked arpeggios, soft shimmering bell textures, wide stereo, airy reverb. Mood: glowing, confident, hopeful, modern, like light drawing itself in the dark. One minute long. Timeline: 0:00 near-silent intro with a soft pad and shimmer, rising into the beat drop at 0:05; groove builds; lift at 0:17; steady groove 0:32; one huge cinematic hit at 0:45, then calm warm ending, final chord rings out by 1:00.
```

## Exclude Styles

```
vocals, singing, choir, vocal chops, humming, spoken word, rap, guitar solo, lo-fi, vinyl crackle, tape hiss, tempo changes, swing, trap hi-hat rolls, EDM siren, dubstep wobble, fade in
```

## Lyrics field (structure only, nothing is sung with Instrumental ON)

```
[Instrumental]

[Intro]
[near silence, soft airy synth pad swells in, faint glassy shimmer, no drums]
[rising sweep into the next downbeat]

[Verse]
[beat drops on the downbeat: soft deep impact, punchy kick, warm sub bass]
[finger snaps on 2 and 4, light hi-hats]
[chord change on every bar]

[Pre-Chorus]
[one bar build, snare roll, rising sweep]

[Chorus]
[crash cymbal, full drums, bright plucked arpeggio, wide warm pads, uplifting]
[chord change on every bar]

[Break]
[steady groove, slightly lighter, room for a voiceover]

[Build]
[one bar snare roll and riser, short silence on the last beat]

[Outro]
[one huge cinematic hit with a crash, then the drums stop]
[warm pad and a soft heartbeat kick, calm and confident]
[final chord rings out]

[End]
```

## Bar map the video is designed around (96 BPM)

| Time | Bars | Moment | Picture |
| --- | --- | --- | --- |
| 0:00–0:05 | 1–2 | Near-silent intro, riser | A line of light draws a hand pressing play |
| 0:05 | 3 | Beat drop | Play is pressed, waveform blooms into a ribbon |
| 0:05–0:15 | 3–6 | Verse groove, chord change each bar | Ribbon pulses on drums, colour shifts on chords |
| 0:15–0:17.5 | 7 | Build | Words start to appear |
| 0:17.5–0:32.5 | 8–13 | Chorus | Lyrics inked word by word, then three versions |
| 0:32.5–0:42.5 | 14–17 | Lighter groove | Formats and release pack |
| 0:42.5–0:45 | 18 | Build, stop | Everything pulls to the centre |
| 0:45 | 19 | Big hit | Logo draws in light |
| 0:45–1:00 | 19–24 | Calm ending | End card, URL, "Get early access" |
