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
    blurb: "Everyone starts in a different construction vehicle. Run people over, wreck the machines and dodge the crane's falling steel. First to 4 KOs owns the yard.",
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
    blurb: "On top of the doomed airship: gusts blow you to the edge and the fire creeps forward. Then it hits the ground, and the burning wreck finishes off whoever is left. Last one standing wins.",
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
