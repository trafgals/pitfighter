// Input devices: two keyboard layouts plus up to 8 gamepads (HTML5 Gamepad API,
// "standard" mapping). Each device is read into the same PlayerInput the
// simulation consumes, plus a few menu edges for the character select.
import { BTN, type PlayerInput } from "./sim/types";

export interface DeviceRead extends PlayerInput {
  start: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export type DeviceId = string; // "kb1" | "kb2" | "pad0".."pad7"

const KEYMAPS: Record<string, { up: string; down: string; left: string; right: string; btn: Record<string, number>; start: string }> = {
  kb1: {
    up: "KeyW",
    down: "KeyS",
    left: "KeyA",
    right: "KeyD",
    start: "Enter",
    btn: { KeyJ: BTN.HIGH, KeyK: BTN.LOW, KeyL: BTN.GRAB, KeyI: BTN.REV, ShiftLeft: BTN.GUARD, KeyU: BTN.TARGET, KeyO: BTN.USE, KeyH: BTN.SPECIAL },
  },
  kb2: {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    start: "NumpadEnter",
    btn: { Numpad4: BTN.HIGH, Numpad5: BTN.LOW, Numpad6: BTN.GRAB, Numpad8: BTN.REV, Numpad0: BTN.GUARD, Numpad7: BTN.TARGET, Numpad9: BTN.USE, Numpad1: BTN.SPECIAL },
  },
};

// standard mapping: 0 Cross, 1 Circle, 2 Square, 3 Triangle, 4 L1, 5 R1, 6 L2, 7 R2, 9 Start, 12-15 d-pad
const PAD_BTN: [number, number][] = [
  [2, BTN.HIGH],
  [0, BTN.LOW],
  [1, BTN.GRAB],
  [3, BTN.REV],
  [5, BTN.GUARD],
  [4, BTN.TARGET],
  [7, BTN.USE],
  [6, BTN.SPECIAL],
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
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
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
    const r: DeviceRead = { x: 0, y: 0, buttons: 0, start: false, left: false, right: false, up: false, down: false };
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
    return r;
  }
}

export const CONTROLS_HELP = [
  "P1 keys: WASD move · J high · K low · L grab/throw · I reversal (Shift+I low reversal) · Shift guard · U switch target · O pick up / sit · H (or J+K) special",
  "P2 keys: arrows · Num4 high · Num5 low · Num6 grab · Num8 reversal · Num0 guard · Num7 target · Num9 pick up / sit · Num1 (or Num4+Num5) special",
  "Pads: □ high · ✕ low · ○ grab/throw · △ reversal (R1+△ low) · R1 guard · L1 target · R2 pick up / sit · L2 (or □+✕) special",
];
