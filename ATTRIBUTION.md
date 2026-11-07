# Audio attribution

Pitfighter 1899 is free to play. Its sound effects and music are generated
locally on the machine named in `docs/sfx.md`; no third-party sample library is
embedded.

## Stable Audio 3 Small-SFX

Sound effects and crowd reactions were made with **Stable Audio 3 Small-SFX**
(`stable_audio_3_small_sfx.safetensors`) through ComfyUI. The weights are
provided under the
[Stability AI Community License](https://huggingface.co/stabilityai/stable-audio-3-small-sfx).
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

Some stage themes are supplied as user-provided M4A (Opus) files rather than
generated in-repo:

- `public/music/first-toilet.m4a`
- `public/music/the-gasworks.m4a`
- `public/music/clock-of-saint-londo.m4a` — "Ring Zero" (usesuno.com)
- `public/music/airship-smoking-room.m4a`, `airship-set-fire.m4a`,
  `airship-only-one-parachute.m4a`

## Room impulses

`public/sfx/ir/*.mp3` are synthesised by `tools/audio/make_irs.py` from
deterministic noise and early-reflection taps. They are original programmatic
syntheses created for this repository (not third-party model outputs).

## The game's own synthesis

The fallback voices in `src/render/sfx.ts` and the reference renders in
`tools/sfx/reference/` are original code generated from Web Audio primitives.
