# Notice

The files in `samples/` were generated with **Stable Audio 3 Small-SFX**, from
Stability AI, under the
[Stability AI Community License](https://huggingface.co/stabilityai/stable-audio-3-small-sfx).
That licence asks for this attribution:

> Made with Stable Audio

It is not Apache and not MIT, and it is not OSI-approved. It is free to use,
including commercially, while annual revenue is under $1M. Two things follow:

- **PITFIGHTER is free forever**, so the revenue cap never binds and the
  licence is fine as it stands;
- the attribution above still has to go somewhere the player can see it,
  before any of these samples ship in the game.

The alternative lane, [MOSS-SoundEffect-v2.0](https://huggingface.co/mOSS-lab/MOSS-SoundEffect-v2.0),
is Apache-2.0 and would drop the attribution question entirely. It needs its
own install and is not wired up here. See issue #4.

The files in `reference/` are not affected: they are rendered by
`tools/sfx/synth_reference.py` from the game's own synthesis code, so they
carry whatever licence the game itself does. The repository has no `LICENSE`
file and no `license` field in `package.json`, which is worth settling
separately - a public repository with no licence reserves all rights by
default.
