// The roster's movesets: the design half of src/data/characters.json.
//
// Every move a fighter has is written against the move vocabulary - an
// archetype grouped out of Urban Reign's own measured moves
// (docs/calibration/urban-reign-move-clusters.json) - and has to keep to that
// archetype's frame envelope, so a fighter built from the design moves at
// Urban Reign's tempo. Most of the verbs are not in the game yet; `systems`
// says which are, and the strikes that the sim plays today name the sim move
// that stands in for them.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import design from "../src/data/characters.json";
import clusters from "../docs/calibration/urban-reign-move-clusters.json";
import sfx from "../tools/sfx/prompts.json";
import { CHARACTERS } from "../src/data/characters";
import type { GrappleDesign, StrikeDesign } from "../src/data/types";
import { STRING_STARTS } from "../src/sim/moves";
import { World } from "../src/sim/world";

type Range = [number, number];
const vocab = design.vocabulary as unknown as {
  strikes: Record<string, { clusters: string[]; startup: Range; length: Range }>;
  grapples: Record<string, { band: string; duration: Range }>;
  own: { airGrab: { duration: Range } };
};
const within = (v: number, [lo, hi]: Range) => v >= lo && v <= hi;
const STRIKE_SLOTS = ["high", "low", "branches", "regional", "dash", "dive", "down", "headbutt", "double"] as const;
const GRAPPLE_SLOTS = ["hold", "clinch", "throws", "back", "wall", "grappleDash", "diveGrab", "ground", "deflects"] as const;
const list = <T,>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);
const isGrapple = (m: StrikeDesign | GrappleDesign): m is GrappleDesign => "duration" in m;

/** Every move a fighter has, the strikes and the grapples apart. */
function movesOf(c: (typeof CHARACTERS)[number]) {
  const strikes: StrikeDesign[] = STRIKE_SLOTS.flatMap((k) => c.moves[k]);
  const grapples: GrappleDesign[] = GRAPPLE_SLOTS.flatMap((k) => list(c.moves[k]));
  for (const m of c.moves.arts) (isGrapple(m) ? grapples : strikes).push(m as never);
  return { strikes, grapples };
}

/** A string from its opener, as the sim plays it for this fighter. */
function chain(style: number, from: string): string[] {
  const w = new World({ seed: 1, styles: [style, style], humans: [true, true] });
  const out: string[] = [];
  for (let id: string | undefined = from; id && out.length < 8; id = w.nextOf(w.fighters[0], id)) out.push(id);
  return out;
}

