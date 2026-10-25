# Sound

The game has always made its own sounds: `src/render/sfx.ts` builds every cue
from Web Audio primitives - a bandpassed noise burst for the crack, a pitched
oscillator for the body. It works, it is tiny, and it has a ceiling. Every
impact in the game shares one crack (`sfx.ts:125`), the crowd is white noise
through a filter (`sfx.ts:308-318`), and there is no reverb at all - the file
never builds a `ConvolverNode`.

This folder is the other way of making sound: **samples, generated locally by a
model on your own GPU**. Nothing here is shipped in the game yet. It is the
machinery, and a first set of candidates to listen to.

## The model

Stable Audio 3 Small-SFX, run through ComfyUI:

- checkpoint `stable_audio_3_small_sfx.safetensors` (2.1 GB), from
  [`Comfy-Org/stable-audio-3`](https://huggingface.co/Comfy-Org/stable-audio-3)
- text encoder `t5gemma_b_b_ul2.safetensors` (1.1 GB), from the same repository
- the graph is plain ComfyUI: `CheckpointLoaderSimple` + `CLIPLoader` +
  `KSampler` + `VAEDecodeAudio`, no custom nodes

Both files are ungated, so there is no account, no token and no credit to
generate with. Everything runs on the machine's own GPU.

**Licence.** The weights are under the
[Stability AI Community License](https://huggingface.co/stabilityai/stable-audio-3-small-sfx),
not Apache or MIT. Free to use, including commercially, while annual revenue is
under $1M, and it asks for the attribution "Made with Stable Audio".

**This game is free forever**, so the revenue cap never binds and the licence
is fine as it stands. The one condition is the attribution, and it has to go
where the player can see it before any of these samples ship. The alternative
lane, MOSS-SoundEffect-v2.0, is Apache-2.0 and would drop the condition
entirely, but it needs its own install; see issue #4.

Both tools need `numpy` and PyAV. The ComfyUI python in the portable install
has both:

```sh
<ComfyUI>/python_embeded/python.exe tools/sfx/generate.py
```

## The format: mp3

The samples are **mp3**, 44.1 kHz, one channel, 128 kbit/s.

- Every browser decodes mp3, including the old ones. That is worth more than
  the last few kilobytes.
- It is about eight times smaller than the wav it replaced: the fourteen
  files here went from 934 KB to 196 KB.
- One channel because `sfx.ts` pans every cue at runtime, so a stereo file
  would be wasted bytes.
- The encoder is PyAV's (`libmp3lame`), because ComfyUI already ships it.
  There is no ffmpeg on PATH and nothing to install.

Opus would be smaller again, and Chrome, Firefox and Safari can decode it -
but Safari only for WebM, and only in recent versions, and a cue that silently
does not play is worse than a cue that is 4 KB larger.

**One thing to know when the game starts playing these.** An mp3 carries an
encoder delay of about 13 ms at the front. Chrome and Firefox remove it,
because they read the gapless tag; Safari's decoder may not. Measured in
Chrome: the sound starts 0.4 ms into the file, exactly where it starts in the
wav. The loader should still trim the leading silence when it reads a sample,
so the timing is the same everywhere.

## Generating

With ComfyUI running on `http://127.0.0.1:8188`:

```sh
python tools/sfx/generate.py
python tools/sfx/generate.py --only hit-claw-skin
python tools/sfx/generate.py --keep-raw      # also keeps the untouched output
```

The samples land in `tools/sfx/samples/`, beside the tool and not in
`public/`: a file in `public/` is shipped in the build, and nothing loads
these yet. When the game starts playing them they move to `public/sfx/`.

Each cue gives a trimmed, faded, one channel mp3. The untouched model output
is a flac of no use to the game, so it is only kept with `--keep-raw`.

The cues and their prompts are in
[`prompts.json`](../tools/sfx/prompts.json). That file is the whole authoring
surface: a cue is an id, a prompt, a length and a seed.

## What a prompt looks like

Stable Audio 3 answers to a description of the sound, not to a list of tags.
The prompts here name the **source**, the **material**, the **room** and the
**count**:

> A bare-knuckle punch lands hard on flesh: a dull fleshy thud with a short wet
> slap on top of it. Close microphone, dry room, one single impact.

Two details matter more than they look:

- **"one single impact"** - without it the model will write a sequence, and the
  game wants one hit that can be fired eight times in a frame.
- **"dry room"** - the game mixes its cues under a crowd and a stage bed. A
  reverb on the sample fights both.

## The reference

`tools/sfx/synth_reference.py` renders the game's *current* sounds offline, so
a generated sample can be compared against what the game plays today:

```sh
python tools/sfx/synth_reference.py --out tools/sfx/reference
```

It reproduces the `hit` and `swing` voices from `src/render/sfx.ts`: the same
exponential envelopes, the same uniform noise, the same falling pitch. If
those voices change, change the script to match - they are marked in the
comments. All four variants share one level, so the heavy hit stays louder
than the light one the way it does in the game.

## Where this is going

The impact library should be keyed by **contact material**, not by cue name:
`src/sim/limbs.ts` rolls a limb tip (`fist`, `claw`, `hoof`, `club`, `spike`)
and the tip is what actually touches the body. So the sound of a hit is a
function of the tip and the body it lands on, modulated by the limb's mass and
speed - not a single `hit` sound.

`prompts.json` starts that grid: five tips against flesh, and two of them
against armour, so the material axis can be heard before it is believed.
