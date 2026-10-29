"""The stages a prop can be rebuilt from, and how a reviewer names one.

The prop pipeline builds a prop in stages:

  1. the 2D reference (FLUX 3) and its watertight alpha cutout (BiRefNet)
  2. the MiniMax H3 turntable, cut to a front/left/back/right sheet
  3. the Pixal3D reconstruction
  4. the capture and the published renders

A reviewer who says "redo it from the 2D stage" is asking for the prop to be
rebuilt from that stage onwards, and the pipeline has to be able to do it. The
stage is named on the command itself, so that the finding and the stage are
never confused with one another:

    /revision the grip is smooth       the mesh is rebuilt (stage 3)
    /revision --stage=art              the 2D art and its cutout are redone,
                                       and so is everything after them
    /revision --stage=cutout           the cutout is redone, and so is
                                       everything after it
    /revision --stage=sheet            the sheet is redone, and so is the mesh
    /revision --stage=mesh             the mesh is redone, which is what a
                                       plain /revision has always meant

The token is strict. A token the pipeline does not know is an error and
nothing is rebuilt, and the stage is never read out of the prose of the
comment: a reviewer who writes "the sheet is wrong" is describing a finding,
not naming a stage, and a plain `/revision` keeps its meaning of "rebuild the
mesh".

The stages, in the order they are built:

    art     stage 1: the 2D reference (FLUX 3 klein) and its watertight alpha
            cutout (BiRefNet)
    cutout  the watertight alpha cutout (BiRefNet) alone, over the art that is
            already there - the second half of stage 1
    sheet   stage 2: the H3 four-view turnaround sheet
    mesh    stage 3: the Pixal3D reconstruction

A redo from a stage rebuilds that stage and every stage after it.

A request that carries no command at all - a comment that says "redo it from
the 2d stage" and leaves the command out - is read by `request_redo.py`, which
asks for the stage in the reviewer's own words and says which words decided
it. That is a separate and explicit path: the automatic trigger never reads a
stage out of prose.

Usage:
    from redo_stage import parse_stage, plan_of, revision_stage, stage_from_text

    revision_stage("/revision --stage=art the hat is not round")
    # ("art", None, "the hat is not round")

    revision_stage("/revision --stage=teapot")
    # (None, "'teapot' is not a stage the pipeline knows. ...", "")
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from issues import PIPELINE_MARKER, REVISION, command_lines, command_text  # noqa: E402

ART = "art"
CUTOUT = "cutout"
SHEET = "sheet"
MESH = "mesh"

# the stages, in the order they are built. A redo from one of them covers that
# stage and every stage after it.
STAGES = [ART, CUTOUT, SHEET, MESH]

# what each stage is, for a person reading it on an issue
STAGE_LABELS = {
    ART: "stage 1: the 2D reference (FLUX 3) and its watertight alpha cutout (BiRefNet)",
    CUTOUT: "the watertight alpha cutout (BiRefNet), over the art that is already there",
    SHEET: "stage 2: the H3 four-view turnaround sheet",
    MESH: "stage 3: the Pixal3D reconstruction",
}
# the tokens a reviewer may use for each stage. The first is the canonical one;
# the rest are the words the stage is known by.
TOKENS = {
    ART: ("art", "2d", "stage1", "stage-1", "concept", "reference", "flux3"),
    CUTOUT: ("cutout", "alpha", "birefnet", "stage1b", "stage-1b"),
    SHEET: ("sheet", "turnaround", "stage2", "stage-2", "h3"),
    MESH: ("mesh", "stage3", "stage-3", "pixal3d", "reconstruction"),
}

# every token, and the stage it names
ALIASES = {token: stage for stage, tokens in TOKENS.items() for token in tokens}

# the words that name a stage in a reviewer's own words. Used only by the
# explicit triage path, and only when a request carries no command.
TEXT_SIGNALS = [
    (ART, ("2d stage", "2d reference", "2d art", "stage 1", "stage1", "concept art",
           "flux 3", "the 2d", "the art")),
    (CUTOUT, ("birefnet", "watertight alpha", "alpha cutout", "the cutout", "stage 1b")),
    (SHEET, ("orthographic turnaround", "turnaround sheet", "360", "gate 2", "stage 2",
             "turnaround", "the sheet", "initial view", "first view")),
    (MESH, ("pixal3d", "reconstruction", "the mesh", "stage 3")),
]

# a request that says the whole thing is to be redone starts at the art: the
# art is where the shape of the prop is decided.
COMPLETE = ("complete redo", "complete rebuild", "full redo", "from scratch",
            "start again", "completely regenerate", "regenerate everything")

# "before" moves a stage one step earlier: "redo it from before the cutout"
# is a redo of the art.
BEFORE = re.compile(r"\bbefore\b|\bprior to\b")


class UnknownStage(ValueError):
    """A stage token the pipeline does not know."""


def unknown_message(token):
    """What is said about a token the pipeline does not know."""
    if not (token or "").strip():
        return "no stage was named: use --stage=<stage>."
    return (f"'{token}' is not a stage the pipeline knows. "
            f"Use one of: {', '.join(STAGES)} "
            f"(or one of: {', '.join(sorted(ALIASES))}).")


def parse_stage(token):
    """The stage a token names.

    A token the pipeline does not know is an error: nothing is rebuilt from a
    token that was not understood.
    """
    key = (token or "").strip().strip(".,;:!?").lower()
    if not key:
        raise UnknownStage(unknown_message(token))
    if key not in ALIASES:
        raise UnknownStage(unknown_message(token))
    return ALIASES[key]


def plan_of(stage):
    """The stages a redo from `stage` covers: that stage and every one after it."""
    if stage not in STAGES:
        raise UnknownStage(unknown_message(stage))
    return STAGES[STAGES.index(stage):]


def _split_flag(rest):
    """The stage token in a command's argument, and what is left of it."""
    if rest.startswith("--stage="):
        token, _, left = rest[len("--stage="):].partition(" ")
        return token.strip(), left.strip()
    if rest == "--stage" or rest.startswith("--stage "):
        parts = rest.split(None, 1)
        named = parts[1].strip() if len(parts) > 1 else ""
        token, _, left = named.partition(" ")
        return token.strip(), left.strip()
    return None, rest


