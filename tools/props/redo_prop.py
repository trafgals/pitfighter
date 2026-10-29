"""Rebuild a prop from a stage onwards, and record what it did.

A redo is a rebuild of a prop from a stage onwards: the 2D art and its
watertight alpha cutout, the H3 turnaround sheet, the Pixal3D reconstruction.
A reviewer names the stage on the issue, `request_redo.py` puts the prop in
the queue with that stage, and this builds it.

The build is resumable, and it is claimed:

  * the stages that have been done are written on the entry as they are done,
    so a run that is interrupted carries on where it stopped rather than
    paying for the GPU again
  * the redo is claimed under the manifest's lock, so two passes cannot both
    build the same prop: the GPU is one serial thing, and a second build would
    land on top of the first
  * the claim is given back when a build fails, or the prop would never be
    built at all

The old artefacts are kept. The new cutout is written beside the old one, the
new sheet beside the old sheet, and the manifest is pointed at the new ones
when they are ready. Nothing that was reviewed is overwritten, and a file that
is already there is never written over - a cutout from an earlier redo is
still somebody's work.

The stages, and what each of them runs:

    art     tools/props/redo_concept.py <asset_id>
            the 2D reference (FLUX 3) and its watertight alpha cutout
            (BiRefNet)
    cutout  tools/props/redo_concept.py <asset_id> --from-art <art>
            the cutout alone, over the art that is already there
    sheet   scripts/run_minimax_h3_turnaround.py <cutout> <sheet>
            the H3 turntable, cut to a four-view sheet
    mesh    scripts/run_pixal3d_mesh.py <asset_id>
            the Pixal3D reconstruction, from the sheet the manifest names

The stages are in `redo_stage.py`, which is also where a reviewer's command is
read and where the stage of a request in plain words is worked out.

Usage:
    python tools/props/redo_prop.py list                # the redos that are queued
    python tools/props/redo_prop.py plan <asset_id>     # what would be built
    python tools/props/redo_prop.py run <asset_id> [--dry-run]
"""
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import claim_revision  # noqa: E402
import manifest_io  # noqa: E402
import record_prop  # noqa: E402
import redo_concept  # noqa: E402
from redo_stage import ART, CUTOUT, MESH, SHEET  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

# the interpreter this is running under is the one that runs the GPU scripts,
# so a redo is not built by a different python than the rest of the pipeline
PYTHON = sys.executable

# how long a claim is held before it is treated as abandoned. A turnaround clip
# is an hour of GPU and the queue in front of it can be longer.
CLAIM_HOLD_S = 6 * 3600


def asset_entry(manifest, asset_id):
    """One asset's entry, out of a manifest."""
    return next((a for a in manifest["assets"] if a["id"] == asset_id), None)


def read_entry(asset_id):
    """One asset's entry, read under the manifest's lock."""
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
    return asset_entry(manifest, asset_id)


def update(asset_id, change):
    """Change one asset's entry under the manifest's lock."""
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        entry = asset_entry(manifest, asset_id)
        if entry is None:
            return None
        change(entry)
        manifest_io.save(MANIFEST, manifest)
    return entry


def rel(path):
    """A path as the manifest writes it."""
    return os.path.relpath(path, ROOT).replace("\\", "/")


def stale(stamp):
    """Whether a claim is old enough to be taken over."""
    held = manifest_io.timestamp_of(stamp)
    if held is None:
        return True
    import datetime
    return (datetime.datetime.now(held.tzinfo) - held).total_seconds() > CLAIM_HOLD_S


def free_path(candidates):
    """The first of the candidates that is not there yet.

    A file that is already on disk is somebody's work - a cutout from an
    earlier redo, a sheet that was reviewed - so it is never written over.
    """
    for candidate in candidates:
        if not os.path.exists(os.path.join(ROOT, candidate)):
            return candidate
    return candidates[-1]


def cutout_candidates(asset_id):
    """Where a prop's redone cutout may be written."""
    stem = redo_concept.stem_of(asset_id)
    return [f"public/tex/props/flux3_{stem}_redo_alpha.png"] + [
        f"public/tex/props/flux3_{stem}_redo_{n}_alpha.png" for n in range(2, 10)]


