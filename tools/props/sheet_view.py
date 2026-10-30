"""The turnaround sheet's views, and the cells they are cut into.

The sheet is the prop's art on a turntable - front, left, back, right - cut
from the frames of the multi-view clip. A tile is the art in the frame the
mesh stands in, so a cell of a tile and a cell of the mesh mean the same
thing.

A tile is masked the way the outline check masks it - any pixel that is not
white - and then cropped to the prop and stretched to a square, so a cell's
position is a position *on the prop* and not a position in the picture. The
cells of a view are therefore comparable with the mesh's own box.
"""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare_front as cf  # noqa: E402
import pose  # noqa: E402

SIZE = 256
GRID = 8
VIEWS = ["front", "left", "back", "right"]


def tile(path, view):
    """One view of the sheet."""
    sheet = Image.open(path).convert("RGB")
    side = sheet.height
    i = VIEWS.index(view)
    return sheet.crop((i * side, 0, (i + 1) * side, side))


def view_mask(path, view, frame):
    """The outline of the prop in one view, cropped to it and squared."""
    posed = pose.posed_view(tile(path, view), view, frame)
    return cf.normalise(cf.image_mask(posed))


def cells_of(mask):
    """The cells of a view, with how much of each of them the prop fills."""
    cw, ch = SIZE / GRID, SIZE / GRID
    out = []
    for cy in range(GRID):
        for cx in range(GRID):
            x0, y0 = int(cx * cw), int(cy * ch)
            x1, y1 = max(x0 + 1, int((cx + 1) * cw)), max(y0 + 1, int((cy + 1) * ch))
            piece = mask[y0:y1, x0:x1]
            solid = int(piece.sum())
            out.append({
                "cx": cx, "cy": cy, "solid": solid,
                "coverage": solid / piece.size,
                "box": (x0, y0, x1, y1),
            })
    return out


def front_view(entry):
    """The sheet's view that the mesh's front is.

    The mesh is turned onto its pivot, so the view it faces is the sheet's
    view the turn says it should be in.
    """
    frame = entry.get("validation", {}).get("frame", {})
    turn = int(frame.get("turn_deg", 0) or 0) % 360
    return VIEWS[(-turn // 90) % 4]
