// The stages of Pitfighter. A stage sets the arena and the way a match is
// won; its rules live in arena.ts. A stage that is not playable is listed on
// the select screen as "coming soon" and cannot start a match.

export type StageId = "hell-toilet" | "construction-site" | "collapsing-tower" | "hindenburg-blimp" | "castle-under-siege";

export interface Stage {
  id: StageId;
  name: string;
  blurb: string;
  playable: boolean;
}

export const STAGES: readonly Stage[] = [
  {
    id: "hell-toilet",
    name: "Hell Toilet",
    blurb: "A ring of hellfire with the last toilet in hell in the middle. Sit on it for 15 seconds in total to win; any hit knocks you off.",
    playable: true,
  },
  {
    id: "construction-site",
    name: "Construction Site",
    blurb: "Pour the Foundation: everyone starts in a different construction machine, each with its own attack, and cement sacks and rubble land across the yard. Carry them to the pit in the middle (or haul a load in a dump truck, loader or forklift) and the first to fill their share wins. Hit a carrier and they drop it. Wrecks can be repaired: hold USE at one.",
    playable: true,
  },
  {
    id: "collapsing-tower",
    name: "Collapsing Tower",
    blurb: "A rooftop that falls apart tile by tile, from the edges in. Knock people off; nobody comes back. Last one standing wins.",
    playable: true,
  },
  {
    id: "hindenburg-blimp",
    name: "Hindenburg Blimp",
    blurb: "On top of the doomed airship: gusts blow you to the edge and the fire creeps forward. Then it hits the ground and the wreck burns: last one aboard wins, or whoever has the most limbs on when the fire burns out.",
    playable: true,
  },
  {
    id: "castle-under-siege",
    name: "Castle Under Siege",
    blurb: "Brawl on the walls under catapult stones and arrow volleys. Stand at the keep's flagpole to raise your banner: 10 seconds alone wins, slower while it is contested; the breaches in the wall are a long way down.",
    playable: true,
  },
];

export const DEFAULT_STAGE: StageId = "hell-toilet";

export function stageById(id: StageId): Stage {
  const st = STAGES.find((s) => s.id === id);
  if (!st) throw new Error(`unknown stage ${id}`);
  return st;
}

export const PLAYABLE_STAGES: readonly Stage[] = STAGES.filter((s) => s.playable);

/**
 * What the menu picks: the kind of match. Each kind is played on its arenas in
 * turn, and more arenas of a kind can join it later.
 */
export type MatchTypeId = "king" | "last" | "kos";

export interface MatchType {
  id: MatchTypeId;
  name: string;
  blurb: string;
  stages: readonly StageId[];
}

export const MATCH_TYPES: readonly MatchType[] = [
  {
    id: "king",
    name: "King of the Hill",
    blurb: "Take the one spot that matters and hold it: the last toilet in hell, the castle's flagpole. Any hit knocks you off it.",
    stages: ["hell-toilet", "castle-under-siege"],
  },
  {
    id: "last",
    name: "Last One Standing",
    blurb: "Knock them off the edge. Nobody comes back, and the arena is falling apart under all of you.",
    stages: ["collapsing-tower", "hindenburg-blimp"],
  },
  { id: "kos", name: "Foundation Race", blurb: "Be first to fill the foundation pit with cement and rubble. Carry it, haul it, steal it; the beaten come back, so keep taking it back.", stages: ["construction-site"] },
];

export function matchTypeById(id: MatchTypeId): MatchType {
  const t = MATCH_TYPES.find((x) => x.id === id);
  if (!t) throw new Error(`unknown match type ${id}`);
  return t;
}

/** The kind of match a stage plays. */
export function typeOf(stage: StageId): MatchType {
  const t = MATCH_TYPES.find((x) => x.stages.includes(stage));
  if (!t) throw new Error(`stage ${stage} has no match type`);
  return t;
}

/** A match type's arenas that can be played now. */
export function arenasOf(t: MatchType): StageId[] {
  return t.stages.filter((id) => stageById(id).playable);
}
