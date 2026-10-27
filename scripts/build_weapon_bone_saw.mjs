#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const res = spawnSync(process.execPath, [path.join(__dirname, "build_procedural_prop.mjs"), "weapon_bone_saw"], { stdio: "inherit" });
process.exit(res.status ?? 0);
