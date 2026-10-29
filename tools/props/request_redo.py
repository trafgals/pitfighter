"""Put a prop back in the build queue for a rebuild from a stage.

A reviewer asks for a change on the issue. A request that carries the
pipeline's command is read by `request_revision.py`, which is what the watcher
runs. This is the other path, for a request that carries no command at all -
a comment that says "redo it from the 2d stage" and leaves the command out.

The stage is worked out from the reviewer's own words, and the words that
decided it are said out loud, so that a person can see why the prop was
queued from that stage. This is deliberately not the automatic trigger: the
automatic trigger reads a command, and a command that names a stage the
pipeline does not know is an error. A stage is never guessed at from a
comment.

A request that names a stage but cannot be acted on - a stage that cannot be
read, or none at all - is reported and nothing is queued.

The manifest is written under the manifest's lock, so a request that arrives
while the pipeline is recording a prop does not lose the pipeline's change.
Nothing is posted to GitHub and nothing is committed here: the issue and the
commit are the caller's to make, and the commands for them are printed.

Usage:
    python tools/props/request_redo.py           # what would be re-queued
    python tools/props/request_redo.py --apply   # re-queue it
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import manifest_io  # noqa: E402
from issues import ASSET_ISSUES, LABEL_REVISION_REQUESTED, read_issues  # noqa: E402
from redo_stage import (  # noqa: E402
    MESH, STAGES, apply_redo, redo_block, revision_stage, stage_from_text,
)
from request_revision import STAGE_LABELS, next_seed  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")


def find_request(issue, handled):
    """The request on an issue that has not been acted on yet.

    A command is read first: it says which stage, and it says it plainly. A
    request that carries no command at all is read from the reviewer's own
    words, and only when the issue carries the label that says a revision was
    asked for.

    Gives back a dictionary with the stage, the request, the reason and the
    comment ids it came from - or an error, or nothing at all.
    """
    comments = [c for c in issue.reviewer_comments() if c["id"] not in handled]

    for comment in comments:
        stage, error, text = revision_stage(comment["body"])
        if error:
            return {"error": error, "text": text, "ids": [comment["id"]]}
        if stage is None:
            continue
        if stage == MESH:
            # a plain /revision rebuilds the mesh, and request_revision.py is
            # what rebuilds it
            return {"skip": "a plain /revision rebuilds the mesh: "
                           "request_revision.py is what handles it",
                    "ids": [comment["id"]]}
        return {"stage": stage, "text": text, "reason": f"the command names {stage}",
                "ids": [comment["id"]]}

    if not issue.has_label(LABEL_REVISION_REQUESTED):
        return None

    # the reviewer's own words. The stage named earliest wins, because a redo
    # from an early stage covers every stage after it.
    found = []
    for comment in comments:
        stage, reason = stage_from_text(comment["body"])
        if stage is None:
            continue
        found.append((STAGES.index(stage), stage, reason, comment))
    if not found:
        return {"error": "the request names no stage: it has to say what is rebuilt",
                "ids": []}
    found.sort(key=lambda hit: hit[0])
    _, stage, reason, comment = found[0]
    text = " / ".join(c["body"].strip() for c in comments)
    ids = [hit[3]["id"] for hit in found]
    return {"stage": stage, "text": text, "reason": reason, "ids": ids}


def main():
    apply = "--apply" in sys.argv
    issues = read_issues()
    queued = []

    with manifest_io.locked(MANIFEST):
        manifest = manifest_io.load(MANIFEST)
        by_id = {a["id"]: a for a in manifest["assets"]}

        for asset_id, number in ASSET_ISSUES.items():
            entry = by_id.get(asset_id)
            if entry is None:
                continue
            issue = issues.get(number)
            if issue is None:
                print(f"  issue #{number} could not be read")
                continue
            handled = list(entry.get("revision_handled") or [])
            request = find_request(issue, handled)
            if request is None:
                continue
            if request.get("error"):
                print(f"{asset_id} (issue #{number}): nothing was queued")
                print(f"  {request['error']}")
                continue
            if request.get("skip"):
                print(f"{asset_id} (issue #{number}): nothing was queued")
                print(f"  {request['skip']}")
                continue

            stage = request["stage"]
            seed = next_seed(entry)
            stamp = manifest_io.now()
            block = redo_block(stage, request["text"], request["reason"], number, seed, stamp)

            print(f"{asset_id} (issue #{number}): a redo is asked for from {stage}")
            print(f"  what was asked: {request['text'] or '(no detail given)'}")
            print(f"  why that stage: {request['reason']}")
            print(f"  the prop will be rebuilt from {stage} with seed {seed}")
            if not apply:
                continue

            apply_redo(entry, block)
            entry["revision_handled"] = handled + list(request["ids"])
            queued.append((asset_id, number, stage, request["text"], seed))

        if not queued:
            print("no redo has been asked for that has not been acted on")
            return 0
        if not apply:
            print("\nnothing was changed: run it again with --apply")
            return 0

        manifest_io.save(MANIFEST, manifest)

    # The issue and the commit are the caller's to make: the commands are
    # printed rather than run, so that nothing is said on an issue by accident.
    for asset_id, number, stage, text, seed in queued:
        print(f"\n{asset_id}: re-queued from {stage} with seed {seed}")
        print(f"  gh issue edit {number} --remove-label {LABEL_REVISION_REQUESTED} "
              f"--add-label {STAGE_LABELS[stage]}")
        print(f"  python tools/props/redo_prop.py {asset_id}")
        print(f"  python tools/props/git_io.py commit data/asset_manifest.json "
              f"--message 'chore(assets): put {asset_id} back in the queue for a redo from {stage}'")
    return 0


if __name__ == "__main__":
    sys.exit(main())
