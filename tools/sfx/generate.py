#!/usr/bin/env python3
"""Generate PITFIGHTER's sound effects with a local Stable Audio 3 Small-SFX model.

No API keys and no credits: the model runs on the machine's own GPU through a
local ComfyUI server. The cues and their prompts live in `prompts.json`, so the
whole set can be regenerated from the file that ships with the game.

    python tools/sfx/generate.py
    python tools/sfx/generate.py --only hit-claw-skin

Each cue is generated once and written twice: the untouched model output, and
the trimmed, normalised, one channel mp3 the game will play. The raw output is
kept only when `--keep-raw` is passed, because it is a flac of no use to the
game.

One channel because the game pans every cue at runtime, so a stereo file would
be wasted bytes. mp3 because every browser decodes it and it is about eight
times smaller than the wav it replaces.

Needs numpy and PyAV. The ComfyUI python in the portable install has both:
    <ComfyUI>/python_embeded/python.exe tools/sfx/generate.py
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from audio import is_whole_mp3, write_mp3  # noqa: E402  (needs the path above)

try:
    import numpy as np
except ImportError:  # pragma: no cover - numpy ships with ComfyUI's python
    print("numpy is required; run this with ComfyUI's python", file=sys.stderr)
    raise

ROOT = Path(__file__).resolve().parent
DEFAULT_PROMPTS = ROOT / "prompts.json"
DEFAULT_SERVER = "http://127.0.0.1:8188"

# the level the game mixes at: a touch under full scale so the compressor in
# src/render/sfx.ts has something to work with
TARGET_PEAK = 10 ** (-1 / 20)
TRIM_DB = -45.0
PREROLL_S = 0.005
TAIL_S = 0.040
FADE_IN_S = 0.002
FADE_OUT_S = 0.015


# ------------------------------------------------------------------ the server


def post_json(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"{url} -> HTTP {e.code}: {detail}") from None


def get_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def get_bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def workflow(cue: dict, cfg: dict, prefix: str) -> dict:
    """The Stable Audio 3 graph, in the API format ComfyUI's /prompt expects."""
    return {
        "1": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": cfg["model"]},
        },
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": cfg["text_encoder"], "type": "stable_audio", "device": "default"},
        },
        "3": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": cue["prompt"], "clip": ["2", 0]},
        },
        "4": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": cfg["negative"], "clip": ["2", 0]},
        },
        "5": {
            "class_type": "EmptyLatentAudio",
            "inputs": {"seconds": cue.get("seconds", cfg["seconds"]), "batch_size": 1},
        },
        "6": {
            "class_type": "KSampler",
            "inputs": {
                "seed": cue["seed"],
                "steps": cfg["steps"],
                "cfg": cfg["cfg"],
                "sampler_name": cfg["sampler"],
                "scheduler": cfg["scheduler"],
                "denoise": 1.0,
                "model": ["1", 0],
                "positive": ["3", 0],
                "negative": ["4", 0],
                "latent_image": ["5", 0],
            },
        },
        "7": {
            "class_type": "VAEDecodeAudio",
            "inputs": {"samples": ["6", 0], "vae": ["1", 2]},
        },
        "8": {
            "class_type": "SaveAudio",
            "inputs": {"audio": ["7", 0], "filename_prefix": prefix},
        },
    }


def run_cue(server: str, cue: dict, cfg: dict, prefix: str) -> tuple[bytes, str]:
    """Queue one cue on the server and wait for it. Returns the raw bytes and
    the file name the server gave them."""
    res = post_json(f"{server}/prompt", {"prompt": workflow(cue, cfg, prefix)})
    pid = res["prompt_id"]
    deadline = time.time() + 600
    while time.time() < deadline:
        hist = get_json(f"{server}/history/{pid}")
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                raise RuntimeError(f"comfyui failed: {status.get('messages')}")
            outputs = entry.get("outputs", {})
            for node_out in outputs.values():
                for audio in node_out.get("audio", []) or []:
                    if audio.get("type") == "output":
                        return (
                            get_bytes(
                                f"{server}/view?filename={audio['filename']}"
                                f"&subfolder={audio.get('subfolder', '')}&type=output"
                            ),
                            audio["filename"],
                        )
            # the run finished but produced nothing yet: give it a moment
            if status.get("completed"):
                raise RuntimeError(f"comfyui finished with no audio: {status}")
        time.sleep(1.0)
    raise RuntimeError("comfyui timed out")


# ------------------------------------------------------------------ the audio