def art_candidates(asset_id):
    """Where a prop's redone 2D art may be written."""
    stem = redo_concept.stem_of(asset_id)
    return [f"public/tex/props/flux3_{stem}_redo_art.png"] + [
        f"public/tex/props/flux3_{stem}_redo_art_{n}.png" for n in range(2, 10)]


def sheet_candidates(entry):
    """Where a prop's redone sheet may be written."""
    sheet = entry.get("turnaround_sheet") or ""
    stem = os.path.splitext(os.path.basename(sheet))[0]
    if not stem:
        return []
    return [f"public/tex/props/{stem}_redo.png"] + [
        f"public/tex/props/{stem}_redo_{n}.png" for n in range(2, 10)]


def preview_candidates(entry):
    """Where a prop's redone turntable preview may be written."""
    preview = entry.get("turntable") or ""
    stem = os.path.splitext(os.path.basename(preview))[0]
    if not stem:
        return []
    folder = os.path.dirname(preview)
    return [f"{folder}/{stem}_redo.webp"] + [
        f"{folder}/{stem}_redo_{n}.webp" for n in range(2, 10)]


def faces_of(entry):
    """The face count the prop's own build used, or the one its budget allows."""
    build = entry.get("build") or ""
    for word in build.split():
        if word == "--faces" and build.split().index(word) + 1 < len(build.split()):
            words = build.split()
            try:
                return int(words[words.index("--faces") + 1])
            except ValueError:
                break
    return record_prop.faces_for(entry)


def symmetric_of(entry):
    """Whether the sheet that was reviewed had its right view mirrored.

    The new sheet is cut the same way: a prop whose side views are the same
    both ways round keeps them the same, and one that is not keeps them apart.
    """
    sheet = entry.get("turnaround_sheet")
    if not sheet:
        return False
    record = os.path.splitext(os.path.join(ROOT, sheet))[0] + ".json"
    if not os.path.exists(record):
        return False
    try:
        with open(record, encoding="utf-8") as f:
            return bool(json.load(f).get("right_mirrored"))
    except (OSError, ValueError):
        return False


def run_tool(command, dry_run=False):
    """Run a pipeline script and give back what it printed.

    The last line of the output is the JSON summary, when the tool writes one.
    """
    print(f"  $ {' '.join(command)}")
    if dry_run:
        return None
    result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True,
                            encoding="utf-8", errors="replace")
    for line in (result.stdout or "").splitlines():
        print(f"    {line}")
    if result.returncode:
        for line in (result.stderr or "").splitlines():
            print(f"    {line}")
        raise RuntimeError(f"{command[1]} failed with {result.returncode}")
    lines = [line for line in (result.stdout or "").splitlines() if line.strip()]
    if lines:
        try:
            return json.loads(lines[-1])
        except ValueError:
            return None
    return None


def claim(asset_id):
    """Claim the redo, so that two passes do not both build it."""
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        entry = asset_entry(manifest, asset_id)
        redo = (entry or {}).get("redo")
        if not redo:
            return False
        if redo.get("claimed_at") and not stale(redo["claimed_at"]):
            return False
        redo["claimed_at"] = manifest_io.now()
        manifest_io.save(MANIFEST, manifest)
    return True


def release(asset_id):
    """Give the claim back, so that another pass can build the prop."""
    def change(entry):
        redo = entry.get("redo") or {}
        redo.pop("claimed_at", None)
    update(asset_id, change)


def record(asset_id, stage, **fields):
    """Write a stage as done, and whatever it produced."""
    def change(entry):
        redo = entry.get("redo") or {}
        done = list(redo.get("done") or [])
        if stage not in done:
            done.append(stage)
        redo["done"] = done
        redo.update(fields)
        entry["redo"] = redo
    update(asset_id, change)


