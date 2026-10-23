// The stages of Pitfighter. A stage sets the arena and the way a match is
// won. Only playable stages can start a match; planned ones are listed on the
// select screen as "coming soon" so the roadmap is visible in the game.

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
    blurb: "Everyone starts in a different construction vehicle.",
    playable: false,
  },
  {
    id: "collapsing-tower",
    name: "Collapsing Tower",
    blurb: "The floor gives way under the fight.",
    playable: false,
  },
  {
    id: "hindenburg-blimp",
    name: "Hindenburg Blimp",
    blurb: "A fight aboard the doomed airship.",
    playable: false,
  },
  {
    id: "castle-under-siege",
    name: "Castle Under Siege",
    blurb: "Brawl on the walls while the siege rages around you.",
    playable: false,
  },
];

export const DEFAULT_STAGE: StageId = "hell-toilet";

export function stageById(id: StageId): Stage {
  const st = STAGES.find((s) => s.id === id);
  if (!st) throw new Error(`unknown stage ${id}`);
  return st;
}

export const PLAYABLE_STAGES: readonly Stage[] = STAGES.filter((s) => s.playable);
