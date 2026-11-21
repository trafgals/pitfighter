# Music

Drop songs into a folder; the game plays them. One folder per stage id, plus `menu/`;
the Airship Benevolence has `boarding/`, `fire/` and `bridge/` inside `airship-benevolence/`.
Genre soundtracks live under `genres/<genre>/diner/`, named `<area>-<bpm>-<title>[-<variant>].webm`:
one area is one tempo, and the area number is the genre's BPM order, lowest first. So the
lowest-BPM `-a`/`-b` variants crossfade in area 1 and step up a tier on each area transition.
Several songs in a slot play with equal-power crossfades. See docs/sfx.md ("Adding music").

A new or replaced song must be measured before it ships: `tools/audio/detect_beats.py` finds
its true tempo, bars and beat (the `<bpm>` in a name is what was asked for, not what came out)
into `src/data/beatgrids.json`, and the test suite fails on a song it has not measured.
See tools/audio/README.md ("Beat grids").
