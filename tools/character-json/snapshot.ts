// Print the frozen roster and special names, in the shape
// tests/characters.test.ts checks the design against. After a deliberate
// change to the roster, regenerate them and paste them into the test.
//
//   npx vite-node tools/character-json/snapshot.ts
import { CHARACTERS, SPECIALS } from "../../src/data/characters";

const q = (s: string) => JSON.stringify(s);

console.log("const ROSTER: [id: string, style: string][] = [");
for (const c of CHARACTERS) console.log(`  [${q(c.id)}, ${q(c.style)}],`);
console.log("];");
console.log();
console.log("const SPECIAL_SNAPSHOT: [string, string][] = [");
for (const [id, s] of Object.entries(SPECIALS)) console.log(`  [${q(id)}, ${q(s.name)}],`);
console.log("];");
