// One original hell fighter per Urban Reign fighting style. The style names are
// the 21 style labels in Urban Reign's own message table (ids 1347-1367,
// dumped from EE RAM); the characters, names and looks are ours.
//
// A style is a set of modifiers on the shared frame data, so every fighter
// keeps the same core feel (strings, reversals, grapples) and differs in
// tempo, reach and where its damage comes from, plus one special move.
//
// The design itself now lives in one place: src/data/characters.json. This
// module is the sim's view of it, and keeps the name and the shape it always
// had, so nothing else in the game had to change.
export { STYLES } from "../data/characters";
export type { Style } from "../data/types";
