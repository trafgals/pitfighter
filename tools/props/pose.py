"""Put a prop's art into the frame its mesh stands in.

Some props are approved art drawn on the diagonal, and two are drawn the other
way up. The reconstruction is turned over before it is conditioned on and
rolled back onto its pivot afterwards, so the art and the mesh are in different
frames. Anything that compares the two - the validation boxes that are cut
from the art and checked against the mesh, and the outline that says whether
the reconstruction came out mirrored - has to bring them into the same frame
first.

The two rules come from the pipeline:

  * the sheet is turned over before it is conditioned on, so the two broadside
    views are flipped vertically and the two side views are turned over
    sideways
  * the mesh is rolled about the camera's axis, which shows as a rotation in
    the broadside views and is out of plane in the side views
"""
from PIL import Image, ImageOps

BROADSIDE = ("front", "back")
SIDEWAYS = ("left", "right")

WHITE = (255, 255, 255)


def turned_over(img, view, frame):
    """The sheet's view as it was conditioned on."""
    if not frame.get("upside_down"):
        return img
    return ImageOps.flip(img) if view in BROADSIDE else ImageOps.mirror(img)


def rolled(img, view, frame, fill=WHITE):
    """The view after the mesh was rolled onto its pivot."""
    roll = float(frame.get("roll_deg", 0.0) or 0.0)
    if not roll or view not in BROADSIDE:
        return img
    # the mesh's front view is the conditioned view turned by the roll
    return img.rotate(roll, resample=Image.BILINEAR, expand=True, fillcolor=fill)


def posed_view(img, view, frame):
    """One sheet view as the mesh sees it."""
    return rolled(turned_over(img, view, frame), view, frame)


def posed_cutout(img, frame):
    """The prop's own art in the frame its mesh stands in.

    The art is the prop's front view, so it is turned over the way the
    broadside views are and rolled the way they are. An art mask is filled
    with nothing when it is turned, not with white.
    """
    turned = turned_over(img, "front", frame)
    return rolled(turned, "front", frame, fill=0)
