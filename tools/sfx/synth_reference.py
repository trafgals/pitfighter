#!/usr/bin/env python3
"""Render the game's current synthesised sounds offline, so they can be compared
with generated ones.

`src/render/sfx.ts` builds every sound from Web Audio primitives: a bandpassed
noise burst for the crack, a pitched oscillator for the body. This script
reproduces two of those voices exactly as the browser would play them - the
`hit` (a thump, a crack and a low tail for the big ones) and the `swing` - and
writes them out as wav files.

The parameters live in `src/render/sfx.ts`; if that file changes, change them
here too. The two are marked in the comments below.

Needs numpy and PyAV. The ComfyUI python that ships with the portable install
has them:

    <ComfyUI>/python_embeded/python.exe tools/sfx/synth_reference.py

    python tools/sfx/synth_reference.py --out tools/sfx/reference
"""
from __future__ import annotations

import argparse
import math
import wave
from pathlib import Path

import numpy as np

import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio import write_mp3  # noqa: E402  (needs the path above)

ROOT = Path(__file__).resolve().parent
SR = 44100

# src/render/sfx.ts: the noise buffer is filled with Math.random() * 2 - 1
NOISE_SECONDS = 1.0
# src/render/sfx.ts: the gain never quite reaches zero
FLOOR = 0.0001
# src/render/sfx.ts: every voice stops 50 ms after its envelope has ended
TAIL = 0.05
# the level the game mixes at: a touch under full scale so the compressor in
# src/render/sfx.ts has something to work with
TARGET_PEAK = 10 ** (-1 / 20)


# ------------------------------------------------------------------ the pieces


def env(peak: float, attack: float, decay: float) -> np.ndarray:
    """src/render/sfx.ts: env() - the shape every voice uses.

    Web Audio ramps exponentially, not linearly, so this does too: a constant
    floor, an exponential climb to the peak over the attack, then an
    exponential fall back to the floor over the decay.
    """
    a = int(round(attack * SR))
    d = int(round(decay * SR))
    out = np.zeros(a + d, dtype=np.float64)
    top = max(0.0002, peak)
    if a > 0:
        out[:a] = FLOOR * (top / FLOOR) ** ((np.arange(a) + 1) / a)
    if d > 0:
        out[a:] = top * (FLOOR / top) ** (np.arange(d) / d)
    return out


def biquad_coeffs(kind: str, freq: float, q: float, fs: int = SR) -> tuple[float, float, float, float, float]:
    """RBJ cookbook coefficients, the same shape Web Audio's BiquadFilter uses."""
    w0 = 2.0 * math.pi * freq / fs
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2.0 * q)
    if kind == "bandpass":
        b0, b1, b2 = alpha, 0.0, -alpha
    elif kind == "lowpass":
        b0, b1, b2 = (1 - cw) / 2.0, 1 - cw, (1 - cw) / 2.0
    elif kind == "highpass":
        b0, b1, b2 = (1 + cw) / 2.0, -(1 + cw), (1 + cw) / 2.0
    else:
        raise ValueError(kind)
    a0, a1, a2 = 1 + alpha, -2 * cw, 1 - alpha
    return b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0


def sweep_filter(x: np.ndarray, kind: str, f0: float, f1: float, q: float, dur: int) -> np.ndarray:
    """A biquad whose cutoff glides from f0 to f1 over the first `dur` samples."""
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i in range(len(x)):
        t = min(i / dur, 1.0) if dur > 0 else 1.0
        freq = f0 * (f1 / f0) ** t if f0 > 0 and f1 > 0 else f1
        b0, b1, b2, a1, a2 = biquad_coeffs(kind, max(20.0, freq), q)
        xi = x[i]
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, xi
        y2, y1 = y1, yi
        y[i] = yi
    return y


def place(out: np.ndarray, at: int, seg: np.ndarray) -> np.ndarray:
    """Add a segment into the output, clipped to what fits."""
    n = min(len(seg), len(out) - at)
    if n > 0:
        out[at : at + n] += seg[:n]
    return out