describe("the roster's movesets", () => {
  it("keeps every archetype's envelope inside the Urban Reign moves it was grouped from", () => {
    const byId = new Map(clusters.clusters.map((c) => [c.id, c]));
    for (const [id, a] of Object.entries(vocab.strikes)) {
      const cs = a.clusters.map((k) => byId.get(k)!);
      expect(cs.every(Boolean), id).toBe(true);
      expect(a.startup[0], id).toBeGreaterThanOrEqual(Math.min(...cs.map((c) => c.startup.min)));
      expect(a.startup[1], id).toBeLessThanOrEqual(Math.max(...cs.map((c) => c.startup.max)));
      expect(a.length[0], id).toBeGreaterThanOrEqual(Math.min(...cs.map((c) => c.length.min)));
      expect(a.length[1], id).toBeLessThanOrEqual(Math.max(...cs.map((c) => c.length.max)));
    }
    const bands = new Map(clusters.grappleBands.map((b) => [b.id, b]));
    for (const [id, a] of Object.entries(vocab.grapples)) {
      const b = bands.get(a.band)!;
      expect(b, id).toBeDefined();
      expect(a.duration[0], id).toBeGreaterThanOrEqual(b.length.min);
      expect(a.duration[1], id).toBeLessThanOrEqual(b.length.max);
    }
  });

  it("keeps every strike to its archetype's startup and length", () => {
    for (const c of CHARACTERS) {
      for (const m of movesOf(c).strikes) {
        const a = vocab.strikes[m.archetype];
        const where = `${c.id} ${m.id} (${m.archetype})`;
        expect(a, where).toBeDefined();
        expect(within(m.startup, a.startup), `${where} startup ${m.startup}`).toBe(true);
        expect(within(m.startup + m.active + m.recovery, a.length), `${where} length`).toBe(true);
        expect(m.active, where).toBeGreaterThan(0);
        expect(m.dmg, where).toBeGreaterThan(0);
        expect(["high", "mid", "low"], where).toContain(m.height);
      }
    }
  });

  it("keeps every grapple to its archetype's duration", () => {
    for (const c of CHARACTERS) {
      const all: Pick<GrappleDesign, "id" | "archetype" | "duration">[] = [...movesOf(c).grapples, { id: "duo", ...c.moves.duo }];
      for (const m of all) {
        const a = vocab.grapples[m.archetype];
        const where = `${c.id} ${m.id} (${m.archetype})`;
        expect(a, where).toBeDefined();
        expect(within(m.duration, a.duration), `${where} duration ${m.duration}`).toBe(true);
      }
      expect(within(c.airGrab.dur, vocab.own.airGrab.duration), c.id).toBe(true);
    }
  });

  it("gives every fighter the whole verb set", () => {
    for (const c of CHARACTERS) {
      const m = c.moves;
      expect(m.high, c.id).toHaveLength(c.stats.string + 1);
      expect(m.low, c.id).toHaveLength(3);
      expect(m.regional.map((r) => r.target), c.id).toEqual(["head", "body", "legs"]);
      expect(m.dive, c.id).toHaveLength(2);
      expect(m.throws, c.id).toHaveLength(4);
      expect(m.deflects, c.id).toHaveLength(2);
      expect(m.arts, c.id).toHaveLength(4);
      for (const k of ["branches", "dash", "down", "headbutt", "double", "clinch"] as const) expect(m[k].length, `${c.id} ${k}`).toBeGreaterThan(0);
      expect(m.special.sim, c.id).toBe(c.special);
      expect(m.special.name, c.id).toBe(c.specialName);
      expect(m.status.lasts, c.id).toBeGreaterThan(0);
      const { strikes, grapples } = movesOf(c);
      const ids = [...strikes, ...grapples].map((x) => x.id);
      expect(new Set(ids).size, `${c.id} move ids`).toBe(ids.length);
      for (const x of [...strikes, ...grapples]) {
        expect(x.name.length, `${c.id} ${x.id}`).toBeGreaterThan(0);
        expect(x.input.length, `${c.id} ${x.id}`).toBeGreaterThan(0);
        expect(x.anim.length, `${c.id} ${x.id}`).toBeGreaterThan(10);
      }
    }
  });

  it("names the sim move that plays each string strike today, in the order the sim plays them", () => {
    for (const [i, c] of CHARACTERS.entries()) {
      expect(c.moves.high.map((m) => m.sim), c.id).toEqual(chain(i, STRING_STARTS.high));
      expect(c.moves.low.map((m) => m.sim), c.id).toEqual(chain(i, STRING_STARTS.low));
      expect(c.moves.dash[0].sim, c.id).toBe("dashStrike");
      expect(c.moves.headbutt[0].sim, c.id).toBe("headbutt");
    }
  });

  it("puts every rival and partner on the roster, and the double-team with the partner", () => {
    const ids = new Set(CHARACTERS.map((c) => c.id));
    for (const c of CHARACTERS) {
      expect(c.profile.rivals.length, c.id).toBeGreaterThan(0);
      for (const r of c.profile.rivals) {
        expect(ids.has(r.id), `${c.id} rival ${r.id}`).toBe(true);
        expect(r.id, c.id).not.toBe(c.id);
      }
      expect(ids.has(c.profile.partner.id), `${c.id} partner`).toBe(true);
      expect(c.profile.partner.id, c.id).not.toBe(c.id);
      expect(c.moves.duo.partner, c.id).toBe(c.profile.partner.id);
    }
  });

  it("makes every fighter's limbs in a craft of their own", () => {
    const crafts = new Map(design.crafts.map((k) => [k.id, k]));
    expect(crafts.size).toBe(CHARACTERS.length);
    expect(new Set(CHARACTERS.map((c) => c.limbs.craft)).size).toBe(CHARACTERS.length);
    for (const c of CHARACTERS) {
      const k = crafts.get(c.limbs.craft);
      expect(k, c.id).toBeDefined();
      expect(c.limbs.tip, c.id).toBe(k!.tip);
      expect(c.sound.impact.craft, c.id).toBe(c.limbs.craft);
    }
  });

  it("gives every fighter a signature weapon the Gallery throws, and no two the same", () => {
    const throws = new Map(design.theme.gallery.throws.map((t) => [t.id, t]));
    expect(throws.size).toBe(design.theme.gallery.throws.length);
    const classes = new Set(design.theme.gallery.throws.map((t) => t.class));
    for (const c of CHARACTERS) {
      expect(throws.has(c.moves.weapons.signature), c.id).toBe(true);
      for (const a of c.moves.weapons.affinity) expect(classes.has(a), `${c.id} ${a}`).toBe(true);
    }
    expect(new Set(CHARACTERS.map((c) => c.moves.weapons.signature)).size).toBe(CHARACTERS.length);
  });

  it("gives every sound cue an id and a seed of its own, apart from the shipped set", () => {
    const cues = [...design.crafts.flatMap((k) => (k.cue ? [k.cue] : [])), ...CHARACTERS.flatMap((c) => c.sound.cues)];
    const ids = [...cues.map((q) => q.id), ...sfx.cues.map((q) => q.id)];
    const seeds = [...cues.map((q) => q.seed), ...sfx.cues.map((q) => q.seed)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(seeds).size).toBe(seeds.length);
    for (const q of cues) {
      expect(["impact", "swing", "voice", "foley"], q.id).toContain(q.category);
      expect(q.prompt.length, q.id).toBeGreaterThan(40);
    }
    expect(new Set(CHARACTERS.map((c) => c.texture.seed)).size).toBe(CHARACTERS.length);
  });

  it("says which verbs the game has, and where the ones it has live", () => {
    const ids = design.systems.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of design.systems) {
      expect(["implemented", "partial", "planned"], s.id).toContain(s.status);
      if (s.status === "implemented") {
        expect(s.where, s.id).toBeDefined();
        const file = s.where!.match(/src\/\S+\.ts/)![0];
        expect(existsSync(file), `${s.id}: ${file}`).toBe(true);
      }
    }
  });
});
