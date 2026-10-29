// The approved props, and where each one goes in the game.
//
// The table is written by `tools/props/build_prop_table.py` from the asset
// manifest. Only a prop a human has approved is in it: an asset that is still
// being built, or that a reviewer has asked to be redone, is not in the game.
//
// The kinds are how the game treats a prop:
//   gear     it rides on a bone and replaces a piece of the fighter's kit
//   wielded  it is the fighter's own weapon, in their hand from the start
//   gift     it belongs to the Gallery: thrown into the pit, picked up, held
import propsJson from "./props.json";

export type PropKind = "gear" | "wielded" | "gift";

export interface PropSpec {
  /** the manifest's id for the prop */
  id: string;
  name: string;
  kind: PropKind;
  /** the fighter's slug; "" for a prop that belongs to nobody yet */
  fighter: string;
  /** the piece of kit it replaces, in the fighter's own words */
  gear: string;
  /** the Gallery's throw it is, for the gifts */
  throw: string;
  url: string;
  /** the bone it rides on: head, spine, forearms, hand */
  bone: string;
  /** where on that bone, in metres */
  offset: [number, number, number];
  /** how it is turned, in radians */
  turn: [number, number, number];
  /** how much bigger it is than the asset the pipeline built */
  scale: number;
}

const raw = propsJson as unknown as { props: PropSpec[] };

/** Every prop in the game. */
export const PROPS: PropSpec[] = raw.props;

/** A prop, by its id. */
export const PROP_BY_ID: Record<string, PropSpec> = Object.fromEntries(PROPS.map((p) => [p.id, p]));

/** The Gallery's throws that have an asset in the game. */
export const GIFT_PROPS: PropSpec[] = PROPS.filter((p) => p.kind === "gift");

/** A gift, by the Gallery's throw id. */
export const GIFT_BY_THROW: Record<string, PropSpec> = Object.fromEntries(GIFT_PROPS.map((p) => [p.throw, p]));

/** The 3D gear a fighter wears, in place of the game's own drawing of it. */
export function gearPropsFor(fighter: string): PropSpec[] {
  return PROPS.filter((p) => p.kind === "gear" && p.fighter === fighter);
}

/** The weapon a fighter carries from the start, if they have one. */
export function wieldedPropFor(fighter: string): PropSpec | undefined {
  return PROPS.find((p) => p.kind === "wielded" && p.fighter === fighter);
}
