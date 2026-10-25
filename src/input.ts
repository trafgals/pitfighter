// Input devices: two keyboard layouts plus up to 8 gamepads (HTML5 Gamepad API,
// "standard" mapping). Each device is read into the same PlayerInput the
// simulation consumes, plus a few menu edges for the character select.
import { BTN, type PlayerInput } from "./sim/types";

export interface DeviceRead extends PlayerInput {
  start: boolean;
  moves: boolean; // the move list: Tab, Num. or a pad's Select
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export type DeviceId = string; // "kb1" | "kb2" | "pad0".."pad7"

const KEYMAPS: Record<string, { up: string; down: string; left: string; right: string; btn: Record<string, number>; start: string; moves: string }> = {
  kb1: {
    up: "KeyW",
    down: "KeyS",
    left: "KeyA",
    right: "KeyD",
    start: "Enter",
    moves: "Tab",
    btn: { KeyJ: BTN.HIGH, KeyK: BTN.GRAB, KeyL: BTN.REV, ShiftLeft: BTN.DASH, KeyQ: BTN.LOCK, KeyU: BTN.TARGET, KeyO: BTN.USE, KeyH: BTN.TAUNT, KeyY: BTN.SPECIAL },
  },
  kb2: {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    start: "NumpadEnter",
    moves: "NumpadDecimal",
    // the numpad's 8 / 4 / 6 / 2 sit where a pad's Triangle / Square / Circle / Cross do
    btn: { Numpad6: BTN.HIGH, Numpad8: BTN.GRAB, Numpad4: BTN.REV, Numpad2: BTN.DASH, Numpad9: BTN.LOCK, Numpad0: BTN.TARGET, Numpad7: BTN.USE, Numpad1: BTN.TAUNT, Numpad3: BTN.SPECIAL },
  },
};

// standard mapping: 0 Cross, 1 Circle, 2 Square, 3 Triangle, 4 L1, 5 R1, 6 L2, 7 R2, 9 Start, 11 R3, 12-15 d-pad.
// Urban Reign's layout: Circle strike, Triangle grapple, Square dodge / deflect,
// Cross run / dash, L1 pick up, L2 taunt, R1 lock on, Circle + Triangle the special.
export const PAD_BTN: [number, number][] = [
  [1, BTN.HIGH],
  [3, BTN.GRAB],
  [2, BTN.REV],
  [0, BTN.DASH],
  [4, BTN.USE],
  [5, BTN.LOCK],
  [6, BTN.TAUNT],
  [7, BTN.SPECIAL],
  [11, BTN.TARGET],
];

export class Input {
  private keys = new Set<string>();
  // keys pressed since the last frame: a tap shorter than one frame still reads as held for that frame
  private tapped = new Set<string>();
  private view = { has: (code: string) => this.keys.has(code) || this.tapped.has(code) };

  constructor(target: Window = window) {
    target.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      this.tapped.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space" || e.code === "Tab") e.preventDefault();
    });
    target.addEventListener("keyup", (e) => this.keys.delete(e.code));
    target.addEventListener("blur", () => this.keys.clear());
  }

  /** Call once per rendered frame, after everything has read the input. */
  endFrame(): void {
    this.tapped.clear();
  }

  /** Inject key state (used by automated tests). */
  setKey(code: string, down: boolean): void {
    if (down) {
      this.keys.add(code);
      this.tapped.add(code);
    } else this.keys.delete(code);
  }

  devices(): DeviceId[] {
    const out: DeviceId[] = ["kb1", "kb2"];
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length && i < 8; i++) if (pads[i]?.connected) out.push(`pad${i}`);
    return out;
  }

  read(dev: DeviceId): DeviceRead {
    const r: DeviceRead = { x: 0, y: 0, buttons: 0, start: false, moves: false, left: false, right: false, up: false, down: false };
    const km = KEYMAPS[dev];
    if (km) {
      const k = this.view;
      r.left = k.has(km.left);
      r.right = k.has(km.right);
      r.up = k.has(km.up);
      r.down = k.has(km.down);
      r.x = (r.right ? 1 : 0) - (r.left ? 1 : 0);
      r.y = (r.up ? 1 : 0) - (r.down ? 1 : 0);
      for (const [code, b] of Object.entries(km.btn)) if (k.has(code)) r.buttons |= b;
      r.start = k.has(km.start) || (dev === "kb1" && k.has("Space"));
      r.moves = k.has(km.moves);
      return r;
    }
    const pad = navigator.getGamepads?.()[Number(dev.slice(3))];
    if (!pad || !pad.connected) return r;
    const b = (i: number) => !!pad.buttons[i]?.pressed;
    let x = pad.axes[0] ?? 0;
    let y = -(pad.axes[1] ?? 0);
    if (Math.hypot(x, y) < 0.25) x = y = 0;
    if (b(12)) y = 1;
    if (b(13)) y = -1;
    if (b(14)) x = -1;
    if (b(15)) x = 1;
    r.x = x;
    r.y = y;
    r.left = x < -0.5;
    r.right = x > 0.5;
    r.up = y > 0.5;
    r.down = y < -0.5;
    for (const [i, bit] of PAD_BTN) if (b(i)) r.buttons |= bit;
    r.start = b(9);
    r.moves = b(8);
    return r;
  }
}

export const CONTROLS_HELP = [
  "P1 keys: WASD move · J strike (back+J low) · K grapple/throw · L deflect (+direction: evade) · Shift dash, hold to run · Q hold to lock on · U switch target · O pick up / sit · H taunt · Y (or J+K) special",
  "P2 keys: arrows · Num6 strike · Num8 grapple · Num4 deflect/evade · Num2 dash/run · Num9 lock on · Num0 target · Num7 pick up / sit · Num1 taunt · Num3 (or Num6+Num8) special",
  "Pads: ○ strike (back+○ low) · △ grapple/throw · □ deflect (+stick: evade) · ✕ dash, hold to run · R1 lock on · R3 target · L1 pick up / sit · L2 taunt · ○+△ (or R2) special",
];
