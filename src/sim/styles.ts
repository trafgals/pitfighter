// One original hell fighter per Urban Reign fighting style. The style names are
// the 21 style labels in Urban Reign's own message table (ids 1347-1367,
// dumped from EE RAM); the characters, names and looks are ours.
//
// A style is a set of modifiers on the shared frame data, so every fighter
// keeps the same core feel (strings, reversals, grapples) and differs in
// tempo, reach and where its damage comes from.

export interface Style {
  style: string; // Urban Reign style label
  name: string;
  blurb: string;
  color: number; // body colour
  accent: number; // horns / trim
  speed: number; // walk speed multiplier
  startup: number; // frames added to every strike's startup (negative = faster); sized for the 12f jab
  punch: number; // punch damage multiplier
  kick: number; // kick damage multiplier
  grab: number; // throw / knee damage multiplier
  reach: number; // strike reach multiplier
  string: number; // high-string length before the finisher (1..3 jabs)
  torso: number; // torso HP multiplier
  grabReach: number;
}

const base = { speed: 1, startup: 0, punch: 1, kick: 1, grab: 1, reach: 1, string: 2, torso: 1, grabReach: 1 };
const s = (style: string, name: string, blurb: string, color: number, accent: number, mods: Partial<typeof base>): Style => ({
  style,
  name,
  blurb,
  color,
  accent,
  ...base,
  ...mods,
});

export const STYLES: Style[] = [
  s("All-Round", "Dale Damnation", "A regular sinner who's good at everything and great at nothing.", 0xb33a3a, 0x2b1a1a, {}),
  s("Power", "Brimstone Bruno", "Slow, enormous, hits like a falling furnace.", 0x7a2e1e, 0x111111, { speed: 0.85, startup: 4, punch: 1.35, kick: 1.2, grab: 1.2, torso: 1.25 }),
  s("Street", "Gutter Gus", "Learned to fight in the alleys behind the Ninth Circle.", 0x8a5a3a, 0x3a3a3a, { punch: 1.1, kick: 0.95, grab: 1.1 }),
  s("Karate", "Sensei Smoulder", "Crisp, straight lines; his fists leave scorch marks.", 0xd9d0c0, 0x1a1a1a, { startup: -2, punch: 1.1, kick: 1.05 }),
  s("Wrestling", "Big Lou Cipher", "Every hug in hell ends in a piledriver.", 0x6b2a6b, 0xf0c000, { speed: 0.9, grab: 1.5, grabReach: 1.25, punch: 0.9, torso: 1.15 }),
  s("Muay Thai", "Eight-Limbed Ash", "Knees, elbows, shins - and the ashes of all four.", 0xc06020, 0x202020, { kick: 1.3, grab: 1.2, punch: 0.95 }),
  s("Boxing", "Knuckles Inferno", "Never learned to kick. Never needed to.", 0x2a4aa0, 0xd0d0d0, { startup: -2, punch: 1.3, kick: 0.6, string: 3 }),
  s("Rush", "Rage Reaper", "All forward pressure, no reverse gear.", 0xa01010, 0x000000, { speed: 1.15, startup: -2, punch: 1.05, torso: 0.9 }),
  s("Speed", "Quickfire Imp", "Small, fast and impossible to pin down.", 0xe05050, 0x400000, { speed: 1.3, startup: -4, punch: 0.75, kick: 0.75, torso: 0.8 }),
  s("Kung Fu", "Crimson Crane", "Long flowing strings that never seem to end.", 0xc03030, 0xf0d060, { startup: -2, string: 3, punch: 0.9, kick: 1.05 }),
  s("Mighty", "Hellmountain", "Not a fighter so much as a geological event.", 0x4a3a30, 0x902010, { speed: 0.75, startup: 6, punch: 1.5, kick: 1.3, grab: 1.3, torso: 1.4, string: 1 }),
  s("Submission", "Choke Chimera", "Once it has you, it does not let go.", 0x3a6a3a, 0x101010, { grab: 1.4, grabReach: 1.15, punch: 0.85, kick: 0.9 }),
  s("Military", "Sergeant Sulphur", "Drills the damned at 4 a.m. for eternity.", 0x4a5a2a, 0x202010, { punch: 1.05, kick: 1.05, grab: 1.15, torso: 1.1 }),
  s("Capoeira", "Cinder Ginga", "Dances over the lava, kicks from impossible angles.", 0xd08040, 0x2a1a0a, { speed: 1.1, kick: 1.25, reach: 1.12, punch: 0.8 }),
  s("Tae Kwon Do", "Hellkick Hana", "Her feet are faster than your hands.", 0xf0f0f0, 0xa00000, { kick: 1.35, reach: 1.1, punch: 0.85, startup: -2 }),
  s("Samurai Sword", "Ronin of Gehenna", "Lost his blade at the gates; fights with a pitchfork's reach.", 0x303040, 0xc0a030, { reach: 1.3, startup: 2, punch: 1.1 }),
  s("Master", "The Old Devil", "Older than sin, and annoyingly patient.", 0x902020, 0xe0e0e0, { startup: -2, punch: 1.1, kick: 1.1, grab: 1.1, speed: 0.95 }),
  s("Gun", "Hellfire Flick", "Flicks fireballs from his fingertips - well, short ones.", 0x404040, 0xff6000, { reach: 1.4, punch: 0.85, startup: 2 }),
  s("Martial Arts", "Brother Blaze", "Fast hands, faster feet, yells a lot.", 0xe0a040, 0x202020, { startup: -4, punch: 1.0, kick: 1.1, string: 3, torso: 0.95 }),
  s("Judo Based", "Ashen Judoka", "Turns your weight into your problem.", 0xe8e0d0, 0x101040, { grab: 1.35, grabReach: 1.1, punch: 1.05 }),
  s("Amateur", "Fresh Soul Kevin", "Died this morning. Still in his work lanyard.", 0x9a9a9a, 0x3a6aa0, { punch: 0.85, kick: 0.85, grab: 0.85, torso: 0.9, startup: 2 }),
];
