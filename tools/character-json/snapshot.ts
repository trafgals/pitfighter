// Print the frozen snapshot of the character design, in the shape
// tests/characters.test.ts checks it against.
import { CHARACTERS, SPECIALS } from "../../src/data/characters";

const q = (s: string) => JSON.stringify(s);

console.log("const SNAPSHOT: Snapshot[] = [");
for (const c of CHARACTERS) {
  const stats = [
    c.stats.speed,
    c.stats.startup,
    c.stats.punch,
    c.stats.kick,
    c.stats.grab,
    c.stats.reach,
    c.stats.string,
    c.stats.torso,
    c.stats.grabReach,
  ];
  const look = [c.look.def, c.look.scar, c.look.paint, c.look.wrinkles, c.look.stubble, c.look.veins];
  const gear = c.kit.gear.length ? c.kit.gear.map(q).join(", ") : "";
  console.log(
    `  { id: ${q(c.id)}, style: ${q(c.style)}, name: ${q(c.name)}, special: ${q(c.special)}, family: ${q(c.family)},` +
      ` size: ${c.kit.size}, horns: ${q(c.kit.horns)}, tail: ${q(c.kit.tail)}, gear: [${gear}],` +
      ` stats: [${stats.join(", ")}], look: [${look.join(", ")}], seed: ${c.texture.seed} },`,
  );
}
console.log("];");
console.log();
console.log("const SPECIAL_SNAPSHOT: [string, string][] = [");
for (const [id, s] of Object.entries(SPECIALS)) {
  console.log(`  [${q(id)}, ${q(s.name)}],`);
}
console.log("];");
