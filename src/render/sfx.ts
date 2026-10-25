// Sound, synthesised with Web Audio: no sample files, so the game stays a
// static page. Every cue of a step maps to a short voice (filtered noise and
// pitched oscillators), panned by where it happened. A bed for the stage (the
// lava's rumble, idling engines, wind at altitude, propellers, a siege) and a
// crowd loop under the match; the crowd swells on big moments.
//
// The AudioContext is only created after a key press, click or touch (the
// browser's autoplay rule). M mutes; ?mute=1 starts muted.
import type { Cue } from "./cues";
import type { World } from "../sim/world";
import type { StageId } from "../sim/stages";

type Voice = (t: number, out: AudioNode, k: number) => void;

const MUTE_KEY = "pitfighter.mute";

export class Sfx {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private crowd: GainNode | null = null;
  private bed: AudioScheduledSourceNode[] = [];
  private bedStage: StageId | null = null;
  private hype = 0;
  muted = false;
  /** voices started, by cue kind (automated tests) */
  readonly played: Record<string, number> = {};

  constructor(win: Window = window) {
    try {
      this.muted = new URLSearchParams(win.location.search).get("mute") === "1" || win.localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* storage blocked: start unmuted */
    }
    const unlock = () => this.unlock();
    for (const ev of ["keydown", "pointerdown", "touchstart"]) win.addEventListener(ev, unlock, { passive: true });
    win.addEventListener("keydown", (e) => {
      if (e.code === "KeyM") this.setMuted(!this.muted);
    });
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch {
      /* not remembered */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(comp);
    const sr = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, sr, sr);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.brown = ctx.createBuffer(1, sr * 2, sr);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
  }

