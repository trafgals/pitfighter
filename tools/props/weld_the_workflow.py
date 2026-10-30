"""Put the weld in front of the decimation in the Pixal3D workflow.

The remesh hands back a mesh whose vertices are per-face: the same point is
written down once for every face that touches it. The decimator keeps that
apartness, so what comes out is a pile of shards rather than one surface:

  - the vertices along a seam carry normals averaged over one side only, so
    the seam renders as a hard, often black, edge - the "bullet holes";
  - an unwrap over a fragmented mesh lays out hundreds of overlapping charts,
    so the baked texture is a patchwork and the normal map is garbage.

Welding before the decimation fixes both, because the decimator is told to
keep its output welded and the unwrap and the bakes then see one surface.

The weld itself is the node ComfyUI already ships: WeldVertices merges
coincident vertices on a grid quantised to a fraction of the mesh's own
diagonal, which is what a voxel remesh's duplicated vertices need.

    python tools/props/weld_the_workflow.py [--dry]
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKFLOW = os.path.join(ROOT, "public", "tex", "workflows", "pixal3d_multiview.json")

# The node that will do the welding, and the node it has to sit in front of.
WELD_ID = "900"
WELD_FROM = "241"      # RemeshMesh
DECIMATE_ID = "186"    # DecimateMesh


def main():
    with open(WORKFLOW, encoding="utf-8") as f:
        workflow = json.load(f)

    if WELD_ID in workflow:
        print("the workflow already welds before it decimates")
        return 0

    decimate = workflow[DECIMATE_ID]
    if decimate["class_type"] != "DecimateMesh":
        raise SystemExit(f"node {DECIMATE_ID} is not the decimator")
    if decimate["inputs"]["mesh"][0] != WELD_FROM:
        raise SystemExit(f"the decimator does not read the remesh ({decimate['inputs']['mesh']})")

    workflow[WELD_ID] = {
        "class_type": "WeldVertices",
        "inputs": {
            "mesh": [WELD_FROM, 0],
            # A fraction of the mesh's own diagonal: the remesh's duplicated
            # vertices are the same point exactly, so this only ever merges
            # what is the same point.
            "epsilon_rel": 1e-5,
            "epsilon_abs": 0.0,
        },
    }
    decimate["inputs"]["mesh"] = [WELD_ID, 0]

    if "--dry" in sys.argv:
        print(json.dumps(workflow[WELD_ID], indent=1))
        print(json.dumps(workflow[DECIMATE_ID], indent=1))
        return 0

    with open(WORKFLOW, "w", encoding="utf-8", newline="\n") as f:
        json.dump(workflow, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("the workflow now welds the remeshed mesh before it decimates it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