def _finding(body, rest, left):
    """What the reviewer said: the rest of the command's line, and the lines under it."""
    full = command_text(body, REVISION)
    under = full[len(rest):].strip() if full.startswith(rest) else full
    return " ".join(part for part in (left, under) if part).strip()


def revision_stage(body):
    """The stage a reviewer's `/revision` comment asks for.

    Gives back (stage, error, text):

      stage  the stage that is to be rebuilt, MESH for a plain `/revision`, and
             None when the comment carries no command at all
      error  why the stage could not be read, when it could not
      text   what the reviewer asked for, with the stage token taken out
    """
    if not body or PIPELINE_MARKER in body:
        return None, None, ""
    for line in command_lines(body):
        if not line.startswith(REVISION):
            continue
        rest = line[len(REVISION):].strip()
        if rest.startswith("--") and not rest.startswith("--stage"):
            # an option the pipeline does not know is not a finding to rebuild
            # from: it is a command that was not understood
            option = rest.split()[0]
            return None, (f"'{option}' is not an option the pipeline knows. "
                          "Use --stage=<stage> to say what is rebuilt."), ""
        token, left = _split_flag(rest)
        finding = _finding(body, rest, left)
        if token is None:
            # a plain `/revision`: the mesh is rebuilt, and nothing else
            return MESH, None, finding
        try:
            stage = parse_stage(token)
        except UnknownStage as error:
            return None, str(error), finding
        return stage, None, finding
    return None, None, ""

