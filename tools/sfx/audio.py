"""Shared audio helpers for the sound tools.

The game ships mp3: every browser can decode it, and it is about eight times
smaller than the wav it replaces. The encoder is PyAV's, because ComfyUI
already ships it - there is no ffmpeg on PATH and nothing to install.

    from audio import write_mp3
"""
from __future__ import annotations

import os
from pathlib import Path

import av
import numpy as np

# an mp3 frame holds 1152 samples; the encoder wants them a frame at a time
FRAME_SAMPLES = 1152
# 128 kbit/s is enough for a sound effect and small enough to be free
DEFAULT_BITRATE = 128_000


def write_mp3(path: Path, data: np.ndarray, rate: int, bitrate: int = DEFAULT_BITRATE) -> None:
    """Write one channel of audio as an mp3.

    The file is written under a temporary name and renamed, so an interrupted
    run never leaves a half written file where a whole one should be.
    """
    pcm = np.clip(np.round(np.asarray(data, dtype=np.float64) * 32767.0), -32768, 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part.mp3")
    container = av.open(str(tmp), mode="w", format="mp3")
    try:
        stream = container.add_stream("libmp3lame", rate=rate)
        stream.bit_rate = bitrate
        stream.layout = "mono"
        for start in range(0, len(pcm), FRAME_SAMPLES):
            chunk = pcm[start : start + FRAME_SAMPLES]
            frame = av.AudioFrame(format="s16", layout="mono", samples=len(chunk))
            frame.planes[0].update(chunk.tobytes())
            frame.sample_rate = rate
            frame.pts = start
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    finally:
        container.close()
    os.replace(tmp, path)


def is_whole_mp3(path: Path) -> bool:
    """True when the file decodes all the way through.

    A file left behind by an interrupted run does not, and is regenerated
    rather than skipped.
    """
    try:
        with av.open(str(path)) as c:
            if not c.streams.audio:
                return False
            samples = 0
            for frame in c.decode(audio=0):
                samples += frame.samples
            return samples > 0
    except Exception:
        return False
