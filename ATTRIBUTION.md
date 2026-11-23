# Audio attribution

Pitfighter 1899 is free to play. Its sound effects and music are generated
locally on the machine named in `docs/sfx.md`; no third-party sample library is
embedded.

## Stable Audio 3 (Medium & Small-SFX)

Menu sound effects, combat impacts, swings, craft accents, gameplay/stage event
one-shots, ambient stage beds, and crowd reactions were made with **Stable Audio 3
Medium** (`stable_audio_3_medium.safetensors`) and **Stable Audio 3 Small-SFX**
(`stable_audio_3_small_sfx.safetensors`) through ComfyUI. The weights are
provided under the Stability AI Community License:
[Medium](https://huggingface.co/stabilityai/stable-audio-3-medium) and
[Small-SFX](https://huggingface.co/stabilityai/stable-audio-3-small-sfx).
The game is free, so the licence's revenue cap does not bind. The required
credit is:

> Made with Stable Audio

## MiniMax Music 3

The menu and stage themes were made with **MiniMax Music 3** through ComfyUI.
The weights are provided under the
[MiniMax-Music3 Community License](https://huggingface.co/MiniMaxAI/MiniMax-Music3).
Commercial use is permitted with attribution while the project is below the
licence's revenue threshold. The credit is:

> MiniMax-Music3

## Supplied stage music

Some stage themes are supplied as user-provided Opus files (remuxed to WebM) rather than
generated in-repo:

- `public/music/menu/` `big-boys.webm` (usesuno.com)
- `public/music/first-toilet/first-toilet.webm`
- `public/music/the-gasworks/the-gasworks.webm`
- `public/music/clock-of-saint-londo/clock-of-saint-londo.webm` — "Ring Zero" (usesuno.com)
- `public/music/airship-benevolence/{boarding,fire,bridge}/`: `airship-smoking-room.webm`,
  `airship-set-fire.webm`, `airship-only-one-parachute.webm`

## Genre music

The records under `public/music/genres/` are made with **Suno** (suno.com) and pulled down
with [usesuno.com's downloader](https://usesuno.com/tools/downloader/), which decrypts them
in the browser. They arrive as Opus in an M4A container and are remuxed losslessly into WebM
(`ffmpeg -i in.m4a -map 0:a -map_metadata -1 -c copy out.webm`), the audio stream untouched.
The downloader is used in its **batch** form (https://usesuno.com/tools/batch/), in the
**original audio** format rather than MP3 or WAV, so nothing is re-encoded on the way in.

## Room impulses

`public/sfx/ir/*.mp3` are synthesised by `tools/audio/make_irs.py` from
deterministic noise and early-reflection taps. They are original programmatic
syntheses created for this repository (not third-party model outputs).

## The game's own synthesis

The fallback voices in `src/render/sfx.ts` and the reference renders in
`tools/sfx/reference/` are original code generated from Web Audio primitives.