def step_art(entry, redo, dry_run):
    """The 2D art and its watertight alpha cutout, both redone."""
    asset_id = entry["id"]
    cutout = free_path(cutout_candidates(asset_id))
    art = free_path(art_candidates(asset_id))
    command = [PYTHON, os.path.join("tools", "props", "redo_concept.py"), asset_id,
               "--seed", str(redo.get("seed")), "--out", cutout, "--art-out", art, "--json"]
    print("the 2D art and its cutout")
    summary = run_tool(command, dry_run)
    if dry_run:
        return {}
    if not summary or not summary.get("cutout"):
        raise RuntimeError("the art was redone but no cutout came out of it")
    return {"cutout": summary["cutout"], "art": summary.get("art_copy") or art}


def step_cutout(entry, redo, dry_run):
    """The watertight alpha cutout, over the art that is already there.

    The cutout the art step made is the prop's current cutout, and is used as
    it is. A cutout that has already been made from a newer art is the same
    thing: the art has been redone, and what was asked for was to carry on
    from the cutout. Otherwise the cutout is made over the art that is there.
    """
    asset_id = entry["id"]
    art = entry.get("reference_concept")
    cutout = free_path(cutout_candidates(asset_id))
    existing = cutout_candidates(asset_id)[0]
    art_path = os.path.join(ROOT, art) if art else ""

    made = redo.get("cutout")
    if made and os.path.exists(os.path.join(ROOT, made)):
        print(f"the cutout the art step made is used as it is: {made}")
        return {"cutout": made}
    if (os.path.exists(os.path.join(ROOT, existing)) and art_path
            and os.path.exists(art_path)
            and os.path.getmtime(os.path.join(ROOT, existing)) > os.path.getmtime(art_path)):
        print(f"the cutout has already been made from a newer art: {existing} is used as it is")
        return {"cutout": existing}
    if not art or not os.path.exists(art_path):
        raise RuntimeError(f"{asset_id} has no art to cut out")
    command = [PYTHON, os.path.join("tools", "props", "redo_concept.py"), asset_id,
               "--from-art", art, "--out", cutout, "--json"]
    print("the watertight alpha cutout")
    summary = run_tool(command, dry_run)
    if dry_run:
        return {}
    if not summary or not summary.get("cutout"):
        raise RuntimeError("the cutout came out empty")
    return {"cutout": summary["cutout"]}


def step_sheet(entry, redo, dry_run):
    """The H3 four-view turnaround sheet, from the prop's current cutout."""
    asset_id = entry["id"]
    cutout = redo.get("cutout") or entry.get("alpha_cutout")
    if not cutout:
        raise RuntimeError(f"{asset_id} has no cutout to turn")
    candidates = sheet_candidates(entry)
    if not candidates:
        raise RuntimeError(f"{asset_id} has no sheet to redo")
    sheet = free_path(candidates)
    previews = preview_candidates(entry)
    preview = free_path(previews) if previews else ""
    command = [PYTHON, os.path.join("scripts", "run_minimax_h3_turnaround.py"),
               cutout, sheet, "--seed", str(redo.get("seed"))]
    if preview:
        command += ["--preview", preview]
    if symmetric_of(entry):
        command += ["--symmetric"]
    print("the four-view sheet")
    run_tool(command, dry_run)
    if dry_run:
        return {}
    if not os.path.exists(os.path.join(ROOT, sheet)):
        raise RuntimeError("the sheet was not written")
    return {"sheet": sheet, "preview": preview}


def step_mesh(entry, redo, dry_run):
    """The Pixal3D reconstruction, from the sheet the manifest names."""
    asset_id = entry["id"]
    command = [PYTHON, os.path.join("scripts", "run_pixal3d_mesh.py"), asset_id,
               "--faces", str(faces_of(entry)), "--seed", str(redo.get("seed"))]
    print("the reconstruction")
    run_tool(command, dry_run)
    if dry_run:
        return {}
    return {}


