"""Put a prop back in the build queue when a reviewer asks for a revision.

The review happens on the issue, so a reviewer's request for a change is a
comment on the issue. This reads the asset issues, finds the requests that have
not been acted on, and re-queues the prop: the reconstruction is rebuilt from
the same approved sheet with a new seed, the capture is run again against it,
and the new renders are published and commented.

The trigger is a comment that begins a line with `/revision`. The label
`status:revision-requested` says the same thing to anyone scanning the list,
and is put on by this tool when the request is picked up.

What is rebuilt is the mesh. The approved art is the prop, and the art is not
the pipeline's to change: if the art itself is wrong, the comment says so and
the prop waits for new art rather than being rebuilt from the same sheet.

The manifest is written under the manifest's lock, so a request that arrives
while the pipeline is recording a prop does not lose the pipeline's change. The
commit is a partial one, naming the manifest, so the pipeline's half-staged
prop is never swept into it.

Usage:
    python tools/props/request_revision.py            # what would be re-queued
    python tools/props/request_revision.py --apply    # re-queue it
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import git_io  # noqa: E402
import manifest_io  # noqa: E402
from issues import (  # noqa: E402
    ASSET_ISSUES, REVISION, command_text, gh, issues_command, read_issues,
)

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MANIFEST = os.path.join(ROOT, "data", "asset_manifest.json")

REVISION_LABEL = "status:revision-requested"

# The seeds a rebuild can use. The workflow's own seed is 42, so a rebuild
# that is meant to be different never is.
SEEDS = [4242, 7777, 31337, 2024, 1890, 90210, 313, 8675309, 60613, 1123]


def next_seed(entry):
    """A seed this prop has not been built with before."""
    used = set(entry.get("revision_seeds") or [])
    used.add(42)
    for seed in SEEDS:
        if seed not in used:
            return seed
    return 42


def requests_on(issue):
    """The revision requests on an issue, oldest first.

    Only the reviewer's own comments count. The pipeline's comments are marked,
    so the pipeline cannot ask itself for a rebuild.
    """
    out = []
    for comment in issue.reviewer_comments():
        body = comment["body"]
        if not issues_command(body, REVISION):
            continue
        out.append({
            "id": comment["id"],
            "url": comment["url"],
            "text": command_text(body, REVISION),
        })
    return out


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
            pending = [r for r in requests_on(issue) if r["id"] not in handled]
            if not pending:
                continue
            request = pending[-1]
            seed = next_seed(entry)
            stamp = manifest_io.now()

            print(f"{asset_id} (issue #{number}): a revision is asked for")
            print(f"  what was asked: {request['text'] or '(no detail given)'}")
            print(f"  the mesh will be rebuilt with seed {seed}")
            if not apply:
                continue

            # The prop is back in the queue. The cycle's own state is cleared
            # first: a second request on a prop that was rebuilt once before
            # would otherwise still carry the old "built" and "published"
            # marks, and the finish chain would publish the old mesh again
            # instead of waiting for the new one.
            entry.pop("revision_built_at", None)
            entry.pop("revision_published_at", None)
            entry.pop("revision_claimed_at", None)
            # the marker the finish chain watches for is put back, so the
            # rebuild is picked up when it lands
            entry["stand_in_measured"] = entry.get("measured") or entry.get("stand_in_measured")
            entry["build"] = None
            entry.pop("measured", None)
            entry["status"] = "gate:2-review-turnaround"
            entry["revision_seed"] = seed
            entry["revision_requested_at"] = stamp
            entry["revision_seeds"] = list(entry.get("revision_seeds") or []) + [seed]
            entry["revision_handled"] = handled + [request["id"]]
            entry["revision_note"] = (
                f"Revision requested on {stamp}: {request['text'] or 'no detail given'}. "
                f"The reconstruction is being rebuilt with seed {seed} from the same approved sheet."
            )
            queued.append((asset_id, number, request, seed))

        if not queued:
            print("no revision has been asked for that has not been acted on")
            return 0

        if not apply:
            print("\nnothing was changed: run it again with --apply")
            return 0

        manifest_io.save(MANIFEST, manifest)

    # The labels and the comment are the reviewer's side of the story, and
    # they are made after the manifest is written: the manifest is the thing
    # that decides, and a comment that says "in the queue" must not be left
    # behind by a manifest that says otherwise.
    for asset_id, number, request, seed in queued:
        gh("issue", "edit", str(number), "--remove-label", "gate:3-review-ingame-3d",
           "--remove-label", "asset:3d-built", "--remove-label", REVISION_LABEL,
           "--add-label", "stage:pixal3d-mesh")
        body = (
            f"### The revision is in the queue\n\n"
            f"Asked for: {request['text'] or '(no detail given)'}\n\n"
            f"The reconstruction is being rebuilt with seed {seed} from the same approved sheet, "
            "and the capture will run again against it. The new renders will be published here "
            "when it lands.\n"
            "<!-- pixal3d-pipeline -->"
        )
        gh("issue", "comment", str(number), "--body", body)
        print(f"  {asset_id}: re-queued with seed {seed}")

    # A partial commit: the manifest and nothing else. The pipeline stages a
    # prop's files one at a time, and a commit that named no paths would take
    # whatever was staged along with it.
    git_io.commit(
        ["data/asset_manifest.json"],
        ["chore(assets): put the props a reviewer asked to revise back in the queue",
         "A revision asked for on the issue is carried into the manifest: the prop is "
         "re-queued with a new seed and waits for the rebuild before it is published again."],
    )
    try:
        git_io.push()
    except RuntimeError as error:
        print(f"  the commit is local but the push failed: {error}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
