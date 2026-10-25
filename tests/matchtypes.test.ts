// The menu picks a kind of match, and each kind is played on its arenas in turn.
import { describe, expect, it } from "vitest";
import { MATCH_TYPES, PLAYABLE_STAGES, STAGES, arenasOf, typeOf } from "../src/sim/stages";

describe("match types", () => {
  it("every stage plays exactly one kind of match", () => {
    for (const st of STAGES) expect(MATCH_TYPES.filter((t) => t.stages.includes(st.id)), st.id).toHaveLength(1);
  });

  it("the throne and the flagpole are king of the hill; the tower and the blimp last one standing", () => {
    expect(typeOf("hell-toilet").id).toBe("king");
    expect(typeOf("castle-under-siege").id).toBe("king");
    expect(typeOf("collapsing-tower").id).toBe("last");
    expect(typeOf("hindenburg-blimp").id).toBe("last");
    expect(typeOf("construction-site").id).toBe("kos");
  });

  it("every kind of match has an arena to play on, and every playable arena is reachable", () => {
    for (const t of MATCH_TYPES) expect(arenasOf(t).length, t.id).toBeGreaterThan(0);
    const reachable = new Set(MATCH_TYPES.flatMap(arenasOf));
    for (const st of PLAYABLE_STAGES) expect(reachable.has(st.id), st.id).toBe(true);
  });
});
