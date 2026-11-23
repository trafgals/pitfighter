# Music

Drop songs into a folder; the game plays them. One folder per stage id, plus `menu/`;
the Airship Benevolence has `boarding/`, `fire/` and `bridge/` inside `airship-benevolence/`.
Genre soundtracks live under `genres/<genre>/diner/`, named `<area>-<bpm>-<title>[-<variant>].webm`:
one area is one tempo, and the area number is the genre's BPM order, lowest first. So the
lowest-BPM `-a`/`-b` variants crossfade in area 1 and step up a tier on each area transition.
Several songs in a slot play with equal-power crossfades. See docs/sfx.md ("Adding music").

A stage's areas are a ladder: the Diner steps **+4 BPM a room**, the Laundromat **+6**. A
genre's set is therefore its lowest tempo and then every +4 (Diner) or +6 (Laundromat) up
from it; a record filed at any other tempo is not on the ladder and is taken out. Every
genre's Laundromat set fills all four of its rooms; on the Diner the set stops at the top
of the genre's band (`src/sim/genres.ts`), so a genre whose band is narrow reuses its lower
rooms further up the night.

Each genre also has a **tutorial** set, `genres/<slug>/tutorial/`: one area, at the genre's
base tempo (the tempo it opens on in the Diner), so the HOW TO PLAY lesson runs at the tempo
the fight is about to run at. It is named like any other set but is only ever cued by name -
a match never plays it.

A new or replaced song must be measured before it ships: `tools/audio/detect_beats.py` finds
its true tempo, bars and beat (the `<bpm>` in a name is what was asked for, not what came out)
into `src/data/beatgrids.json`, and the test suite fails on a song it has not measured.
See tools/audio/README.md ("Beat grids").

Whenever you generate or add a track under `public/music/`, store the generation prompt in
`src/data/musicPrompts.json` (keyed by the track's path relative to `public/music/`, e.g.
`"genres/house/diner/1-120-booth-request-a.webm"`), so the record crate's feedback issues can
reference the prompt that produced it.
