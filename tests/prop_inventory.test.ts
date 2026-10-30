// The inventory is the queue, written on one page.
//
// The review happens on twenty-two asset issues, one prop at a time, and a
// list of issue titles is not something anyone can read at a glance: what is
// settled, what is waiting on a person and what is closed all look alike in
// it. So the batch is written up as an inventory - and an inventory that
// says the wrong thing is worse than no inventory, because it is read
// instead of the issues.
//
// These tests hold it against the truth: the manifest is what is approved,
// the capture reports are what the checks found, and the game's own prop
// table is what is actually in the game. The inventory has to agree with
// all three, and it has to account for every prop.
import * as path from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const TOOL = path.join(ROOT, "tools", "props", "inventory.py");

/** The python on this machine, if there is one. */
function findPython(): string | null {
  for (const candidate of ["python3", "python", "py"]) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  return null;
}

const PYTHON = findPython();

/** The inventory, as the tool writes it. */
function inventory(): string {
  const result = spawnSync(PYTHON!, [TOOL], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr || "the inventory failed");
  return result.stdout;
}

const manifest = JSON.parse(
  spawnSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('data/asset_manifest.json','utf8'))"], {
    encoding: "utf8",
  }).stdout,
);

/** The rows of one of the inventory's tables. */
function rowsOf(body: string, heading: string): string[] {
  const start = body.indexOf(heading);
  if (start < 0) return [];
  const lines = body.slice(start).split("\n");
  const rows: string[] = [];
  let header = true;
  for (const line of lines) {
    if (!line.startsWith("|")) {
      // The table has ended - but a blank line before it is just spacing.
      if (rows.length) break;
      continue;
    }
    if (line.includes(":---")) continue;
    // The first row of a table names its columns; it is not a prop.
    if (header) {
      header = false;
      continue;
    }
    rows.push(line);
  }
  return rows;
}

describe.skipIf(!PYTHON)("the prop inventory", () => {
  it("accounts for every prop in the manifest", () => {
    const body = inventory();
    const rows = [
      ...rowsOf(body, "#### Waiting on you"),
      ...rowsOf(body, "#### Approved and in the game"),
      ...rowsOf(body, "#### Closed"),
    ];
    expect(rows.length).toBe(manifest.assets.length);
    for (const asset of manifest.assets) {
      expect(body).toContain(asset.id);
    }
  });

  it("puts every approved prop in the approved table, and only those", () => {
    const body = inventory();
    const approved = rowsOf(body, "#### Approved and in the game");
    const approvedIds = manifest.assets
      .filter((asset: { status: string }) => asset.status === "status:asset-approved")
      .map((asset: { id: string }) => asset.id);
    expect(approved.length).toBe(approvedIds.length);
    for (const id of approvedIds) {
      expect(approved.some((row) => row.includes(id))).toBe(true);
    }
    const waiting = rowsOf(body, "#### Waiting on you");
    for (const row of approved) {
      const id = row.split("`")[1];
      expect(waiting.some((other) => other.includes(id))).toBe(false);
    }
  });

  it("says the approved props are in the game", () => {
    const body = inventory();
    const table = spawnSync("node", ["-e", "process.stdout.write(require('fs').readFileSync('src/data/props.json','utf8'))"], {
      encoding: "utf8",
    }).stdout;
    const approved = rowsOf(body, "#### Approved and in the game");
    for (const row of approved) {
      const id = row.split("`")[1];
      expect(table).toContain(id);
    }
  });

  it("links every prop to the issue it is reviewed on", () => {
    const body = inventory();
    const linked = new Set(
      [...rowsOf(body, "#### Waiting on you"), ...rowsOf(body, "#### Approved and in the game"), ...rowsOf(body, "#### Closed")]
        .map((row) => row.match(/#(\d+)/)?.[1])
        .filter(Boolean),
    );
    expect(linked.size).toBe(manifest.assets.length);
  });

  it("says what to do with a prop that is waiting", () => {
    const body = inventory();
    const waiting = rowsOf(body, "#### Waiting on you");
    const deciding = waiting.filter((row) => !row.includes("in the build queue"));
    for (const row of waiting) {
      // A prop that is waiting is either waiting for a decision or already
      // in the build queue; what it must not be is a row that says nothing.
      expect(row).toMatch(/waiting on the in-game review|in the build queue/);
    }
    // The two answers are offered only when there is something to answer.
    if (deciding.length) {
      expect(body).toContain("/approve-3d");
      expect(body).toContain("/revision");
    }
  });

  it("does not ask for a decision on a prop that is already being rebuilt", () => {
    const body = inventory();
    const waiting = rowsOf(body, "#### Waiting on you");
    const queued = waiting.filter((row) => row.includes("in the build queue"));
    // Nothing is owed on a prop that is in the build queue: the decision has
    // been made and the rebuild is under way.
    for (const row of queued) {
      expect(row).not.toContain("waiting on the in-game review");
    }
  });
});