def build(asset_id, dry_run=False):
    """Build the redo of a prop, from the stage it starts from."""
    entry = read_entry(asset_id)
    if entry is None:
        print(f"{asset_id} is not in the manifest")
        return 1
    redo = entry.get("redo")
    if not redo:
        print(f"{asset_id} has no redo queued")
        return 1
    claimed = False
    if not dry_run:
        claimed = claim(asset_id)
        if not claimed:
            print(f"{asset_id}: the redo is claimed by another pass")
            return 0

    plan = redo.get("plan") or []
    done = list(redo.get("done") or [])
    print(f"{asset_id}: a redo from {redo.get('stage')}")
    print(f"  what was asked for: {redo.get('request') or '(no detail given)'}")
    try:
        for stage in plan:
            if stage in done:
                print(f"- {stage}: already done")
                continue
            print(f"- {stage}")
            if stage == ART:
                fields = step_art(entry, redo, dry_run)
            elif stage == CUTOUT:
                fields = step_cutout(entry, redo, dry_run)
            elif stage == SHEET:
                fields = step_sheet(entry, redo, dry_run)
            elif stage == MESH:
                fields = step_mesh(entry, redo, dry_run)
            else:
                continue
            if dry_run:
                continue
            apply_fields(entry, redo, stage, fields)
            record(asset_id, stage, **fields)
            # the entry is read again: what a stage produced is on it now, and
            # the next stage is built from what this one made
            entry = read_entry(asset_id) or entry
            redo = entry.get("redo") or redo
    except Exception as error:  # the claim is given back, so the prop is not stuck
        if claimed:
            release(asset_id)
        print(f"  the redo did not settle: {error}")
        return 1

    if dry_run:
        print("nothing was built: this was a dry run")
        return 0

    # the mesh is on disk: the finish chain is told so, and it captures and
    # publishes the prop again
    if MESH in plan:
        claim_revision.landed(asset_id)
        record(asset_id, "built", built_at=manifest_io.now())
    print(f"{asset_id}: the redo has landed")
    return 0


def apply_fields(entry, redo, stage, fields):
    """Put what a stage produced on the manifest entry.

    The manifest may only name files that exist, so the entry is pointed at
    the new cutout and the new sheet as they are made. What they replaced is
    kept on the redo block, and the old files stay on disk.
    """
    if not fields:
        return
    def change(entry):
        redo = entry.get("redo") or {}
        if stage == ART:
            if fields.get("cutout"):
                redo.setdefault("previous_cutout", entry.get("alpha_cutout"))
                entry["alpha_cutout"] = fields["cutout"]
                redo["cutout"] = fields["cutout"]
            if fields.get("art"):
                entry["reference_concept"] = fields["art"]
        if stage == CUTOUT and fields.get("cutout"):
            redo.setdefault("previous_cutout", entry.get("alpha_cutout"))
            entry["alpha_cutout"] = fields["cutout"]
            redo["cutout"] = fields["cutout"]
        if stage == SHEET:
            if fields.get("sheet"):
                redo.setdefault("previous_sheet", entry.get("turnaround_sheet"))
                entry["turnaround_sheet"] = fields["sheet"]
                redo["sheet"] = fields["sheet"]
            if fields.get("preview"):
                entry["turntable"] = fields["preview"]
    update(entry["id"], change)


def listing():
    """Every prop that has a redo queued."""
    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
    out = []
    for entry in manifest["assets"]:
        redo = entry.get("redo")
        if not redo:
            continue
        out.append({
            "id": entry["id"],
            "stage": redo.get("stage"),
            "plan": redo.get("plan"),
            "done": redo.get("done"),
            "seed": redo.get("seed"),
            "requested_at": redo.get("requested_at"),
            "claimed_at": redo.get("claimed_at"),
            "built_at": redo.get("built_at"),
        })
    return out


def main():
    if "--list" in sys.argv:
        print(json.dumps(listing(), indent=2))
        return 0
    if "--plan" in sys.argv:
        asset_id = sys.argv[sys.argv.index("--plan") + 1]
        return build(asset_id, dry_run=True)
    asset_id = sys.argv[1]
    return build(asset_id, dry_run="--dry-run" in sys.argv)


if __name__ == "__main__":
    sys.exit(main())
