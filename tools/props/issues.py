"""The asset issues, read once and read whole.

The review happens on the issues, so the pipeline reads them: which comments a
reviewer has left, and which labels the issue carries. Reading them one issue
at a time is eighteen `gh` calls, and the watcher polls every two minutes, so
one call for the whole set is what it uses.

What a reviewer says is read strictly, because reading it loosely is what
approves a prop nobody approved:

  * the command has to start a line. The pipeline's own comment ends with
    "Comment `/approve-3d` to approve", and a comment that merely mentions a
    command is someone talking about it rather than issuing it.
  * a command inside a fenced code block is an example, not an instruction.
    The review guide shows the reviewer what a revision looks like, and a
    reviewer who pastes that example back must not start a rebuild.
  * a quoted line ("> /approve-3d") is someone repeating something else.
  * the pipeline's own comments carry a marker and are never commands at all.

Usage:
    from issues import read_issues, ASSET_ISSUES

    issues = read_issues()
    issue = issues[83]
    issue.labels          # the names of the labels the issue carries
    issue.comments        # the comments, oldest first
    issue.reviewer_comments()   # the ones a person left
"""
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# The pipeline's own comments are marked, and are not a person's. The marker is
# on the newer ones; the heading is on all of them, so an announcement from
# before the marker was added is still recognised as the pipeline's and is not
# read as a reviewer's request.
PIPELINE_HEADINGS = (
    "### 🚀",
    "### The revision is in the queue",
    "### The redo is in the queue",
    "### The revision was not read",
)

# The props this pipeline rebuilds, and the issue each is tracked on. The
# three that did not come from this pipeline are here too - the custodian
# helmet, the stovepipe and the private box chair - because a human's
# approval is a label on an issue, and the manifest has to follow it whoever
# built the asset.
ASSET_ISSUES = {
    "prop_pegg_cast_iron_last": 83,
    "prop_crape_spiked_brolly": 84,
    "prop_eleanor_weeping_rapier": 85,
    "prop_tilly_clinker_tongs": 86,
    "prop_sluice_flatcap": 87,
    "prop_kilnworth_nursecap": 88,
    "prop_mule_championship_belt": 89,
    "prop_rook_souwester": 90,
    "prop_bulwark_pistons": 91,
    "prop_crump_samovar": 92,
    "weapon_knuckleduster": 93,
    "weapon_coal_shovel": 94,
    "weapon_bone_saw": 95,
    "weapon_nail_bat": 96,
    "weapon_cleaver": 97,
    "weapon_piston_gauntlet": 98,
    "weapon_lamplighter_pole": 99,
    "pickup_tonic": 101,
    "prop_winch_custodian_helmet": 81,
    "prop_smelt_stovepipe": 82,
    "weapon_chair": 100,
}

# the marker the pipeline's own comments carry. A comment that carries it is
# the pipeline talking, not a reviewer, so it is never read as a request.
PIPELINE_MARKER = "<!-- pixal3d-pipeline -->"

# the commands a reviewer leaves on an issue
APPROVE_3D = "/approve-3d"
APPROVE_TURNAROUND = "/approve-turnaround"
REVISION = "/revision"

# the labels that carry a verdict. A label is unambiguous: unlike a comment,
# nobody leaves a label by mentioning it in passing.
LABEL_APPROVED = "status:asset-approved"
LABEL_TURNAROUND_APPROVED = "status:turnaround-approved"
LABEL_REVISION_REQUESTED = "status:revision-requested"

# how many times a transient `gh` failure is retried
GH_ATTEMPTS = 3


class Issue:
    """One issue, as the reviewer will have left it."""

    def __init__(self, number, data):
        self.number = number
        self.labels = [label["name"] for label in data.get("labels", [])]
        self.comments = [
            {
                "id": comment.get("id", ""),
                "url": comment.get("url", ""),
                "body": comment.get("body", "") or "",
            }
            for comment in data.get("comments", []) or []
        ]

    def has_label(self, name):
        return name in self.labels

    def reviewer_comments(self):
        """The comments a person left, oldest first.

        The pipeline's own comments are marked, and are not a person's.
        """
        return [c for c in self.comments if not is_pipeline_comment(c["body"])]