def stage_from_text(text):
    """The stage a request in the reviewer's own words asks for.

    Gives back (stage, reason). The stage is None when the text names no
    stage: the caller says so rather than guessing.

    The stage named earliest in the order wins, because a redo from an early
    stage covers every stage after it. A request that says the whole thing is
    to be redone starts at the art.
    """
    if not text or not text.strip():
        return None, "there is nothing in the request"
    low = text.lower()
    found = []
    for stage, phrases in TEXT_SIGNALS:
        for phrase in phrases:
            at = low.find(phrase)
            if at < 0:
                continue
            here = stage
            if BEFORE.search(low[max(0, at - 40):at]):
                # "redo it from before the cutout" is a redo of the stage
                # before the one it names
                earlier = STAGES[:STAGES.index(stage)]
                if earlier:
                    here = earlier[-1]
            found.append((STAGES.index(here), here, phrase))
    complete = next((phrase for phrase in COMPLETE if phrase in low), None)
    if complete:
        # the whole thing is to be redone, so it starts at the art: the art is
        # where the shape of the prop is decided
        art = next((hit for hit in found if hit[1] == ART), None)
        if art:
            return ART, f"the request names '{art[2]}', which is {STAGE_LABELS[ART]}"
        return ART, f"the request says '{complete}', which starts at the art"
    if not found:
        return None, "the request names no stage"
    found.sort()
    _, stage, phrase = found[0]
    return stage, f"the request names '{phrase}', which is {STAGE_LABELS[stage]}"


def redo_block(stage, request, reason, issue, seed, stamp, length=None):
    """The redo a prop's manifest entry carries.

    The block is the whole of the redo: which stage it starts from, what was
    asked for, the seed it is built with, and the stages that have been done.

    `length` is the number of frames the turnaround clip is to be, for a prop
    whose clip was too short to turn far enough to show its back.
    """
    return {
        "stage": stage,
        "plan": plan_of(stage),
        "requested_at": stamp,
        "issue": issue,
        "request": request,
        "reason": reason,
        "seed": seed,
        "length": length,
        "done": [],
        "cutout": None,
        "sheet": None,
        "previous_cutout": None,
        "previous_sheet": None,
    }


def apply_redo(entry, block):
    """Put a prop's entry into the queue for a rebuild from a stage.

    The same bookkeeping a plain revision does: the cycle's own state is
    cleared, so the finish chain waits for the new mesh rather than publishing
    the one that was reviewed, and the prop is back at the gate before its 3D.

    The seed is recorded in `revision_seeds` but not in `revision_seed`: the
    mesh chain rebuilds a prop that has a pending seed from the sheet it knows,
    and a redo that starts before the sheet must not be built from that sheet.
    The redo builds its own mesh, and claims it under the manifest's lock.
    """
    stamp = block["requested_at"]
    entry.pop("revision_built_at", None)
    entry.pop("revision_published_at", None)
    entry.pop("revision_claimed_at", None)
    entry["stand_in_measured"] = entry.get("measured") or entry.get("stand_in_measured")
    entry["build"] = None
    entry.pop("measured", None)
    entry["status"] = "gate:2-review-turnaround"
    entry["revision_requested_at"] = stamp
    entry["revision_seeds"] = list(entry.get("revision_seeds") or []) + [block["seed"]]
    entry["revision_note"] = (
        f"Redo requested on {stamp} from {STAGE_LABELS[block['stage']]}: "
        f"{block['request'] or 'no detail given'}. "
        f"The prop is rebuilt from that stage with seed {block['seed']}."
    )
    entry["redo"] = block
    return entry


def main():
    if "--detect" in sys.argv:
        # What a set of comment bodies is read as. The rules that decide
        # whether a prop is rebuilt, and from which stage, are the ones that
        # decide what a reviewer asked for, so they are held down by a test
        # that uses this.
        bodies = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
        result = []
        for body in bodies:
            stage, error, text = revision_stage(body)
            result.append({"stage": stage, "error": error, "text": text})
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    if "--detect-text" in sys.argv:
        # What a set of requests in a reviewer's own words is read as.
        texts = json.loads(sys.stdin.buffer.read().decode("utf-8-sig"))
        result = []
        for text in texts:
            stage, reason = stage_from_text(text)
            result.append({"stage": stage, "reason": reason})
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
