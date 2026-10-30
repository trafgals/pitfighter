// The character design, loaded from `src/data/characters.json`.
//
// That file is the one place a fighter is written down: its stats, its
// silhouette, its face, its textures and its special. The game reads it
// through the views below; the tools that generate assets from it read the
// same file, so the sound a fighter makes can never describe a different
// fighter from the one on screen.
//
// See docs/characters.md.
import charactersJson from "./characters.json";
import type { Character, Family, GalleryThrow, Kit, Special, SpecialId, Style } from "./types";

// The compiler cannot check a JSON import, so the schema is enforced by
// tests/characters.test.ts instead: it fails when a field is missing, when a
// part is not one the renderer knows, or when a number is out of range. That
// is a test-suite guarantee, not a build one — run `npm test` to get it.
const raw = charactersJson as unknown as {
  characters: Character[];
  specials: Record<SpecialId, Special>;
  theme: { gallery: { throws: GalleryThrow[] } };
};

/** Every fighter, in the order the game has always used them. The order is
 *  load-bearing: `Fighter.style` is an index into this array. */
export const CHARACTERS: Character[] = raw.characters;

/** The six specials: their frame data and the name the HUD shouts. */
export const SPECIALS: Record<SpecialId, Special> = raw.specials;

/** The Gallery's throws: the weapons it can toss into the pit. */
export const GALLERY_THROWS: GalleryThrow[] = raw.theme.gallery.throws;

/** A throw of the Gallery's, by its id. */
export const THROW_BY_ID: Record<string, GalleryThrow> = Object.fromEntries(
  GALLERY_THROWS.map((t) => [t.id, t]),
);

/** A special's display name, by id. */
export const SPECIAL_NAMES: Record<SpecialId, string> = Object.fromEntries(
  (Object.keys(SPECIALS) as SpecialId[]).map((id) => [id, SPECIALS[id].name]),
) as Record<SpecialId, string>;

/** A fighter's silhouette, by style label. */
export const KITS: Record<string, Kit> = Object.fromEntries(CHARACTERS.map((c) => [c.style, c.kit]));

/** The animation family a fighter fights in, by style label. */
export const FAMILY_OF: Record<string, Family> = Object.fromEntries(CHARACTERS.map((c) => [c.style, c.family]));

/** A fighter's index, by style label. */
export const STYLE_INDEX: Record<string, number> = Object.fromEntries(CHARACTERS.map((c, i) => [c.style, i]));

/** A fighter, by slug. */
export const CHARACTER_BY_ID: Record<string, Character> = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]));

/** "#b33a3a" -> 0xb33a3a */
const num = (hex: string): number => parseInt(hex.slice(1), 16);

/** A fighter as the sim has always seen it: the colours as numbers, the stats flat. */
export const STYLES: Style[] = CHARACTERS.map((c) => ({
  style: c.style,
  name: c.name,
  blurb: c.blurb,
  color: num(c.body),
  accent: num(c.accent),
  ...c.stats,
  special: c.special,
  specialName: c.specialName,
  airGrab: c.airGrab,
}));