  // ------------------------------------------------------------ building blocks
  private env(t: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  private noiseHit(t: number, out: AudioNode, type: BiquadFilterType, f0: number, f1: number, q: number, peak: number, dur: number): void {
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const flt = c.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.env(t, peak, 0.004, dur);
    src.connect(flt).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private tone(t: number, out: AudioNode, type: OscillatorType, f0: number, f1: number, peak: number, dur: number, attack = 0.003): void {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = this.env(t, peak, attack, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  // ------------------------------------------------------------ voices
  private readonly voices: Record<string, Voice> = {
    swing: (t, o, k) => this.noiseHit(t, o, "bandpass", 500, 2600 + k * 800, 1.4, 0.16 + 0.12 * k, 0.12 + 0.08 * k),
    hit: (t, o, k) => {
      // body thump, a crack on top, and a heavy low tail for big hits
      this.tone(t, o, "sine", 150 + 40 * (1 - k), 45, 0.7 + 0.3 * k, 0.12 + 0.12 * k);
      this.noiseHit(t, o, "bandpass", 2200, 700, 0.9, 0.55, 0.05 + 0.03 * k);
      if (k > 0.5) this.noiseHit(t, o, "lowpass", 900, 120, 0.7, 0.6 * k, 0.25);
    },
    block: (t, o) => {
      this.tone(t, o, "triangle", 1100, 600, 0.35, 0.06);
      this.noiseHit(t, o, "highpass", 3000, 2000, 0.7, 0.35, 0.05);
    },
    reversal: (t, o) => {
      this.noiseHit(t, o, "highpass", 1500, 6000, 0.8, 0.45, 0.18);
      this.tone(t, o, "sine", 500, 1900, 0.3, 0.16);
      this.tone(t, o, "sine", 140, 50, 0.6, 0.15);
    },
    grab: (t, o) => this.noiseHit(t, o, "lowpass", 700, 250, 0.8, 0.5, 0.09),
    throw: (t, o) => {
      this.noiseHit(t, o, "bandpass", 300, 1800, 1.2, 0.35, 0.3);
      this.tone(t, o, "sine", 120, 45, 0.5, 0.2);
    },
    land: (t, o) => {
      this.tone(t, o, "sine", 90, 38, 0.8, 0.22);
      this.noiseHit(t, o, "lowpass", 500, 90, 0.7, 0.55, 0.22);
    },
    // up into a juggle: a rising whoosh; off the floor again: a softer thud
    launch: (t, o) => {
      this.noiseHit(t, o, "bandpass", 400, 2400, 1.1, 0.3, 0.35);
      this.tone(t, o, "sine", 140, 420, 0.3, 0.3);
    },
    crunch: (t, o) => {
      this.noiseHit(t, o, "lowpass", 1400, 160, 1.3, 0.6, 0.28);
      this.tone(t, o, "square", 95, 40, 0.35, 0.14);
    },
    bounce: (t, o) => {
      this.tone(t, o, "sine", 110, 50, 0.6, 0.16);
      this.noiseHit(t, o, "lowpass", 500, 120, 0.6, 0.4, 0.16);
    },
    detach: (t, o) => {
      this.noiseHit(t, o, "bandpass", 1400, 260, 3, 0.6, 0.22);
      this.tone(t, o, "sawtooth", 320, 70, 0.18, 0.2);
    },
    burn: (t, o) => this.noiseHit(t, o, "highpass", 4000, 2500, 0.5, 0.25, 0.7),
    ko: (t, o) => {
      this.tone(t, o, "sine", 85, 28, 1, 0.7);
      this.noiseHit(t, o, "lowpass", 1500, 60, 0.6, 0.8, 0.6);
      this.tone(t + 0.05, o, "sawtooth", 220, 55, 0.15, 0.5);
    },
    special: (t, o) => {
      this.tone(t, o, "sawtooth", 110, 440, 0.22, 0.35, 0.02);
      this.noiseHit(t, o, "bandpass", 300, 4000, 2, 0.4, 0.35);
    },
    sit: (t, o) => {
      this.tone(t, o, "sine", 880, 880, 0.25, 0.5, 0.01);
      this.tone(t + 0.08, o, "sine", 1320, 1320, 0.2, 0.6, 0.01);
    },
    unseat: (t, o) => this.tone(t, o, "triangle", 660, 220, 0.25, 0.25),
    win: (t, o) => {
      // the flush
      this.noiseHit(t, o, "bandpass", 1800, 250, 1.5, 0.7, 1.6);
      for (const [i, f] of [523, 659, 784, 1047].entries()) this.tone(t + 0.25 + i * 0.12, o, "square", f, f, 0.12, 0.35, 0.01);
    },
    geyser: (t, o) => {
      this.noiseHit(t, o, "lowpass", 300, 80, 0.7, 0.9, 0.9);
      this.noiseHit(t, o, "highpass", 2500, 5000, 0.5, 0.3, 0.6);
    },
    dizzy: (t, o) => {
      for (let i = 0; i < 3; i++) this.tone(t + i * 0.09, o, "sine", 1400 - i * 200, 1600 - i * 200, 0.12, 0.08);
    },
    punt: (t, o) => this.tone(t, o, "sine", 240, 90, 0.5, 0.1),
    reattach: (t, o) => this.tone(t, o, "sine", 300, 900, 0.25, 0.12),
    regrow: (t, o) => this.tone(t, o, "sine", 300, 900, 0.2, 0.12),
    respawn: (t, o) => this.tone(t, o, "triangle", 200, 600, 0.2, 0.3, 0.05),
    crowd: (t, o) => this.noiseHit(t, o, "bandpass", 700, 1100, 0.8, 0.5, 0.8),
    // ---- the stages
    "win:other": (t, o) => {
      for (const [i, f] of [392, 523, 659, 784, 1047].entries()) this.tone(t + i * 0.11, o, "sawtooth", f, f, 0.1, 0.4, 0.01);
      this.noiseHit(t, o, "bandpass", 600, 1200, 0.7, 0.4, 1.2);
    },
    fall: (t, o) => {
      // the long scream down
      this.tone(t, o, "triangle", 900, 160, 0.22, 1.3, 0.02);
      this.noiseHit(t, o, "bandpass", 1500, 400, 2, 0.2, 1.1);
    },
    impact: (t, o) => {
      // the blimp hits the ground: a huge low crunch, then the frame groaning
      this.tone(t, o, "sine", 60, 18, 1, 1.6);
      this.noiseHit(t, o, "lowpass", 1800, 40, 0.5, 1, 2.2);
      this.noiseHit(t + 0.08, o, "bandpass", 2500, 600, 2, 0.5, 0.9);
      this.tone(t + 0.4, o, "sawtooth", 140, 90, 0.08, 1.4, 0.2);
    },
    crash: (t, o, k) => {
      this.tone(t, o, "square", 180 + 60 * k, 70, 0.3, 0.18);
      this.noiseHit(t, o, "bandpass", 2400, 900, 4, 0.5, 0.16);
      this.tone(t, o, "triangle", 1300, 1250, 0.12, 0.35);
    },
    wreck: (t, o) => {
      this.tone(t, o, "sine", 70, 24, 1, 1.0);
      this.noiseHit(t, o, "lowpass", 2500, 60, 0.6, 1, 1.4);
      this.noiseHit(t + 0.05, o, "bandpass", 3000, 1500, 3, 0.3, 0.4);
    },
    enter: (t, o) => {
      this.noiseHit(t, o, "lowpass", 600, 200, 1, 0.4, 0.08); // the door
      this.tone(t + 0.1, o, "sawtooth", 40, 90, 0.25, 0.5, 0.05); // the engine catches
    },
    exit: (t, o) => this.noiseHit(t, o, "lowpass", 700, 250, 1, 0.4, 0.08),
    crack: (t, o) => {
      this.noiseHit(t, o, "highpass", 2500, 1200, 1.5, 0.35, 0.12);
      this.tone(t, o, "sine", 120, 60, 0.25, 0.2);
    },
    collapse: (t, o) => {
      this.noiseHit(t, o, "lowpass", 400, 50, 0.6, 0.9, 1.4);
      this.tone(t, o, "sine", 55, 25, 0.6, 1.2);
    },
    wind: (t, o, k) => this.noiseHit(t, o, "bandpass", 300 + 400 * k, 900 + 900 * k, 1.2, 0.25 + 0.45 * k, 1.6 + 0.4 * k),
    capture: (t, o) => {
      // a horn from the walls
      this.tone(t, o, "sawtooth", 220, 220, 0.12, 0.6, 0.05);
      this.tone(t, o, "sawtooth", 330, 330, 0.08, 0.6, 0.05);
    },
    "geyser:beam": (t, o) => {
      this.tone(t, o, "square", 140, 60, 0.4, 0.3);
      this.tone(t, o, "triangle", 900, 880, 0.2, 0.9); // steel rings on impact
      this.noiseHit(t, o, "lowpass", 800, 100, 0.6, 0.7, 0.5);
    },
    "geyser:boulder": (t, o) => {
      this.tone(t, o, "sine", 75, 30, 0.9, 0.5);
      this.noiseHit(t, o, "lowpass", 1200, 80, 0.6, 0.9, 0.7);
    },
    "geyser:arrows": (t, o) => {
      for (let i = 0; i < 6; i++) this.noiseHit(t + i * 0.03, o, "highpass", 3000, 1500, 1, 0.2, 0.08);
    },
  };

  // ------------------------------------------------------------ match
  /** The stage's bed and the crowd loop. A new stage swaps the bed. */
  startAmbient(stage: StageId = "hell-toilet"): void {
    const c = this.ctx;
    if (!c) return;
    if (this.bedStage !== stage) {
      for (const n of this.bed) n.stop();
      this.bed = [];
      this.bedStage = stage;
      // [buffer, filter, cutoff, gain] noise layers, and [type, Hz, gain] drones
      const noise: [AudioBuffer, BiquadFilterType, number, number][] = [];
      const drones: [OscillatorType, number, number][] = [];
      if (stage === "hell-toilet") noise.push([this.brown, "lowpass", 220, 0.35]);
      else if (stage === "construction-site") {
        noise.push([this.brown, "lowpass", 160, 0.2]);
        drones.push(["sawtooth", 46, 0.025], ["sawtooth", 61, 0.018]); // diesels idling
      } else if (stage === "collapsing-tower") noise.push([this.noise, "bandpass", 420, 0.12], [this.brown, "lowpass", 120, 0.15]);
      else if (stage === "hindenburg-blimp") {
        noise.push([this.noise, "bandpass", 600, 0.1], [this.brown, "lowpass", 300, 0.2]); // wind, and the fire
        drones.push(["triangle", 38, 0.05]); // the engines' propellers
      } else noise.push([this.noise, "bandpass", 300, 0.08], [this.brown, "lowpass", 200, 0.2]);
      for (const [buf, type, f, gv] of noise) {
        const src = c.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const flt = c.createBiquadFilter();
        flt.type = type;
        flt.frequency.value = f;
        const g = c.createGain();
        g.gain.value = gv;
        src.connect(flt).connect(g).connect(this.master);
        src.start();
        this.bed.push(src);
      }
      for (const [type, f, gv] of drones) {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const flt = c.createBiquadFilter();
        flt.type = "lowpass";
        flt.frequency.value = 240;
        const g = c.createGain();
        g.gain.value = gv;
        o.connect(flt).connect(g).connect(this.master);
        o.start();
        this.bed.push(o);
      }
    }
    if (this.crowd) return;
    const crowd = c.createBufferSource();
    crowd.buffer = this.noise;
    crowd.loop = true;
    const cf = c.createBiquadFilter();
    cf.type = "bandpass";
    cf.frequency.value = 650;
    cf.Q.value = 0.6;
    this.crowd = c.createGain();
    this.crowd.gain.value = 0.05;
    crowd.connect(cf).connect(this.crowd).connect(this.master);
    crowd.start();
  }

  /** Play one step's cues. */
  cue(cues: Cue[], w: World): void {
    const c = this.ctx;
    if (!c || c.state !== "running") return;
    if (!this.crowd || this.bedStage !== w.s.stage) this.startAmbient(w.s.stage);
    const t = c.currentTime + 0.005;
    const perKind: Record<string, number> = {};
    for (const q of cues) {
      // a stage's own take on a cue: the hazard that struck, a win that is not a flush
      const what = (q as { what?: string }).what;
      const key = q.kind === "geyser" && what && what !== "geyser" ? `geyser:${what}` : q.kind === "win" && w.s.stage !== "hell-toilet" ? "win:other" : q.kind;
      const voice = this.voices[key];
      if (!voice) continue;
      // eight fighters can land a lot at once: at most three voices of a kind per step
      if ((perKind[q.kind] = (perKind[q.kind] ?? 0) + 1) > 3) continue;
      const who = q.kind === "hit" || q.kind === "block" ? (q as { b?: number }).b : q.a;
      const f = who !== undefined && who >= 0 ? w.s.fighters[who] : undefined;
      const pan = c.createStereoPanner();
      pan.pan.value = f ? Math.max(-1, Math.min(1, f.x / 9)) : 0;
      pan.connect(this.master);
      let k = 0;
      if (q.kind === "hit") k = Math.min(1, ((q as { dmg?: number }).dmg ?? 4) / 12);
      if (q.kind === "swing") k = (q as { heavy: boolean }).heavy ? 1 : 0;
      if (q.kind === "wind") k = what === "gust" ? 1 : 0;
      if (q.kind === "crash") k = Math.min(1, ((q as { dmg?: number }).dmg ?? 4) / 12);
      voice(t, pan, k);
      this.played[key] = (this.played[key] ?? 0) + 1;
      if (["ko", "reversal", "crowd", "special", "win", "fall", "wreck", "impact", "crunch"].includes(q.kind)) this.hype = Math.min(1, this.hype + 0.5);
      if (q.kind === "hit") this.hype = Math.min(1, this.hype + 0.04 * k);
    }
    if (this.crowd) {
      this.hype *= 0.985;
      this.crowd.gain.setTargetAtTime(0.05 + 0.35 * this.hype, t, 0.15);
    }
  }
}
