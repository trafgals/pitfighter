// The review controls on the asset issues: what a reviewer has to write for the
// pipeline to rebuild a prop or to record an approval.
//
// These rules decide whether a prop is rebuilt or approved, so they are held
// down here. The rule that mattered most is the one that is easy to get
// wrong: a command has to be *issued*, not mentioned. The pipeline's own
// comment ends with "Comment `/approve-3d` to approve", and reading that as
// an approval approved every prop on its own - so the command has to start a
// line, outside a code block and outside a quotation, and the pipeline's own
// comments are never commands at all.
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const ISSUES = path.join(ROOT, "tools", "props", "issues.py");
const STATE = path.join(ROOT, "tools", "props", "prop_state.py");
const TOOLS = path.join(ROOT, "tools", "props");

/** The python on this machine, if there is one. */
function findPython(): string | null {
  for (const candidate of ["python3", "python", "py"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

const PYTHON = findPython();

/** What the module reads a set of comment bodies as. */
function detect(command: string, bodies: string[]) {
  const result = spawnSync(PYTHON!, [ISSUES, "--detect", command], {
    input: JSON.stringify(bodies),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "the detector failed");
  return JSON.parse(result.stdout) as { command: boolean; text: string }[];
}

/** What the state machine reads a manifest entry as. */
function stateOf(entry: Record<string, unknown>) {
  const result = spawnSync(PYTHON!, [STATE, "--of"], {
    input: JSON.stringify(entry),
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr || "the state reader failed");
  return result.stdout.trim();
}

describe("the tools in tools/props", () => {
  it("gives every tool that imports a sibling its own directory on the path", () => {
    // The python this pipeline runs under is an embeddable build: a
    // python312._pth pins sys.path, so the script's own directory is NOT
    // added to it. A tool that imports a sibling module therefore fails with
    // "No module named ..." unless it puts its own directory on the path
    // itself - and it fails in the middle of a prop's finish, after the GPU
    // work is done.
    // a real import, at the start of a line: the usage examples in a
    // module's own docstring are indented, and they are not imports
    const siblings = /^(?:import|from)\s+(manifest_io|issues|git_io|pose|compare_front|mesh_surface|sheet_view|refit_prop)\b/m;
    const offenders: string[] = [];
    for (const name of fs.readdirSync(TOOLS)) {
      if (!name.endsWith(".py")) continue;
      const text = fs.readFileSync(path.join(TOOLS, name), "utf8");
      if (!siblings.test(text)) continue;
      if (!text.includes("sys.path.insert")) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});

describe.skipIf(!PYTHON)("the review commands on the asset issues", () => {
  it("reads a command that starts a line", () => {
    const [read] = detect("/revision", ["/revision the face is too rounded"]);
    expect(read.command).toBe(true);
    expect(read.text).toBe("the face is too rounded");
  });

  it("does not read a command that is only mentioned", () => {
    // the pipeline's own comment says "Comment `/approve-3d` to approve"
    const [read] = detect("/approve-3d", ["Comment `/approve-3d` to approve"]);
    expect(read.command).toBe(false);
  });

  it("does not read a command in the middle of a line", () => {
    const [read] = detect("/revision", ["please /revision this one"]);
    expect(read.command).toBe(false);
  });

  it("does not read a command inside a code block", () => {
    // the review guide shows the reviewer what a revision looks like, and a
    // reviewer who pastes that example back must not start a rebuild
    const [read] = detect("/revision", ["```\n/revision the face is too rounded\n```"]);
    expect(read.command).toBe(false);
  });

  it("does not read a command in a quotation", () => {
    const [read] = detect("/revision", ["> /revision the face is too rounded"]);
    expect(read.command).toBe(false);
  });

  it("does not read the pipeline's own comments as commands", () => {
    const [read] = detect("/revision", ["<!-- pixal3d-pipeline -->\n/revision the face is too rounded"]);
    expect(read.command).toBe(false);
  });

  it("reads a command that carries an invisible byte order mark", () => {
    // a comment written from a Windows shell picks one up without anyone
    // noticing, and it is invisible: a reviewer whose command was ignored
    // would have no idea why
    const [read] = detect("/revision", ["\ufeff/revision the face is too rounded"]);
    expect(read.command).toBe(true);
    expect(read.text).toBe("the face is too rounded");
  });

  it("takes the finding from the lines under the command", () => {
    const [read] = detect("/revision", ["/revision\n\nThe face is too rounded.\nAnd the grip is smooth."]);
    expect(read.text).toContain("The face is too rounded.");
    expect(read.text).toContain("And the grip is smooth.");
  });
});

describe.skipIf(!PYTHON)("where a prop stands", () => {
  it("skips a prop that has been through the pipeline", () => {
    expect(stateOf({ id: "x", status: "gate:3-review-ingame-3d" })).toBe("skip");
  });

  it("finishes a prop that has never been through the pipeline", () => {
    expect(stateOf({ id: "x", stand_in_measured: { triangles: 1 } })).toBe("finish");
  });

  it("waits for the rebuild a reviewer asked for", () => {
    // the mesh on disk is still the one the reviewer looked at, so publishing
    // it again would only republish what they have already seen
    expect(stateOf({ id: "x", revision_requested_at: "2026-10-29T13:00:00+10:00" })).toBe("wait");
  });

  it("finishes once the rebuilt mesh has landed", () => {
    expect(
      stateOf({
        id: "x",
        revision_requested_at: "2026-10-29T13:00:00+10:00",
        revision_built_at: "2026-10-29T13:40:00+10:00",
      }),
    ).toBe("finish");
  });

  it("skips once the rebuilt prop has been published", () => {
    // otherwise the finish chain would capture and publish it for ever
    expect(
      stateOf({
        id: "x",
        revision_requested_at: "2026-10-29T13:00:00+10:00",
        revision_built_at: "2026-10-29T13:40:00+10:00",
        revision_published_at: "2026-10-29T14:00:00+10:00",
      }),
    ).toBe("skip");
  });
});