def noise_hit(
    rng: np.random.Generator,
    kind: str,
    f0: float,
    f1: float,
    q: float,
    peak: float,
    dur: float,
    total: int,
    at: int = 0,
    attack: float = 0.004,
) -> np.ndarray:
    """src/render/sfx.ts: noiseHit() - noise through a sweeping filter.

    The browser plays a one second buffer of uniform noise from a random offset
    at a random playback rate, so the samples are read at fractional positions
    and interpolated.
    """
    rate = 0.8 + rng.random() * 0.4
    offset = rng.random() * 0.5
    buf = rng.uniform(-1.0, 1.0, int(NOISE_SECONDS * SR))

    n_env = int(round((attack + dur) * SR))
    n_src = int(round((dur + TAIL) * SR))
    # the source runs out at the end of the buffer
    n_avail = int(((1.0 - offset) / rate) * SR)
    n = min(n_src, n_avail)

    tau = np.arange(n) / SR
    pos = (offset + rate * tau) * SR
    base = np.floor(pos)
    i0 = np.clip(base.astype(int), 0, len(buf) - 1)
    i1 = np.clip(i0 + 1, 0, len(buf) - 1)
    frac = pos - base
    src = buf[i0] * (1 - frac) + buf[i1] * frac
    if n < n_src:
        src = np.concatenate([src, np.zeros(n_src - n)])

    filtered = sweep_filter(src, kind, f0, f1, q, max(1, int(dur * SR)))
    g = env(peak, attack, dur)
    if len(g) < n_src:
        g = np.concatenate([g, np.full(n_src - len(g), FLOOR)])
    return place(np.zeros(total), at, filtered * g[:n_src])


def tone(
    kind: str,
    f0: float,
    f1: float,
    peak: float,
    dur: float,
    total: int,
    at: int = 0,
    attack: float = 0.003,
) -> np.ndarray:
    """src/render/sfx.ts: tone() - a pitched oscillator with a falling pitch."""
    n_env = int(round((attack + dur) * SR))
    n_osc = int(round((attack + dur + TAIL) * SR))
    t = np.arange(n_osc) / SR
    sweep = np.minimum(t, dur)
    freq = f0 * (f1 / f0) ** (sweep / dur) if f0 > 0 and f1 > 0 else np.full(n_osc, f1)
    phase = 2.0 * math.pi * np.cumsum(freq) / SR
    if kind == "sine":
        wave_data = np.sin(phase)
    elif kind == "triangle":
        wave_data = 2.0 / math.pi * np.arcsin(np.sin(phase))
    elif kind == "square":
        wave_data = np.sign(np.sin(phase))
    elif kind == "sawtooth":
        wave_data = 2.0 * (phase / (2 * math.pi) - np.floor(phase / (2 * math.pi) + 0.5))
    else:
        raise ValueError(kind)
    g = env(peak, attack, dur)
    if len(g) < n_osc:
        g = np.concatenate([g, np.full(n_osc - len(g), FLOOR)])
    return place(np.zeros(total), at, wave_data * g[:n_osc])


def hit(rng: np.random.Generator, k: float, total: int) -> np.ndarray:
    """src/render/sfx.ts:122 - the `hit` voice. k is 0 for a light hit, 1 for a heavy one."""
    out = np.zeros(total, dtype=np.float64)
    out += tone("sine", 150 + 40 * (1 - k), 45, 0.7 + 0.3 * k, 0.12 + 0.12 * k, total)
    out += noise_hit(rng, "bandpass", 2200, 700, 0.9, 0.55, 0.05 + 0.03 * k, total)
    if k > 0.5:
        out += noise_hit(rng, "lowpass", 900, 120, 0.7, 0.6 * k, 0.25, total)
    return out


def swing(rng: np.random.Generator, k: float, total: int) -> np.ndarray:
    """src/render/sfx.ts:121 - the `swing` voice."""
    return noise_hit(rng, "bandpass", 500, 2600 + k * 800, 1.4, 0.16 + 0.12 * k, 0.12 + 0.08 * k, total)


def write(path: Path, data: np.ndarray, scale: float) -> None:
    """Write one variant. The scale is shared by every variant, so a heavy hit
    stays louder than a light one, the way it does in the game."""
    write_mp3(path, data * scale, SR)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=ROOT / "reference")
    ap.add_argument("--seconds", type=float, default=1.0)
    args = ap.parse_args()

    total = int(args.seconds * SR)
    out = args.out.resolve()
    print(f"writing the current synthesis to {out}")

    variants = []
    for name, fn, k in (
        ("reference-hit-light", hit, 0.0),
        ("reference-hit-heavy", hit, 1.0),
        ("reference-swing-light", swing, 0.0),
        ("reference-swing-heavy", swing, 1.0),
    ):
        rng = np.random.default_rng(7)  # the browser's Math.random() is not repeatable; this is
        variants.append((name, fn(rng, k, total)))

    # one scale for all four: the loudest variant sets it, the others keep
    # their relative level
    loudest = max(float(np.max(np.abs(d))) for _, d in variants)
    scale = TARGET_PEAK / loudest if loudest > 0 else 1.0
    for name, data in variants:
        write(out / f"{name}.mp3", data, scale)
        print(f"  {name}.mp3  peak {float(np.max(np.abs(data))) * scale:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