def is_pipeline_comment(body):
    """Whether a comment is the pipeline's own rather than a person's.

    The marker says so on the newer comments. The heading says so on all of
    them, so that an announcement made before the marker was introduced is not
    taken for a reviewer's request: the pipeline's own words must never be
    read as what the human asked for.
    """
    if not body:
        return True
    if PIPELINE_MARKER in body:
        return True
    return any(body.lstrip().startswith(heading) for heading in PIPELINE_HEADINGS)


def gh(*args):
    """Run `gh` and give back what it printed.

    `gh` writes UTF-8, and an issue body carries characters the system's own
    codec cannot read, so the decoding is not left to the default. A call that
    fails is retried: the watcher polls every two minutes, and a network that
    blinks must not read as "the reviewer said nothing".
    """
    last = None
    for attempt in range(GH_ATTEMPTS):
        try:
            result = subprocess.run(
                ["gh", *args], cwd=ROOT, check=True, capture_output=True, text=True,
                encoding="utf-8", errors="replace",
            )
            return result.stdout
        except subprocess.CalledProcessError as error:
            last = error
            time.sleep(2 * (attempt + 1))
    raise last


def read_issues(numbers=None):
    """The asset issues, by number.

    One call covers all of them: the list carries each issue's labels and its
    comments, bodies and all.
    """
    wanted = set(numbers or ASSET_ISSUES.values())
    data = json.loads(gh(
        "issue", "list", "--repo", "trafgals/pitfighter", "--state", "all",
        "--limit", "200", "--json", "number,labels,comments",
    ))
    out = {}
    for entry in data:
        number = entry.get("number")
        if number in wanted:
            out[number] = Issue(number, entry)
    return out


def command_lines(body):
    """The lines of a comment that could be issuing a command.

    A fenced code block is skipped, because what is inside one is an example.
    A quoted line is skipped, because it is someone repeating something else.

    A byte order mark is taken out first. It is invisible, and one at the
    start of a line would stop the command from being read as a command at
    all - and a comment written from a Windows shell picks one up without
    anyone noticing.
    """
    if not body:
        return []
    out = []
    fenced = False
    for line in body.splitlines():
        stripped = line.replace("\ufeff", "").strip()
        if stripped.startswith("```"):
            fenced = not fenced
            continue
        if fenced or stripped.startswith(">"):
            continue
        out.append(stripped)
    return out


def issues_command(body, command):
    """Whether a comment issues a command.

    The command has to start a line, and it has to be a line a person wrote:
    not inside a code block, and not a quotation.
    """
    if not body or PIPELINE_MARKER in body:
        return False
    return any(line.startswith(command) for line in command_lines(body))


def command_text(body, command):
    """What the reviewer said with the command.

    It is the rest of the line the command is on, and the lines under it: what
    a reviewer writes after the command is the finding.
    """
    if not body or PIPELINE_MARKER in body:
        return ""
    lines = body.splitlines()
    quoted = []
    fenced = False
    for line in lines:
        stripped = line.replace("\ufeff", "").strip()
        if stripped.startswith("```"):
            fenced = not fenced
            quoted.append("")
            continue
        if fenced or stripped.startswith(">"):
            quoted.append("")
            continue
        quoted.append(stripped)
    for index, line in enumerate(quoted):
        if not line.startswith(command):
            continue
        out = [line[len(command):].strip()]
        for under in quoted[index + 1:]:
            out.append(under.strip())
        return " ".join(part for part in out if part).strip()
    return ""


def main():
    # A debugging affordance: read a JSON list of comment bodies on stdin and
    # write back what each one is read as. The rules this module enforces are
    # the ones that decide whether a prop is rebuilt or approved, so they are
    # held down by a test that uses this.
    #
    # The bytes are decoded as UTF-8 rather than left to the system's own
    # codec: a comment carries characters the system's codec cannot read, and
    # an invisible byte order mark is one of them.
    if "--detect" in sys.argv:
        command = sys.argv[sys.argv.index("--detect") + 1]
        bodies = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        result = [
            {"command": issues_command(body, command), "text": command_text(body, command)}
            for body in bodies
        ]
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0
    print(__doc__)
    return 1


if __name__ == "__main__":
    sys.exit(main())