def to_mono(raw: bytes) -> tuple[np.ndarray, int]:
    """Decode what the server sent us into one channel of floats.

    ComfyUI saves audio as FLAC, so PyAV does the decoding; the wave module
    covers the case where the server hands back a plain wav.
    """
    if raw[:4] == b"RIFF":
        with wave.open(io.BytesIO(raw), "rb") as w:
            rate = w.getframerate()
            nch = w.getnchannels()
            width = w.getsampwidth()
            frames = w.readframes(w.getnframes())
        if width == 2:
            data = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32768.0
        elif width == 4:
            data = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483648.0
        elif width == 1:
            data = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
        else:
            raise RuntimeError(f"unsupported sample width {width}")
        if nch > 1:
            data = data.reshape(-1, nch).mean(axis=1)
        return data, rate

    import av

    with av.open(io.BytesIO(raw)) as c:
        stream = c.streams.audio[0]
        rate = stream.rate
        channels = stream.channels
        chunks = [f.to_ndarray().ravel() for f in c.decode(audio=0)]
    if not chunks:
        raise RuntimeError("the server sent back an empty file")
    flat = np.concatenate(chunks)
    if flat.dtype == np.int16:
        flat = flat.astype(np.float32) / 32768.0
    elif flat.dtype == np.int32:
        flat = flat.astype(np.float32) / 2147483648.0
    else:
        flat = flat.astype(np.float32)
    if channels > 1:
        flat = flat[: (flat.size // channels) * channels].reshape(-1, channels)
        flat = flat.mean(axis=1)
    return flat, rate


def trim(data: np.ndarray, rate: int) -> np.ndarray:
    """Cut the silence around the hit, keeping a little of the room around it."""
    peak = float(np.max(np.abs(data))) if data.size else 0.0
    if peak <= 0:
        return data
    thresh = peak * 10 ** (TRIM_DB / 20)
    loud = np.nonzero(np.abs(data) > thresh)[0]
    if loud.size == 0:
        return data
    start = max(0, int(loud[0]) - int(PREROLL_S * rate))
    end = min(data.size, int(loud[-1]) + int(TAIL_S * rate))
    return data[start:end]


def shape(data: np.ndarray, rate: int) -> np.ndarray:
    """Fade the ends so nothing clicks, and set the peak level."""
    if data.size == 0:
        return data
    out = data.astype(np.float32).copy()
    fin = min(out.size, int(FADE_IN_S * rate))
    fout = min(out.size, int(FADE_OUT_S * rate))
    if fin > 1:
        out[:fin] *= np.linspace(0.0, 1.0, fin, dtype=np.float32)
    if fout > 1:
        out[-fout:] *= np.linspace(1.0, 0.0, fout, dtype=np.float32)
    peak = float(np.max(np.abs(out)))
    if peak > 0:
        out *= TARGET_PEAK / peak
    return out


def write_sample(path: Path, data: np.ndarray, rate: int) -> None:
    """Write the sample the game will play."""
    write_mp3(path, data, rate)


def is_whole(path: Path) -> bool:
    """True when the file is an mp3 we can decode all the way through.

    A file left behind by an interrupted run is not, and gets regenerated
    rather than skipped.
    """
    return is_whole_mp3(path)


# ------------------------------------------------------------------ the run


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--prompts", type=Path, default=DEFAULT_PROMPTS)
    # the candidates live beside the tool, not in public/, until something
    # actually loads them: a file in public/ is shipped in the build
    ap.add_argument("--out", type=Path, default=ROOT / "samples")
    ap.add_argument("--server", default=DEFAULT_SERVER)
    ap.add_argument("--only", default="", help="comma separated cue ids")
    ap.add_argument("--keep-raw", action="store_true", help="also keep the untouched model output")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and exit")
    args = ap.parse_args()

    cfg = json.loads(args.prompts.read_text(encoding="utf-8"))
    cfg.update(cfg.get("defaults", {}))
    cues = cfg["cues"]
    if args.only:
        wanted = {s.strip() for s in args.only.split(",") if s.strip()}
        known = {c["id"] for c in cues}
        unknown = sorted(wanted - known)
        if unknown:
            print(f"no such cue: {', '.join(unknown)}", file=sys.stderr)
            print(f"known cues: {', '.join(sorted(known))}", file=sys.stderr)
            return 2
        cues = [c for c in cues if c["id"] in wanted]

    out = args.out.resolve()
    raw_dir = out / "raw"
    print(f"{len(cues)} cue(s) -> {out}")
    if args.dry_run:
        for c in cues:
            print(f"  {c['id']:<20} {c['seconds'] if 'seconds' in c else cfg['seconds']}s  seed={c['seed']}")
        return 0

    for cue in cues:
        dest = out / cue["file"]
        if dest.exists() and is_whole(dest):
            print(f"skip {cue['id']} (already there)")
            continue
        if dest.exists():
            print(f"redo {cue['id']} (the file on disk is not a whole mp3)")
        prefix = f"pitfighter/{cue['id']}"
        print(f"generating {cue['id']} ...", flush=True)
        started = time.time()
        raw, raw_name = run_cue(args.server, cue, cfg, prefix)
        if args.keep_raw:
            raw_dir.mkdir(parents=True, exist_ok=True)
            (raw_dir / raw_name).write_bytes(raw)
        data, rate = to_mono(raw)
        data = shape(trim(data, rate), rate)
        write_sample(dest, data, rate)
        print(f"  {cue['id']:<20} {len(data) / rate:.2f}s  {dest.name}  ({time.time() - started:.0f}s)")

    print("done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
